-- Employee requests, branch-manager actions, and head-office approvals.
-- Apply after schema.sql and the employee-roster migration.


alter table public.profiles
  add column if not exists employee_id uuid references public.employees(id) on delete set null;

create unique index if not exists profiles_employee_id_unique
  on public.profiles(employee_id) where employee_id is not null;

alter table public.hr_events
  add column if not exists status text not null default 'approved',
  add column if not exists decision_reason text,
  add column if not exists decision_by uuid references public.profiles(id),
  add column if not exists decision_at timestamptz,
  add column if not exists payroll_recorded_at timestamptz,
  add column if not exists payroll_recorded_by uuid references public.profiles(id);

alter table public.hr_events drop constraint if exists hr_events_status_check;
alter table public.hr_events add constraint hr_events_status_check
  check (status in ('pending', 'approved', 'rejected'));

create index if not exists hr_events_status_date_idx
  on public.hr_events(status, effective_date desc);

create or replace function public.current_employee_id()
returns uuid
language sql stable security definer
set search_path = public
as $$ select employee_id from public.profiles where id = auth.uid() $$;

drop policy if exists "branch scoped events read" on public.hr_events;
drop policy if exists "role scoped events read" on public.hr_events;
create policy "role scoped events read" on public.hr_events
for select to authenticated
using (
  public.current_app_role() in ('admin', 'hr')
  or (public.current_app_role() = 'branch_manager' and branch_id = public.current_branch_id())
  or (public.current_app_role() = 'employee' and employee_id = public.current_employee_id())
);

drop policy if exists "HR manage events" on public.hr_events;
drop policy if exists "HR insert events" on public.hr_events;
drop policy if exists "HR update events" on public.hr_events;
drop policy if exists "HR delete events" on public.hr_events;
create policy "HR insert events" on public.hr_events
for insert to authenticated
with check (public.current_app_role() in ('admin', 'hr'));
create policy "HR update events" on public.hr_events
for update to authenticated
using (public.current_app_role() in ('admin', 'hr'))
with check (public.current_app_role() in ('admin', 'hr'));

drop policy if exists "employees submit own requests" on public.hr_events;
create policy "employees submit own requests" on public.hr_events
for insert to authenticated
with check (
  public.current_app_role() = 'employee'
  and employee_id = public.current_employee_id()
  and branch_id = public.current_branch_id()
  and created_by = auth.uid()
  and status = 'pending'
  and approved_by is null
  and approved_at is null
  and event_type in ('leave', 'late_permission', 'permission', 'mission')
  and nullif(trim(reason), '') is not null
  and (end_date is null or end_date >= effective_date)
);

drop policy if exists "branch managers submit deduction requests" on public.hr_events;
create policy "branch managers submit deduction requests" on public.hr_events
for insert to authenticated
with check (
  public.current_app_role() = 'branch_manager'
  and branch_id = public.current_branch_id()
  and created_by = auth.uid()
  and status = 'pending'
  and approved_by is null
  and approved_at is null
  and event_type = 'deduction'
  and amount > 0
  and nullif(trim(reason), '') is not null
  and exists (
    select 1 from public.employees e
    where e.id = employee_id and e.branch_id = public.current_branch_id()
  )
);

create or replace function public.record_hr_event_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'pending' and new.status in ('approved', 'rejected') then
    if public.current_app_role() not in ('admin', 'hr') then
      raise exception 'Only head office can decide on requests';
    end if;
    if nullif(trim(new.decision_reason), '') is null then
      raise exception 'A decision reason is required';
    end if;

    new.decision_by := auth.uid();
    new.decision_at := now();
    if new.status = 'approved' then
      new.approved_by := auth.uid();
      new.approved_at := now();
      if new.event_type = 'deduction' then
        new.payroll_recorded_at := now();
        new.payroll_recorded_by := auth.uid();
      end if;
    else
      new.approved_by := null;
      new.approved_at := null;
      new.payroll_recorded_at := null;
      new.payroll_recorded_by := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists hr_event_decision_audit on public.hr_events;
create trigger hr_event_decision_audit
before update of status on public.hr_events
for each row execute function public.record_hr_event_decision();

create or replace function public.manager_create_employee(
  p_employee_number text,
  p_full_name text,
  p_job_title_id uuid,
  p_hired_on date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_id uuid;
  v_employee_id uuid;
  v_full_name text := trim(p_full_name);
  v_number text := trim(p_employee_number);
begin
  select branch_id into v_branch_id
  from public.profiles
  where id = auth.uid() and role = 'branch_manager';

  if v_branch_id is null then
    raise exception 'Only a branch manager with an assigned branch can add employees';
  end if;
  if nullif(v_number, '') is null or nullif(v_full_name, '') is null then
    raise exception 'Employee number and full name are required';
  end if;
  if p_job_title_id is not null and not exists (
    select 1 from public.job_titles where id = p_job_title_id
  ) then
    raise exception 'The selected job title does not exist';
  end if;

  insert into public.employees(employee_number, first_name, full_name, branch_id, job_title_id, hired_on, status)
  values (v_number, split_part(v_full_name, ' ', 1), v_full_name, v_branch_id, p_job_title_id, p_hired_on, 'active')
  returning id into v_employee_id;

  insert into public.hr_events(
    employee_id, branch_id, event_type, effective_date, reason, details,
    created_by, approved_by, approved_at, status, decision_by, decision_at, decision_reason
  ) values (
    v_employee_id, v_branch_id, 'new_hire', coalesce(p_hired_on, (now() at time zone 'Africa/Tripoli')::date),
    'تعيين جديد بواسطة مدير الفرع', jsonb_build_object('employee_number', v_number),
    auth.uid(), auth.uid(), now(), 'approved', auth.uid(), now(), 'تم تسجيل التعيين من مدير الفرع'
  );

  return v_employee_id;
end;
$$;

revoke all on function public.manager_create_employee(text, text, uuid, date) from public;
grant execute on function public.manager_create_employee(text, text, uuid, date) to authenticated;

create or replace function public.manager_terminate_employee(
  p_employee_id uuid,
  p_effective_date date,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_id uuid;
begin
  select branch_id into v_branch_id
  from public.profiles
  where id = auth.uid() and role = 'branch_manager';

  if v_branch_id is null then
    raise exception 'Only a branch manager with an assigned branch can terminate employees';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'A termination reason is required';
  end if;
  if p_effective_date is null or p_effective_date > (now() at time zone 'Africa/Tripoli')::date then
    raise exception 'Termination date must be today or earlier';
  end if;

  update public.employees
  set status = 'terminated', updated_at = now()
  where id = p_employee_id and branch_id = v_branch_id and status <> 'terminated';

  if not found then
    raise exception 'Employee was not found in your branch or is already terminated';
  end if;

  insert into public.hr_events(
    employee_id, branch_id, event_type, effective_date, reason, created_by,
    approved_by, approved_at, status, decision_by, decision_at, decision_reason
  ) values (
    p_employee_id, v_branch_id, 'termination', p_effective_date, trim(p_reason), auth.uid(),
    auth.uid(), now(), 'approved', auth.uid(), now(), 'تم تسجيل إنهاء الخدمة بواسطة مدير الفرع'
  );
end;
$$;

revoke all on function public.manager_terminate_employee(uuid, date, text) from public;
grant execute on function public.manager_terminate_employee(uuid, date, text) to authenticated;
