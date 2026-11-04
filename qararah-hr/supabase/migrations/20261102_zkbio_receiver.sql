-- Apply after 20261031_zkbio_attendance_ingest.sql.
-- No attendance_records or payroll writes. All batches commit atomically.
begin;

revoke all on public.attendance_devices, public.attendance_raw_logs, public.attendance_sync_state from anon, authenticated;
grant select on public.attendance_devices, public.attendance_raw_logs, public.attendance_sync_state to authenticated;
grant all on public.attendance_devices, public.attendance_raw_logs, public.attendance_sync_state to service_role;

drop policy if exists zkbio_hr_read on public.attendance_devices;
create policy zkbio_hr_read on public.attendance_devices for select to authenticated
using (public.current_user_has_role('admin') or public.current_user_has_role('hr'));
drop policy if exists zkbio_hr_read on public.attendance_raw_logs;
create policy zkbio_hr_read on public.attendance_raw_logs for select to authenticated
using (public.current_user_has_role('admin') or public.current_user_has_role('hr'));
drop policy if exists zkbio_hr_read on public.attendance_sync_state;
create policy zkbio_hr_read on public.attendance_sync_state for select to authenticated
using (public.current_user_has_role('admin') or public.current_user_has_role('hr'));

create or replace function public.ingest_zkbio_attendance(p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = public
as $$
declare
  v_accepted integer;
  v_unmatched integer;
  v_ambiguous integer;
  v_records jsonb := p_payload->'records';
begin
  if p_payload->>'source_id' is distinct from 'zkbio-central'
    or jsonb_typeof(v_records) is distinct from 'array'
    or jsonb_typeof(p_payload->'devices') is distinct from 'array'
    or jsonb_array_length(v_records) > 500
    or jsonb_array_length(p_payload->'devices') > 100
    or (p_payload->>'window_start')::timestamptz > (p_payload->>'window_end')::timestamptz
  then raise exception 'Invalid synchronization payload'; end if;

  perform pg_advisory_xact_lock(hashtext('zkbio-central'));
  insert into attendance_devices(serial_number,device_name,last_seen_at,external_status_code,raw_payload,updated_at)
  select d.serial_number,d.device_name,d.last_activity_at,d.external_status_code,coalesce(d.raw_payload,'{}'::jsonb),now()
  from jsonb_to_recordset(p_payload->'devices') d(serial_number text,device_name text,last_activity_at timestamptz,external_status_code text,raw_payload jsonb)
  on conflict(serial_number) do update set device_name=excluded.device_name,
    last_seen_at=excluded.last_seen_at,external_status_code=excluded.external_status_code,
    raw_payload=excluded.raw_payload,updated_at=now();

  -- A punch can arrive before the terminal list. Keep its serial for later mapping.
  insert into attendance_devices(serial_number)
  select distinct r->>'device_serial' from jsonb_array_elements(v_records) r
  on conflict(serial_number) do nothing;

  -- Only exact, unique branch names can establish an initial device mapping.
  -- Existing reviewed serial-to-branch mappings always take precedence.
  update attendance_devices d set branch_id=b.id
  from (select name,(array_agg(id))[1] as id from branches group by name having count(*)=1) b
  where d.branch_id is null and d.device_name=b.name
    and d.serial_number in (select r->>'serial_number' from jsonb_array_elements(p_payload->'devices') r);

  with incoming as (
    select r.*, m.employee_id, m.matches, d.id as device_id, d.branch_id
    from jsonb_to_recordset(v_records) r(sync_key text,external_record_id text,external_employee_id text,device_serial text,punch_time timestamptz,punch_type text,raw_payload jsonb)
    join attendance_devices d on d.serial_number=r.device_serial
    cross join lateral (
      select case when count(*)=1 then (array_agg(e.id))[1] end as employee_id,count(*) as matches
      from employees e where e.zkt_user_id::text=r.external_employee_id
    ) m
  ), inserted as (
    insert into attendance_raw_logs(source_system,sync_key,external_record_id,external_employee_id,employee_id,device_id,branch_id,punch_time,punch_type,raw_payload)
    select 'zkbio',sync_key,external_record_id,external_employee_id,employee_id,device_id,branch_id,punch_time,punch_type,coalesce(raw_payload,'{}'::jsonb) from incoming
    on conflict(source_system,sync_key) do nothing returning id
  )
  select (select count(*) from inserted),
    (select count(*) from incoming where employee_id is null),
    (select count(distinct external_employee_id) from incoming where matches>1)
  into v_accepted,v_unmatched,v_ambiguous;

  if (p_payload->>'complete_window')::boolean then
    insert into attendance_sync_state(source_id,last_successful_sync,cursor,status,last_error,updated_at)
    values('zkbio-central',(p_payload->>'window_end')::timestamptz,
      jsonb_build_object('window_start',p_payload->>'window_start','window_end',p_payload->>'window_end'),'ok',null,now())
    on conflict(source_id) do update set
      last_successful_sync=greatest(attendance_sync_state.last_successful_sync,excluded.last_successful_sync),
      cursor=case when attendance_sync_state.last_successful_sync is null or excluded.last_successful_sync>=attendance_sync_state.last_successful_sync then excluded.cursor else attendance_sync_state.cursor end,
      status='ok',last_error=null,updated_at=now();
  end if;
  return jsonb_build_object('accepted',v_accepted,'duplicates',jsonb_array_length(v_records)-v_accepted,
    'unmatched',v_unmatched,'ambiguous_employee_codes',v_ambiguous,'complete_window',(p_payload->>'complete_window')::boolean);
end;
$$;
revoke all on function public.ingest_zkbio_attendance(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_zkbio_attendance(jsonb) to service_role;
commit;
