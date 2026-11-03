-- RLS / privacy tests. Run against a freshly seeded DB:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f tests/db/rls.test.sql
-- (local Supabase DB_URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres)
-- Everything runs inside one transaction and is rolled back.
\set QUIET on
begin;

create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.reset_user() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAIL: %', label; end if;
  raise notice 'ok  %', label;
end $$;
-- expect a SQL statement to raise
create function pg_temp.check_denied(stmt text, label text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'ok  % (denied: %)', label, sqlerrm;
    return;
  end;
  raise exception 'FAIL: % (statement was allowed)', label;
end $$;
grant execute on function pg_temp.as_user(uuid), pg_temp.reset_user(), pg_temp.check(boolean, text),
  pg_temp.check_denied(text, text) to authenticated, anon;

\set admin '00000000-0000-4000-8000-100000000001'
\set ravi  '00000000-0000-4000-8000-100000000002'
\set neha  '00000000-0000-4000-8000-100000000003'

-- ---------------------------------------------------------------- visibility
select pg_temp.as_user(:'admin');
select pg_temp.check((select count(*) from patients) = 10, 'admin sees all 10 patients');
select pg_temp.check((select count(*) from documents) >= 30, 'admin sees all documents');
select pg_temp.check((select count(*) from audit_log) >= 0, 'admin can read audit_log');

select pg_temp.as_user(:'ravi');
select pg_temp.check((select count(*) from patients) = 5, 'ravi sees only his 5 assigned patients');
select pg_temp.check((select count(*) from patient_overview) = 5, 'ravi overview limited to 5');
select pg_temp.check((select patient_code from patient_overview order by sort_rank, last_activity_at desc limit 1) = 'PL-100102',
                     'NEEDS_REVIEW patient floats to top');
select pg_temp.check((select count(*) from documents where patient_id = '00000000-0000-4000-8000-200000000010') = 0,
                     'ravi cannot see unassigned patient documents');
select pg_temp.check((select count(*) from query_letter_events where query_letter_id = '00000000-0000-4000-8000-400000000001') > 0,
                     'ravi sees pipeline events of his letter');
select pg_temp.check((select count(*) from audit_log) = 0, 'agent cannot read audit_log');
select pg_temp.check((select phone_masked from patients where patient_code = 'PL-100101') = '+91 ••••• •101',
                     'masked phone readable');

select pg_temp.as_user(:'neha');
select pg_temp.check((select count(*) from patients) = 4, 'neha sees only her 4 patients');
select pg_temp.check((select count(*) from query_points) = 0, 'neha sees no points from ravi''s letters');
select pg_temp.check((select count(*) from messages) = 0, 'neha sees no messages of ravi''s patients');

-- ---------------------------------------------------------------- masking + reveal
select pg_temp.as_user(:'ravi');
select pg_temp.check_denied($$select phone from patients limit 1$$, 'raw phone column is not selectable');
select pg_temp.check_denied($$select * from patients limit 1$$, 'select * on patients is blocked (hidden columns)');
select pg_temp.check((select phone from reveal_patient_contact('00000000-0000-4000-8000-200000000001')) = '+919811000101',
                     'reveal returns real phone for assigned patient');
select pg_temp.check_denied($$select * from reveal_patient_contact('00000000-0000-4000-8000-200000000006')$$,
                     'reveal denied for another agent''s patient');
select pg_temp.reset_user();
select pg_temp.check((select count(*) from audit_log where action = 'REVEAL_CONTACT'
                      and user_id = '00000000-0000-4000-8000-100000000002') = 1, 'reveal wrote exactly one audit row');

-- ---------------------------------------------------------------- writes
select pg_temp.as_user(:'ravi');
update query_points set decision = 'NEED_FROM_PATIENT', reason = 'Agent: need all daily platelet reports'
  where query_letter_id = '00000000-0000-4000-8000-400000000002' and point_no = 4;
select pg_temp.check((select edited_by_agent and edited_by = '00000000-0000-4000-8000-100000000002' and not needs_review
                      from query_points where query_letter_id = '00000000-0000-4000-8000-400000000002' and point_no = 4),
                     'agent edit stamps edited_by_agent/edited_by and clears needs_review');
select pg_temp.check_denied($$update query_points set confidence = 1 where point_no = 1$$, 'agent cannot change confidence');
with u as (update patients set full_name = 'X' returning 1)
  select pg_temp.check(count(*) = 0, 'agent update on patients affects 0 rows (admin only)') from u;
select pg_temp.check_denied($$insert into messages (patient_id, channel, idempotency_key, body)
  values ('00000000-0000-4000-8000-200000000001', 'EMAIL', 'x', 'y')$$, 'agent cannot insert messages');
select pg_temp.check_denied($$insert into audit_log (action, entity) values ('FAKE', 'x')$$, 'agent cannot write audit_log directly');
select pg_temp.check_denied($$insert into query_letters (patient_id, file_path, uploaded_by)
  values ('00000000-0000-4000-8000-200000000006', 'p6/queries/x.pdf', '00000000-0000-4000-8000-100000000002')$$,
  'agent cannot create a letter for another agent''s patient');
insert into query_letters (patient_id, file_path, uploaded_by)
  values ('00000000-0000-4000-8000-200000000001', '00000000-0000-4000-8000-200000000001/queries/test.pdf',
          '00000000-0000-4000-8000-100000000002');
select pg_temp.check(true, 'agent can upload a letter for own patient');
select log_audit('VIEW_PATIENT', 'patients', '00000000-0000-4000-8000-200000000001');
select pg_temp.check(true, 'agent can log audit via log_audit()');

-- ---------------------------------------------------------------- storage
insert into storage.objects (bucket_id, name)
  values ('patient-files', '00000000-0000-4000-8000-200000000001/documents/new.pdf');
select pg_temp.check(true, 'agent can upload into own patient folder');
select pg_temp.check_denied($$insert into storage.objects (bucket_id, name)
  values ('patient-files', '00000000-0000-4000-8000-200000000006/documents/new.pdf')$$, 'agent cannot upload to other patient folder');
select pg_temp.check_denied($$insert into storage.objects (bucket_id, name)
  values ('patient-files', 'not-a-uuid/documents/new.pdf')$$, 'garbage path rejected');
select pg_temp.check_denied($$insert into storage.objects (bucket_id, name)
  values ('patient-files', '00000000-0000-4000-8000-200000000001/other/new.pdf')$$, 'unknown sub-folder rejected');

-- ---------------------------------------------------------------- anon
select pg_temp.reset_user();
select set_config('role', 'anon', true);
select pg_temp.check_denied($$select count(*) from patient_overview$$, 'anon cannot read anything');
select pg_temp.reset_user();

select pg_temp.check((select public from storage.buckets where id = 'patient-files') = false, 'bucket is private');

\echo 'ALL RLS TESTS PASSED'
rollback;
