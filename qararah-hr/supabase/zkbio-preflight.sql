-- Read-only checks. Run before approving the separate migration/deployment.
select name, to_regclass('public.' || name) is not null as exists
from (values ('employees'), ('branches'), ('attendance_records'),
  ('attendance_devices'), ('attendance_raw_logs'), ('attendance_sync_state')) t(name);

select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name in
  ('employees', 'branches', 'attendance_devices', 'attendance_raw_logs', 'attendance_sync_state')
order by table_name, ordinal_position;

-- Only counts; do not export employee names, salary or credentials.
select count(*) as duplicate_code_groups from (
  select zkt_user_id from public.employees
  where zkt_user_id is not null and btrim(zkt_user_id::text) <> ''
  group by zkt_user_id having count(*) > 1
) duplicates;

select tablename, policyname, roles, cmd
from pg_policies where schemaname = 'public'
and tablename in ('attendance_devices', 'attendance_raw_logs', 'attendance_sync_state');
