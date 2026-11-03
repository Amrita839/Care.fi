-- =============================================================================
-- Patient Locker — initial schema
-- Tables, enums, masking, RLS, private storage, realtime, audit helpers.
-- Every table has RLS ON. The pipeline (Inngest) uses the service-role key,
-- which bypasses RLS; staff users go through the policies below.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.staff_role as enum ('admin', 'agent');

create type public.doc_type as enum (
  'DISCHARGE_SUMMARY',
  'FINAL_BILL',
  'INVESTIGATION_REPORT',
  'CONSULTATION_PAPER',
  'PHARMACY_BILL',
  'POLICY_COPY',
  'KYC',
  'CANCELLED_CHEQUE',
  'OTHER'
);

create type public.classification_status as enum ('PENDING', 'CLASSIFIED', 'FAILED');

create type public.query_status as enum (
  'RECEIVED', 'PROCESSING', 'SENT', 'PARTIALLY_SENT', 'FAILED', 'NEEDS_REVIEW', 'RESOLVED'
);

create type public.query_decision as enum ('HAVE', 'NEED_FROM_PATIENT', 'HAVE_BUT_UNCLEAR');

create type public.message_channel as enum ('WHATSAPP', 'EMAIL');
create type public.message_status  as enum ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'FAILED');
-- AUTO = pipeline, CORRECTION = after an agent edits decisions, RESEND = manual resend of a failed/old message
create type public.message_kind    as enum ('AUTO', 'CORRECTION', 'RESEND');

create type public.pipeline_step as enum (
  'RECEIVED', 'READ', 'EXTRACT', 'MATCH', 'REVIEW_GATE', 'COMPOSE', 'SEND_WHATSAPP', 'SEND_EMAIL', 'DONE'
);
create type public.step_status as enum ('STARTED', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Safe text -> uuid cast (returns null instead of raising). Used by storage policies.
create or replace function public.try_uuid(t text)
returns uuid language plpgsql immutable as $$
begin
  return t::uuid;
exception when others then
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------
create table public.staff_users (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        public.staff_role not null default 'agent',
  full_name   text not null,
  email       text not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Patients
-- phone / email / policy_number are NOT readable by staff directly.
-- They read the *_masked generated columns; the real values only come back
-- through reveal_patient_contact(), which writes to audit_log.
-- ---------------------------------------------------------------------------
create table public.patients (
  id                uuid primary key default gen_random_uuid(),
  patient_code      text not null unique check (patient_code ~ '^PL-[0-9]{6}$'),
  full_name         text not null,
  phone             text check (phone ~ '^\+[0-9]{10,15}$'),
  email             text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  policy_number     text,
  insurer           text,
  assigned_agent_id uuid references public.staff_users (id) on delete set null,
  phone_masked      text generated always as (
    case when phone is null then null
         else left(phone, 3) || ' ••••• •' || right(phone, 3) end
  ) stored,
  email_masked      text generated always as (
    case when email is null then null
         else left(split_part(email, '@', 1), 2) || '•••@' || split_part(email, '@', 2) end
  ) stored,
  policy_masked     text generated always as (
    case when policy_number is null then null
         else '••••' || right(policy_number, 4) end
  ) stored,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  last_activity_at  timestamptz not null default now()
);
create index patients_assigned_agent_idx on public.patients (assigned_agent_id);
create index patients_last_activity_idx on public.patients (last_activity_at desc);
create index patients_name_trgm_idx on public.patients (lower(full_name));
create trigger patients_updated_at before update on public.patients
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Documents in a patient's locker
-- extracted_json holds the classifier output (never full document text).
-- ---------------------------------------------------------------------------
create table public.documents (
  id                     uuid primary key default gen_random_uuid(),
  patient_id             uuid not null references public.patients (id) on delete cascade,
  doc_type               public.doc_type not null default 'OTHER',
  file_path              text not null unique,
  original_name          text not null,
  mime_type              text,
  size_bytes             bigint,
  extracted_json         jsonb not null default '{}'::jsonb,
  doc_date               date,
  hospital               text,
  amount                 numeric(12, 2),
  confidence             numeric(3, 2) check (confidence between 0 and 1),
  classification_status  public.classification_status not null default 'PENDING',
  classification_error   text,
  uploaded_by            uuid references public.staff_users (id) on delete set null,
  uploaded_at            timestamptz not null default now()
);
create index documents_patient_idx on public.documents (patient_id, doc_type);

-- ---------------------------------------------------------------------------
-- Insurer query letters
-- ---------------------------------------------------------------------------
create table public.query_letters (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references public.patients (id) on delete cascade,
  file_path       text not null unique,
  original_name   text,
  status          public.query_status not null default 'RECEIVED',
  current_step    public.pipeline_step not null default 'RECEIVED',
  last_error      text,
  review_reason   text,
  raw_text        text,              -- OCR text of the insurer letter (not a patient document)
  page_count      int,
  uploaded_by     uuid references public.staff_users (id) on delete set null,
  received_at     timestamptz not null default now(),
  read_at         timestamptz,
  analysed_at     timestamptz,
  sent_at         timestamptz,
  processed_at    timestamptz,
  resolved_at     timestamptz
);
create index query_letters_patient_idx on public.query_letters (patient_id, received_at desc);
create index query_letters_status_idx on public.query_letters (status);

-- Step-by-step pipeline log: powers the Processing view (realtime) and
-- shows exactly where a case got stuck.
create table public.query_letter_events (
  id               bigint generated always as identity primary key,
  query_letter_id  uuid not null references public.query_letters (id) on delete cascade,
  step             public.pipeline_step not null,
  status           public.step_status not null,
  attempt          int not null default 1,
  detail           text,
  duration_ms      int,
  created_at       timestamptz not null default now()
);
create index query_letter_events_letter_idx on public.query_letter_events (query_letter_id, created_at);

-- ---------------------------------------------------------------------------
-- Points extracted from a query letter
-- ---------------------------------------------------------------------------
create table public.query_points (
  id                   uuid primary key default gen_random_uuid(),
  query_letter_id      uuid not null references public.query_letters (id) on delete cascade,
  point_no             int not null check (point_no > 0),
  point_text           text not null,     -- verbatim/near-verbatim from the letter
  insurer_ask          text not null,     -- plain-language restatement
  needed_doc_type      public.doc_type,
  decision             public.query_decision,
  matched_document_id  uuid references public.documents (id) on delete set null,
  reason               text,
  confidence           numeric(3, 2) check (confidence between 0 and 1),
  needs_review         boolean not null default false,
  edited_by_agent      boolean not null default false,
  edited_by            uuid references public.staff_users (id) on delete set null,
  edited_at            timestamptz,
  created_at           timestamptz not null default now(),
  unique (query_letter_id, point_no)     -- makes re-running the extract step idempotent
);

-- ---------------------------------------------------------------------------
-- Outbound messages (WhatsApp + email). idempotency_key is unique so a retry
-- can never double-send: '<query_letter_id>:<channel>:<revision>'.
-- revision 0 = the automatic message; corrections / resends increment it.
-- ---------------------------------------------------------------------------
create table public.messages (
  id                   uuid primary key default gen_random_uuid(),
  patient_id           uuid not null references public.patients (id) on delete cascade,
  query_letter_id      uuid references public.query_letters (id) on delete set null,
  channel              public.message_channel not null,
  kind                 public.message_kind not null default 'AUTO',
  revision             int not null default 0,
  idempotency_key      text not null unique,
  status               public.message_status not null default 'QUEUED',
  to_address           text,              -- masked destination, for display
  subject              text,
  body                 text not null,
  provider_message_id  text,
  attempts             int not null default 0,
  error                text,
  created_by           uuid references public.staff_users (id) on delete set null,
  created_at           timestamptz not null default now(),
  sent_at              timestamptz
);
create index messages_patient_idx on public.messages (patient_id, created_at desc);
create index messages_letter_idx on public.messages (query_letter_id);

-- ---------------------------------------------------------------------------
-- Audit log (append-only). meta must never contain document contents.
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users (id) on delete set null,
  action      text not null,      -- VIEW_PATIENT, REVEAL_CONTACT, DOWNLOAD_DOCUMENT, EDIT_DECISION, RESEND_MESSAGE, ...
  entity      text not null,      -- patients, documents, query_points, messages, ...
  entity_id   text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);
create index audit_log_user_idx on public.audit_log (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- App settings (single row)
-- ---------------------------------------------------------------------------
create table public.app_settings (
  id          boolean primary key default true check (id),
  auto_send   boolean not null default true,
  updated_by  uuid references public.staff_users (id) on delete set null,
  updated_at  timestamptz not null default now()
);
insert into public.app_settings (id) values (true);

-- =============================================================================
-- Access helpers (SECURITY DEFINER so policies don't recurse through RLS)
-- =============================================================================
create or replace function public.current_staff_role()
returns public.staff_role language sql stable security definer set search_path = '' as $$
  select role from public.staff_users where id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select role = 'admin' from public.staff_users where id = auth.uid()), false)
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff_users where id = auth.uid())
$$;

create or replace function public.can_access_patient(p_patient_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.patients p
    join public.staff_users s on s.id = auth.uid()
    where p.id = p_patient_id
      and (s.role = 'admin' or p.assigned_agent_id = s.id)
  )
$$;

create or replace function public.can_access_query_letter(p_query_letter_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.query_letters q
    where q.id = p_query_letter_id and public.can_access_patient(q.patient_id)
  )
$$;

-- Write an audit entry as the calling user. The only way staff can write audit rows.
create or replace function public.log_audit(
  p_action text, p_entity text, p_entity_id text default null, p_meta jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  insert into public.audit_log (user_id, action, entity, entity_id, meta)
  values (auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_meta, '{}'::jsonb));
end $$;

-- Reveal unmasked contact details. Always audited.
create or replace function public.reveal_patient_contact(p_patient_id uuid)
returns table (phone text, email text, policy_number text)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_access_patient(p_patient_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  insert into public.audit_log (user_id, action, entity, entity_id)
  values (auth.uid(), 'REVEAL_CONTACT', 'patients', p_patient_id::text);
  return query
    select p.phone, p.email, p.policy_number from public.patients p where p.id = p_patient_id;
end $$;

-- Agent edits a point's decision: stamp who/when and audit it.
create or replace function public.on_query_point_edit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and (
       new.decision is distinct from old.decision
    or new.matched_document_id is distinct from old.matched_document_id
    or new.reason is distinct from old.reason) then
    new.edited_by_agent := true;
    new.edited_by := auth.uid();
    new.edited_at := now();
    new.needs_review := false;
    insert into public.audit_log (user_id, action, entity, entity_id, meta)
    values (auth.uid(), 'EDIT_DECISION', 'query_points', new.id::text,
            jsonb_build_object('from', old.decision, 'to', new.decision,
                               'query_letter_id', new.query_letter_id));
  end if;
  return new;
end $$;
create trigger query_points_edit before update on public.query_points
  for each row execute function public.on_query_point_edit();

-- Keep patients.last_activity_at fresh for the list sort.
create or replace function public.touch_patient_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.patients set last_activity_at = now() where id = new.patient_id;
  return new;
end $$;
create trigger documents_touch after insert on public.documents
  for each row execute function public.touch_patient_activity();
create trigger query_letters_touch after insert or update of status on public.query_letters
  for each row execute function public.touch_patient_activity();
create trigger messages_touch after insert or update of status on public.messages
  for each row execute function public.touch_patient_activity();

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.staff_users          enable row level security;
alter table public.patients             enable row level security;
alter table public.documents            enable row level security;
alter table public.query_letters        enable row level security;
alter table public.query_letter_events  enable row level security;
alter table public.query_points         enable row level security;
alter table public.messages             enable row level security;
alter table public.audit_log            enable row level security;
alter table public.app_settings         enable row level security;

-- Anonymous users get nothing.
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated, service_role;

-- staff_users
create policy staff_select on public.staff_users for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy staff_admin_write on public.staff_users for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- patients: column-level grants hide raw contact fields
revoke all on public.patients from authenticated;
grant select (id, patient_code, full_name, insurer, assigned_agent_id,
              phone_masked, email_masked, policy_masked,
              created_at, updated_at, last_activity_at) on public.patients to authenticated;
grant insert, update, delete on public.patients to authenticated;   -- admin only, via RLS
create policy patients_select on public.patients for select to authenticated
  using (public.can_access_patient(id));
create policy patients_admin_insert on public.patients for insert to authenticated
  with check (public.is_admin());
create policy patients_admin_update on public.patients for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy patients_admin_delete on public.patients for delete to authenticated
  using (public.is_admin());

-- documents: staff may upload and correct classification fields
revoke all on public.documents from authenticated;
grant select, insert, delete on public.documents to authenticated;
grant update (doc_type, doc_date, hospital, amount) on public.documents to authenticated;
create policy documents_select on public.documents for select to authenticated
  using (public.can_access_patient(patient_id));
create policy documents_insert on public.documents for insert to authenticated
  with check (public.can_access_patient(patient_id) and uploaded_by = auth.uid());
create policy documents_update on public.documents for update to authenticated
  using (public.can_access_patient(patient_id)) with check (public.can_access_patient(patient_id));
create policy documents_delete on public.documents for delete to authenticated
  using (public.is_admin());

-- query_letters: staff upload and may mark RESOLVED; the pipeline (service role) does the rest
revoke all on public.query_letters from authenticated;
grant select, insert on public.query_letters to authenticated;
grant update (status, resolved_at) on public.query_letters to authenticated;
create policy query_letters_select on public.query_letters for select to authenticated
  using (public.can_access_patient(patient_id));
create policy query_letters_insert on public.query_letters for insert to authenticated
  with check (public.can_access_patient(patient_id) and uploaded_by = auth.uid()
              and status = 'RECEIVED');
create policy query_letters_update on public.query_letters for update to authenticated
  using (public.can_access_patient(patient_id))
  with check (public.can_access_patient(patient_id) and status in ('RESOLVED', 'NEEDS_REVIEW'));

-- query_letter_events: read-only for staff
revoke all on public.query_letter_events from authenticated;
grant select on public.query_letter_events to authenticated;
create policy events_select on public.query_letter_events for select to authenticated
  using (public.can_access_query_letter(query_letter_id));

-- query_points: staff read, and may only change decision / match / reason
revoke all on public.query_points from authenticated;
grant select on public.query_points to authenticated;
grant update (decision, matched_document_id, reason) on public.query_points to authenticated;
create policy points_select on public.query_points for select to authenticated
  using (public.can_access_query_letter(query_letter_id));
create policy points_update on public.query_points for update to authenticated
  using (public.can_access_query_letter(query_letter_id))
  with check (public.can_access_query_letter(query_letter_id));

-- messages: read-only for staff (sending happens server-side with the service role)
revoke all on public.messages from authenticated;
grant select on public.messages to authenticated;
create policy messages_select on public.messages for select to authenticated
  using (public.can_access_patient(patient_id));

-- audit_log: append via log_audit() only; admins can read
revoke all on public.audit_log from authenticated;
grant select on public.audit_log to authenticated;
create policy audit_admin_select on public.audit_log for select to authenticated
  using (public.is_admin());

-- app_settings
revoke all on public.app_settings from authenticated;
grant select on public.app_settings to authenticated;
grant update (auto_send, updated_by, updated_at) on public.app_settings to authenticated;
create policy settings_select on public.app_settings for select to authenticated
  using (public.is_staff());
create policy settings_admin_update on public.app_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- =============================================================================
-- Patient overview view (list screen). security_invoker => RLS + column grants apply.
-- Needs-review first, then most recent activity.
-- =============================================================================
create view public.patient_overview with (security_invoker = true) as
select
  p.id, p.patient_code, p.full_name, p.insurer, p.assigned_agent_id,
  p.phone_masked, p.email_masked, p.last_activity_at,
  lq.id          as latest_query_id,
  lq.status      as latest_query_status,
  lq.received_at as latest_query_received_at,
  (select count(*) from public.documents d where d.patient_id = p.id) as document_count,
  case when lq.status = 'NEEDS_REVIEW' then 0
       when lq.status in ('FAILED', 'PARTIALLY_SENT') then 1
       when lq.status in ('RECEIVED', 'PROCESSING') then 2
       else 3 end as sort_rank
from public.patients p
left join lateral (
  select q.id, q.status, q.received_at
  from public.query_letters q
  where q.patient_id = p.id
  order by q.received_at desc
  limit 1
) lq on true;
grant select on public.patient_overview to authenticated;

-- =============================================================================
-- Storage: one PRIVATE bucket. Object path = '<patient_id>/<documents|queries>/<uuid>-<file>'
-- Staff only reach files through 60-second signed URLs created server-side.
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('patient-files', 'patient-files', false, 26214400,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/tiff'])
on conflict (id) do update set public = false;

create policy patient_files_select on storage.objects for select to authenticated
  using (bucket_id = 'patient-files'
         and public.can_access_patient(public.try_uuid((storage.foldername(name))[1])));
create policy patient_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'patient-files'
              and (storage.foldername(name))[2] in ('documents', 'queries')
              and public.can_access_patient(public.try_uuid((storage.foldername(name))[1])));
create policy patient_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'patient-files' and public.is_admin());

-- =============================================================================
-- Realtime (Processing view + live status chips). Realtime honours RLS.
-- =============================================================================
alter publication supabase_realtime add table
  public.query_letters, public.query_letter_events, public.query_points, public.messages;
