-- =============================================================================
-- Patient Locker — pipeline support (phases 3–6)
-- =============================================================================

-- Why the insurer needs each item (from the extract step), kept separate from the
-- match step's `reason` so the patient message can say "why" in simple words.
alter table public.query_points add column if not exists why_needed text;
-- Short quote from the letter proving the insurer explicitly asked for a fresh/clear copy.
alter table public.query_points add column if not exists rerequest_quote text;

-- Claim reference read from the letter (used in the message).
alter table public.query_letters add column if not exists claim_ref text;
alter table public.query_letters add column if not exists insurer_name text;
-- Set when an agent edits a decision after the last message went out:
-- drives the "Send corrected message" button.
alter table public.query_letters add column if not exists needs_correction boolean not null default false;
alter table public.query_letters add column if not exists pipeline_ms int;

-- Draft = composed but not sent because auto-send is OFF (waits for agent approval).
alter type public.message_status add value if not exists 'DRAFT' before 'QUEUED';
alter type public.message_status add value if not exists 'SKIPPED';

-- Twilio delivery callbacks
alter table public.messages add column if not exists delivered_at timestamptz;

-- When an agent edits a point, flag the letter so a corrected message can be sent.
create or replace function public.flag_letter_needs_correction()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.edited_by_agent and (
       new.decision is distinct from old.decision
    or new.matched_document_id is distinct from old.matched_document_id) then
    update public.query_letters set needs_correction = true where id = new.query_letter_id;
  end if;
  return new;
end $$;
drop trigger if exists query_points_flag_correction on public.query_points;
create trigger query_points_flag_correction after update on public.query_points
  for each row execute function public.flag_letter_needs_correction();

-- Next message revision for a letter (corrections / resends never reuse a key).
create or replace function public.next_message_revision(p_query_letter_id uuid)
returns int language sql stable security definer set search_path = '' as $$
  select coalesce(max(revision), 0) + 1 from public.messages where query_letter_id = p_query_letter_id
$$;
revoke execute on function public.next_message_revision(uuid) from public, anon, authenticated;
grant execute on function public.next_message_revision(uuid) to service_role;

-- Staff may only *see* needs_correction; the pipeline clears it.
grant select on public.query_letters to authenticated;

-- Documents change status when classification finishes; let the profile page update live.
alter publication supabase_realtime add table public.documents;
