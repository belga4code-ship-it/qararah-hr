-- Preserve a useful change history without copying salary, identity, or raw ZKT data.
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  entity_table text not null,
  entity_id uuid not null,
  employee_id uuid references public.employees(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  changed_fields text[] not null default '{}',
  old_data jsonb,
  new_data jsonb,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_created_at_idx on public.audit_log(created_at desc);
create index if not exists audit_log_branch_created_at_idx on public.audit_log(branch_id, created_at desc);
create index if not exists audit_log_entity_idx on public.audit_log(entity_table, entity_id, created_at desc);

alter table public.audit_log enable row level security;
drop policy if exists "HR read audit log" on public.audit_log;
create policy "HR read audit log" on public.audit_log
for select to authenticated
using (public.current_app_role() in ('admin', 'hr'));

revoke insert, update, delete on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

create or replace function public.capture_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_old jsonb;
  v_new jsonb;
  v_id uuid;
  v_employee_id uuid;
  v_branch_id uuid;
  v_fields text[];
begin
  if tg_op <> 'INSERT' then
    v_row := to_jsonb(old);
    if tg_table_name = 'profiles' then
      v_old := v_row - array['created_at'];
    elsif tg_table_name = 'employees' then
      v_old := v_row - array['phone', 'email', 'created_at', 'updated_at'];
    elsif tg_table_name = 'hr_events' then
      v_old := v_row - array['details', 'created_at'];
    elsif tg_table_name = 'attendance_records' then
      v_old := v_row - array['raw_data', 'created_at'];
    elsif tg_table_name = 'evaluations' then
      v_old := v_row - array['notes', 'created_at'];
    end if;
  end if;

  if tg_op <> 'DELETE' then
    v_row := to_jsonb(new);
    if tg_table_name = 'profiles' then
      v_new := v_row - array['created_at'];
    elsif tg_table_name = 'employees' then
      v_new := v_row - array['phone', 'email', 'created_at', 'updated_at'];
    elsif tg_table_name = 'hr_events' then
      v_new := v_row - array['details', 'created_at'];
    elsif tg_table_name = 'attendance_records' then
      v_new := v_row - array['raw_data', 'created_at'];
    elsif tg_table_name = 'evaluations' then
      v_new := v_row - array['notes', 'created_at'];
    end if;
  end if;

  v_row := coalesce(v_new, v_old);
  v_id := (v_row ->> 'id')::uuid;
  v_employee_id := case when tg_table_name = 'employees' then v_id else nullif(v_row ->> 'employee_id', '')::uuid end;
  v_branch_id := nullif(v_row ->> 'branch_id', '')::uuid;

  if tg_op = 'UPDATE' then
    select coalesce(array_agg(k), '{}') into v_fields
    from jsonb_object_keys(coalesce(v_old, '{}'::jsonb) || coalesce(v_new, '{}'::jsonb)) as keys(k)
    where v_old -> k is distinct from v_new -> k;
  else
    select coalesce(array_agg(k), '{}') into v_fields
    from jsonb_object_keys(coalesce(v_new, v_old, '{}'::jsonb)) as keys(k);
  end if;

  insert into public.audit_log(entity_table, entity_id, employee_id, branch_id, action, changed_fields, old_data, new_data, actor_id)
  values (tg_table_name, v_id, v_employee_id, v_branch_id, tg_op, v_fields, v_old, v_new, auth.uid());

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists audit_profiles_changes on public.profiles;
create trigger audit_profiles_changes after insert or update or delete on public.profiles
for each row execute function public.capture_audit_log();

drop trigger if exists audit_employee_changes on public.employees;
create trigger audit_employee_changes after insert or update or delete on public.employees
for each row execute function public.capture_audit_log();

drop trigger if exists audit_hr_event_changes on public.hr_events;
create trigger audit_hr_event_changes after insert or update or delete on public.hr_events
for each row execute function public.capture_audit_log();

drop trigger if exists audit_attendance_changes on public.attendance_records;
create trigger audit_attendance_changes after insert or update or delete on public.attendance_records
for each row execute function public.capture_audit_log();

drop trigger if exists audit_evaluation_changes on public.evaluations;
create trigger audit_evaluation_changes after insert or update or delete on public.evaluations
for each row execute function public.capture_audit_log();
