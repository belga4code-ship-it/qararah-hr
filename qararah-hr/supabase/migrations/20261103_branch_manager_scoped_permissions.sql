-- Branch managers receive their operational permissions from their role.
-- Keep those permissions scoped to their assigned branch at the database layer.

drop policy if exists "role and permission scoped employee read" on public.employees;
create policy "role and permission scoped employee read" on public.employees
for select to authenticated using (
  public.current_user_has_role('admin')
  or public.current_user_has_role('hr')
  or public.current_user_has_role('auditor')
  or (
    (public.current_user_has_permission('employees.view_all')
      or public.current_user_has_permission('employees.edit')
      or public.current_user_has_permission('employees.manage_accounts')
      or public.current_user_has_permission('goals.view_all')
      or public.current_user_has_permission('goals.manage')
      or public.current_user_has_permission('evaluations.view_all')
      or public.current_user_has_permission('evaluations.evaluate')
      or public.current_user_has_permission('evaluations.assign')
      or public.current_user_has_permission('reports.view_all')
      or public.current_user_has_permission('reports.export'))
    and (not public.current_user_has_role('branch_manager') or branch_id = public.current_branch_id())
  )
  or ((public.current_user_has_role('branch_manager') or public.current_user_has_role('accountant') or public.current_user_has_role('yard_supervisor')) and branch_id = public.current_branch_id())
  or (public.current_user_has_role('employee') and id = public.current_employee_id())
  or (public.is_employee_evaluator(id) and (not public.current_user_has_role('branch_manager') or branch_id = public.current_branch_id()))
);

drop policy if exists "role and permission scoped attendance read" on public.attendance_records;
create policy "role and permission scoped attendance read" on public.attendance_records
for select to authenticated using (
  public.current_user_has_role('admin') or public.current_user_has_role('hr') or public.current_user_has_role('auditor')
  or ((public.current_user_has_permission('attendance.view_all') or public.current_user_has_permission('reports.view_all') or public.current_user_has_permission('reports.export'))
    and (not public.current_user_has_role('branch_manager') or branch_id = public.current_branch_id()))
  or ((public.current_user_has_role('branch_manager') or public.current_user_has_role('accountant') or public.current_user_has_role('yard_supervisor')) and branch_id = public.current_branch_id())
  or (public.current_user_has_role('employee') and employee_id = public.current_employee_id())
);

drop policy if exists "role and permission scoped attendance imports read" on public.attendance_imports;
create policy "role and permission scoped attendance imports read" on public.attendance_imports
for select to authenticated using (
  public.current_user_has_role('admin') or public.current_user_has_role('hr') or public.current_user_has_role('auditor')
  or ((public.current_user_has_permission('attendance.view_all') or public.current_user_has_permission('reports.view_all') or public.current_user_has_permission('reports.export'))
    and (not public.current_user_has_role('branch_manager') or branch_id = public.current_branch_id()))
  or ((public.current_user_has_role('branch_manager') or public.current_user_has_role('accountant') or public.current_user_has_role('yard_supervisor')) and branch_id = public.current_branch_id())
);
drop policy if exists "extra permission manage attendance" on public.attendance_records;
create policy "extra permission manage attendance" on public.attendance_records for all to authenticated
using (public.current_user_has_permission('attendance.manage') and (not public.current_user_has_role('branch_manager') or branch_id = public.current_branch_id()))
with check (public.current_user_has_permission('attendance.manage') and (not public.current_user_has_role('branch_manager') or branch_id = public.current_branch_id()));
drop policy if exists "extra permission manage attendance imports" on public.attendance_imports;
create policy "extra permission manage attendance imports" on public.attendance_imports for all to authenticated
using (public.current_user_has_permission('attendance.import') and (not public.current_user_has_role('branch_manager') or branch_id = public.current_branch_id()))
with check (public.current_user_has_permission('attendance.import') and (not public.current_user_has_role('branch_manager') or branch_id = public.current_branch_id()));

drop policy if exists "role and permission scoped events read" on public.hr_events;
create policy "role and permission scoped events read" on public.hr_events
for select to authenticated using (
  public.current_user_has_role('admin') or public.current_user_has_role('hr') or public.current_user_has_role('auditor')
  or ((public.current_user_has_permission('effects.view_all') or public.current_user_has_permission('reports.view_all') or public.current_user_has_permission('reports.export'))
    and (not public.current_user_has_role('branch_manager') or branch_id = public.current_branch_id()))
  or (public.current_user_has_role('branch_manager') and branch_id = public.current_branch_id())
  or (public.current_user_has_role('employee') and employee_id = public.current_employee_id())
);
drop policy if exists "extra permission read all hr events" on public.hr_events;
create policy "extra permission read all hr events" on public.hr_events for select to authenticated
using (public.current_user_has_permission('effects.view_all') and (not public.current_user_has_role('branch_manager') or branch_id = public.current_branch_id()));
drop policy if exists "extra permission create hr events" on public.hr_events;
create policy "extra permission create hr events" on public.hr_events for insert to authenticated
with check (
  public.current_user_has_permission('effects.create')
  and (not public.current_user_has_role('branch_manager') or (branch_id = public.current_branch_id() and exists (select 1 from public.employees e where e.id = employee_id and e.branch_id = public.current_branch_id())))
);
drop policy if exists "extra permission record approved deductions" on public.hr_events;
create policy "extra permission record approved deductions" on public.hr_events for insert to authenticated
with check (
  (public.current_user_has_role('auditor') or public.current_user_has_permission('effects.manage_deductions'))
  and event_type = 'deduction' and status = 'approved' and amount > 0
  and created_by = auth.uid() and approved_by = auth.uid() and decision_by = auth.uid() and payroll_recorded_by = auth.uid()
  and exists (select 1 from public.employees e where e.id = employee_id and e.branch_id = hr_events.branch_id
    and (not public.current_user_has_role('branch_manager') or e.branch_id = public.current_branch_id()))
);
drop policy if exists "extra permission decide hr events" on public.hr_events;
create policy "extra permission decide hr events" on public.hr_events for update to authenticated
using (
  (public.current_user_has_permission('effects.approve') or public.current_user_has_permission('effects.manage_deductions'))
  and (not public.current_user_has_role('branch_manager') or branch_id = public.current_branch_id())
)
with check (
  (public.current_user_has_permission('effects.approve') or public.current_user_has_permission('effects.manage_deductions'))
  and (not public.current_user_has_role('branch_manager') or branch_id = public.current_branch_id())
);

-- A branch manager can submit a leave, permission, or late request for any
-- employee in their branch. Approval still follows the employee's assigned route.
drop policy if exists "employees submit own requests" on public.hr_events;
create policy "employees submit own requests" on public.hr_events
for insert to authenticated with check (
  branch_id = public.current_branch_id()
  and created_by = auth.uid()
  and status = 'pending'
  and approved_by is null and approved_at is null
  and event_type in ('leave', 'late_permission', 'permission', 'mission')
  and nullif(trim(reason), '') is not null
  and (end_date is null or end_date >= effective_date)
  and (
    (public.current_user_has_role('employee') and employee_id = public.current_employee_id())
    or (public.current_user_has_role('branch_manager') and exists (select 1 from public.employees e where e.id = employee_id and e.branch_id = public.current_branch_id()))
  )
);

-- Branch staff may file a workplace report on behalf of someone in their branch.
alter table public.employee_reports add column if not exists submitted_by uuid references public.profiles(id) on delete set null;
drop policy if exists "Employees read own reports" on public.employee_reports;
drop policy if exists "HR update employee reports" on public.employee_reports;
drop policy if exists "extra permission view all employee reports" on public.employee_reports;
drop policy if exists "extra permission create employee reports" on public.employee_reports;
drop policy if exists "Branch scoped employee reports read" on public.employee_reports;
create policy "Branch scoped employee reports read" on public.employee_reports for select to authenticated
using (
  public.current_user_has_role('admin') or public.current_user_has_role('hr')
  or (public.current_user_has_role('branch_manager') and branch_id = public.current_branch_id())
  or (public.current_user_has_permission('reports.view_all') and (not public.current_user_has_role('branch_manager') or branch_id = public.current_branch_id()))
  or (employee_id = public.current_employee_id())
);
drop policy if exists "Branch scoped employee reports insert" on public.employee_reports;
create policy "Branch scoped employee reports insert" on public.employee_reports for insert to authenticated
with check (
  branch_id = public.current_branch_id()
  and submitted_by = auth.uid()
  and ((public.current_user_has_role('employee') and employee_id = public.current_employee_id())
    or (public.current_user_has_role('branch_manager') and exists (select 1 from public.employees e where e.id = employee_id and e.branch_id = public.current_branch_id())))
);
create policy "HR update employee reports" on public.employee_reports for update to authenticated
using (public.current_user_has_role('admin') or public.current_user_has_role('hr'))
with check (public.current_user_has_role('admin') or public.current_user_has_role('hr'));

-- Keep unrestricted edit grants branch-scoped when the account also has the manager role.
drop policy if exists "extra permission edit employees" on public.employees;
create policy "extra permission edit employees" on public.employees for update to authenticated
using (public.current_user_has_permission('employees.edit') and (not public.current_user_has_role('branch_manager') or branch_id = public.current_branch_id()))
with check (public.current_user_has_permission('employees.edit') and (not public.current_user_has_role('branch_manager') or branch_id = public.current_branch_id()));

drop policy if exists "extra permission read private employee data" on public.employee_private;
create policy "extra permission read private employee data" on public.employee_private for select to authenticated
using (public.current_user_has_permission('employees.view_sensitive') and (not public.current_user_has_role('branch_manager') or exists (select 1 from public.employees e where e.id = employee_private.employee_id and e.branch_id = public.current_branch_id())));
drop policy if exists "extra permission edit private employee data" on public.employee_private;
create policy "extra permission edit private employee data" on public.employee_private for all to authenticated
using (public.current_user_has_permission('employees.edit') and (not public.current_user_has_role('branch_manager') or exists (select 1 from public.employees e where e.id = employee_private.employee_id and e.branch_id = public.current_branch_id())))
with check (public.current_user_has_permission('employees.edit') and (not public.current_user_has_role('branch_manager') or exists (select 1 from public.employees e where e.id = employee_private.employee_id and e.branch_id = public.current_branch_id())));

drop policy if exists "extra permission view all goals" on public.employee_goals;
create policy "extra permission view all goals" on public.employee_goals for select to authenticated
using (public.current_user_has_permission('goals.view_all') and (not public.current_user_has_role('branch_manager') or exists (select 1 from public.employees e where e.id = employee_goals.employee_id and e.branch_id = public.current_branch_id())));
drop policy if exists "extra permission manage goals" on public.employee_goals;
create policy "extra permission manage goals" on public.employee_goals for all to authenticated
using (public.current_user_has_permission('goals.manage') and (not public.current_user_has_role('branch_manager') or exists (select 1 from public.employees e where e.id = employee_goals.employee_id and e.branch_id = public.current_branch_id())))
with check (public.current_user_has_permission('goals.manage') and (not public.current_user_has_role('branch_manager') or exists (select 1 from public.employees e where e.id = employee_goals.employee_id and e.branch_id = public.current_branch_id())));

drop policy if exists "extra permission create evaluations" on public.evaluations;
create policy "extra permission create evaluations" on public.evaluations for all to authenticated
using ((public.current_user_has_permission('evaluations.evaluate') or public.current_user_has_permission('evaluations.assign'))
  and (not public.current_user_has_role('branch_manager') or branch_id = public.current_branch_id()))
with check ((public.current_user_has_permission('evaluations.evaluate') or public.current_user_has_permission('evaluations.assign'))
  and (not public.current_user_has_role('branch_manager') or branch_id = public.current_branch_id()));
drop policy if exists "role and permission scoped evaluation read" on public.evaluations;
create policy "role and permission scoped evaluation read" on public.evaluations for select to authenticated
using (employee_id = public.current_employee_id()
  or public.current_user_has_role('admin') or public.current_user_has_role('hr') or public.current_user_has_role('auditor')
  or (public.current_user_has_permission('evaluations.view_all') and (not public.current_user_has_role('branch_manager') or branch_id = public.current_branch_id())));
drop policy if exists "assigned evaluators read assigned employees" on public.employees;
create policy "assigned evaluators read assigned employees" on public.employees for select to authenticated
using (public.is_employee_evaluator(id) and (not public.current_user_has_role('branch_manager') or branch_id = public.current_branch_id()));
drop policy if exists "HR and assigned evaluators read evaluations" on public.evaluations;
create policy "HR and assigned evaluators read evaluations" on public.evaluations for select to authenticated
using (public.current_user_has_role('admin') or public.current_user_has_role('hr')
  or (public.is_employee_evaluator(employee_id) and (not public.current_user_has_role('branch_manager') or branch_id = public.current_branch_id())));
drop policy if exists "assigned evaluators create evaluations" on public.evaluations;
create policy "assigned evaluators create evaluations" on public.evaluations for insert to authenticated
with check (evaluator_id = auth.uid() and public.is_employee_evaluator(employee_id)
  and (not public.current_user_has_role('branch_manager') or branch_id = public.current_branch_id()));
drop policy if exists "assigned evaluators update own evaluations" on public.evaluations;
create policy "assigned evaluators update own evaluations" on public.evaluations for update to authenticated
using (evaluator_id = auth.uid() and public.is_employee_evaluator(employee_id)
  and (not public.current_user_has_role('branch_manager') or branch_id = public.current_branch_id()))
with check (evaluator_id = auth.uid() and public.is_employee_evaluator(employee_id)
  and (not public.current_user_has_role('branch_manager') or branch_id = public.current_branch_id()));
drop policy if exists "extra permission read evaluation items" on public.evaluation_items;
create policy "extra permission read evaluation items" on public.evaluation_items for select to authenticated
using (public.current_user_has_permission('evaluations.view_all') and exists (select 1 from public.evaluations ev where ev.id = evaluation_items.evaluation_id and (not public.current_user_has_role('branch_manager') or ev.branch_id = public.current_branch_id())));
drop policy if exists "extra permission manage evaluation items" on public.evaluation_items;
create policy "extra permission manage evaluation items" on public.evaluation_items for all to authenticated
using (public.current_user_has_permission('evaluations.evaluate') and exists (select 1 from public.evaluations ev where ev.id = evaluation_items.evaluation_id and (not public.current_user_has_role('branch_manager') or ev.branch_id = public.current_branch_id())))
with check (public.current_user_has_permission('evaluations.evaluate') and exists (select 1 from public.evaluations ev where ev.id = evaluation_items.evaluation_id and (not public.current_user_has_role('branch_manager') or ev.branch_id = public.current_branch_id())));
drop policy if exists "HR and assigned evaluators read evaluation items" on public.evaluation_items;
create policy "HR and assigned evaluators read evaluation items" on public.evaluation_items for select to authenticated
using (exists (select 1 from public.evaluations ev where ev.id = evaluation_items.evaluation_id and
  (public.current_user_has_role('admin') or public.current_user_has_role('hr')
    or (public.is_employee_evaluator(ev.employee_id) and (not public.current_user_has_role('branch_manager') or ev.branch_id = public.current_branch_id())))));
drop policy if exists "extra permission manage evaluator assignments" on public.employee_evaluators;
create policy "extra permission manage evaluator assignments" on public.employee_evaluators for all to authenticated
using (public.current_user_has_permission('evaluations.assign') and (not public.current_user_has_role('branch_manager') or exists (select 1 from public.employees e where e.id = employee_evaluators.employee_id and e.branch_id = public.current_branch_id())))
with check (public.current_user_has_permission('evaluations.assign') and (not public.current_user_has_role('branch_manager') or exists (select 1 from public.employees e where e.id = employee_evaluators.employee_id and e.branch_id = public.current_branch_id())));
drop policy if exists "extra permission read evaluator assignments" on public.employee_evaluators;
create policy "extra permission read evaluator assignments" on public.employee_evaluators for select to authenticated
using ((public.current_user_has_permission('evaluations.view_all') or public.current_user_has_permission('evaluations.evaluate') or public.current_user_has_permission('evaluations.assign'))
  and (not public.current_user_has_role('branch_manager') or exists (select 1 from public.employees e where e.id = employee_evaluators.employee_id and e.branch_id = public.current_branch_id())));
drop policy if exists "extra permission read audit log" on public.audit_log;
create policy "extra permission read audit log" on public.audit_log for select to authenticated
using (public.current_user_has_permission('audit.view') and (not public.current_user_has_role('branch_manager') or branch_id = public.current_branch_id()));

create or replace function public.submit_employee_evaluation(
  p_employee_id uuid, p_period_month date, p_notes text, p_items jsonb
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_branch_id uuid;
  v_evaluation_id uuid;
  v_month date := date_trunc('month', p_period_month)::date;
  v_total numeric(6,2);
  v_max numeric(6,2);
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'At least one scored evaluation item is required'; end if;
  if not exists (select 1 from public.employee_evaluators ee where ee.employee_id = p_employee_id and ee.evaluator_profile_id = auth.uid())
    and not public.current_user_has_permission('evaluations.evaluate') and not public.current_user_has_role('auditor') then
    raise exception 'You are not assigned to evaluate this employee';
  end if;
  select branch_id into v_branch_id from public.employees where id = p_employee_id;
  if v_branch_id is null then raise exception 'Employee was not found'; end if;
  if public.current_user_has_role('branch_manager') and v_branch_id is distinct from public.current_branch_id() then raise exception 'Branch managers can evaluate employees in their branch only'; end if;
  select sum((item->>'score')::numeric), sum(coalesce((item->>'max_score')::numeric, 4)) into v_total, v_max from jsonb_array_elements(p_items) item;
  if exists (select 1 from jsonb_array_elements(p_items) item where coalesce((item->>'score')::integer, 0) not between 1 and 4 or coalesce((item->>'max_score')::integer, 4) not between 1 and 4 or nullif(trim(item->>'criterion'), '') is null) then raise exception 'Evaluation scores and criteria are invalid'; end if;
  insert into public.evaluations(employee_id, branch_id, period_month, evaluator_id, total_score, max_score, status, notes)
  values (p_employee_id, v_branch_id, v_month, auth.uid(), v_total, v_max, 'submitted', nullif(trim(p_notes), ''))
  on conflict (employee_id, period_month, evaluator_id) do update set total_score = excluded.total_score, max_score = excluded.max_score, status = 'submitted', notes = excluded.notes
  returning id into v_evaluation_id;
  delete from public.evaluation_items where evaluation_id = v_evaluation_id;
  insert into public.evaluation_items(evaluation_id, criterion, score, max_score, evidence)
  select v_evaluation_id, item->>'criterion', (item->>'score')::smallint, coalesce((item->>'max_score')::smallint, 4), nullif(trim(item->>'evidence'), '') from jsonb_array_elements(p_items) item;
  return v_evaluation_id;
end;
$$;
revoke all on function public.submit_employee_evaluation(uuid, date, text, jsonb) from public;
grant execute on function public.submit_employee_evaluation(uuid, date, text, jsonb) to authenticated;

-- Direct responsibility does not expand a branch manager's branch boundary.
drop policy if exists "assigned managers read direct report employee records" on public.employees;
create policy "assigned managers read direct report employee records" on public.employees for select to authenticated
using (public.current_user_manages_employee(id) and (not public.current_user_has_role('branch_manager') or branch_id = public.current_branch_id()));
drop policy if exists "assigned responsible read hr events" on public.hr_events;
create policy "assigned responsible read hr events" on public.hr_events for select to authenticated
using (public.is_assigned_hr_event_responsible(id) and (not public.current_user_has_role('branch_manager') or branch_id = public.current_branch_id()));
drop policy if exists "assigned responsible update permissions" on public.hr_events;
create policy "assigned responsible update permissions" on public.hr_events for update to authenticated
using (public.is_assigned_hr_event_responsible(id) and event_type in ('permission', 'late_permission') and status = 'pending'
  and (not public.current_user_has_role('branch_manager') or branch_id = public.current_branch_id()))
with check (public.is_assigned_hr_event_responsible(id) and event_type in ('permission', 'late_permission')
  and (not public.current_user_has_role('branch_manager') or branch_id = public.current_branch_id()));
drop policy if exists "read approval steps for visible events" on public.hr_event_approval_steps;
create policy "read approval steps for visible events" on public.hr_event_approval_steps for select to authenticated
using (
  (public.is_assigned_hr_event_responsible(event_id) and (not public.current_user_has_role('branch_manager') or exists (select 1 from public.hr_events e where e.id = event_id and e.branch_id = public.current_branch_id())))
  or exists (select 1 from public.hr_events e where e.id = event_id and (
    public.current_user_has_role('admin') or public.current_user_has_role('hr') or public.current_user_has_role('auditor')
    or ((public.current_user_has_permission('effects.view_all') or public.current_user_has_permission('attendance.view_all') or public.current_user_has_permission('reports.view_all') or public.current_user_has_permission('reports.export'))
      and (not public.current_user_has_role('branch_manager') or e.branch_id = public.current_branch_id()))
    or (public.current_user_has_role('branch_manager') and e.branch_id = public.current_branch_id())
    or (public.current_user_has_role('employee') and e.employee_id = public.current_employee_id())
  ))
);

-- New-hire requests create an inactive roster record until head office approves.
create or replace function public.manager_create_employee(
  p_employee_number text, p_full_name text, p_job_title_id uuid, p_hired_on date
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_branch_id uuid := public.current_branch_id();
  v_employee_id uuid;
  v_full_name text := trim(p_full_name);
  v_number text := trim(p_employee_number);
begin
  if not public.current_user_has_role('branch_manager') or v_branch_id is null then
    raise exception 'Only a branch manager with an assigned branch can submit a hiring request';
  end if;
  if nullif(v_number, '') is null or nullif(v_full_name, '') is null then raise exception 'Employee number and full name are required'; end if;
  if p_job_title_id is not null and not exists (select 1 from public.job_titles where id = p_job_title_id) then raise exception 'The selected job title does not exist'; end if;

  insert into public.employees(employee_number, first_name, full_name, branch_id, job_title_id, hired_on, status)
  values (v_number, split_part(v_full_name, ' ', 1), v_full_name, v_branch_id, p_job_title_id, p_hired_on, 'needs_review')
  returning id into v_employee_id;

  insert into public.hr_events(employee_id, branch_id, event_type, effective_date, reason, details, created_by, status)
  values (v_employee_id, v_branch_id, 'new_hire', coalesce(p_hired_on, (now() at time zone 'Africa/Tripoli')::date),
    'طلب تعيين جديد بواسطة مدير الفرع', jsonb_build_object('employee_number', v_number, 'approval_required', true), auth.uid(), 'pending');
  return v_employee_id;
end;
$$;
revoke all on function public.manager_create_employee(text, text, uuid, date) from public;
grant execute on function public.manager_create_employee(text, text, uuid, date) to authenticated;

create or replace function public.activate_employee_after_hire_decision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.event_type = 'new_hire' and old.status = 'pending' and new.status in ('approved', 'rejected') then
    if new.status = 'approved' then
      update public.employees set status = 'active', updated_at = now() where id = new.employee_id and branch_id = new.branch_id;
    else
      update public.employees set status = 'terminated', updated_at = now() where id = new.employee_id and branch_id = new.branch_id;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists activate_employee_after_hire_decision on public.hr_events;
create trigger activate_employee_after_hire_decision after update of status on public.hr_events
for each row execute function public.activate_employee_after_hire_decision();
revoke all on function public.activate_employee_after_hire_decision() from public;

-- A branch manager must follow the configured leave approval steps, even when
-- the account also has an explicit permission that gives other roles an override.
create or replace function public.decide_hr_event_approval(
  p_event_id uuid, p_status text, p_reason text, p_discount_type text default 'none', p_discount_value numeric default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_is_override boolean := public.current_user_has_role('admin') or (public.current_user_has_permission('effects.approve') and not public.current_user_has_role('branch_manager'));
  v_event public.hr_events%rowtype;
  v_step public.hr_event_approval_steps%rowtype;
  v_salary numeric(12,2); v_amount numeric(12,2); v_days numeric(8,2);
  v_step_summary jsonb; v_decision_summary text;
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  if p_status not in ('approved', 'rejected') then raise exception 'Invalid approval decision'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'A decision reason is required'; end if;
  select * into v_event from public.hr_events where id = p_event_id and event_type = 'leave' and status = 'pending' for update;
  if not found then raise exception 'Leave request is not pending'; end if;
  select * into v_step from public.hr_event_approval_steps where event_id = p_event_id and status = 'pending' order by step_order limit 1 for update;
  if not found then raise exception 'No pending approval step was found'; end if;
  if not v_is_override then
    if v_step.approver_role = 'assigned_manager' then
      if not (auth.uid() = any(case when cardinality(v_step.approver_profile_ids) > 0 then v_step.approver_profile_ids else array[v_step.approver_profile_id] end)) then raise exception 'One of the assigned employee responsibles must decide this request'; end if;
    elsif v_step.approver_role = 'branch_manager' then
      if not public.current_user_has_role('branch_manager') or public.current_branch_id() is distinct from v_event.branch_id then raise exception 'The branch manager for this employee must decide first'; end if;
    elsif v_step.approver_role = 'auditor' then
      if not public.current_user_has_role('auditor') then raise exception 'An auditor must decide this leave request'; end if;
    elsif v_step.approver_role = 'hr' then
      if not public.current_user_has_role('hr') then raise exception 'Human resources must decide this leave request'; end if;
    end if;
  end if;
  if p_status = 'approved' and coalesce(p_discount_type, 'none') <> 'none' and not (v_is_override or v_step.approver_role = 'assigned_manager' or v_step.approver_role in ('auditor', 'hr')) then raise exception 'The leave deduction can only be set by an authorized final approver'; end if;
  if v_is_override and p_status = 'approved' then
    update public.hr_event_approval_steps set status = 'approved', decided_by = auth.uid(), decided_at = now(), reason = trim(p_reason) where event_id = p_event_id and status = 'pending';
  else
    update public.hr_event_approval_steps set status = p_status, decided_by = auth.uid(), decided_at = now(), reason = trim(p_reason) where id = v_step.id;
  end if;
  if p_status = 'rejected' then update public.hr_event_approval_steps set status = 'skipped', reason = 'توقفت الموافقات بعد رفض الطلب' where event_id = p_event_id and status = 'pending' and step_order > v_step.step_order; end if;
  select jsonb_agg(jsonb_build_object('step_order', s.step_order, 'approver_role', s.approver_role, 'approver_profile_ids', s.approver_profile_ids, 'status', s.status, 'decided_by', s.decided_by, 'decided_at', s.decided_at, 'reason', s.reason) order by s.step_order),
    string_agg(case s.approver_role when 'assigned_manager' then 'المسؤول المعيّن' when 'branch_manager' then 'مدير الفرع' when 'auditor' then 'مراجع الحسابات' else 'الموارد البشرية' end || ': ' || coalesce(s.reason, ''), E'\n' order by s.step_order)
  into v_step_summary, v_decision_summary from public.hr_event_approval_steps s where s.event_id = p_event_id;
  if p_status = 'rejected' then
    update public.hr_events set status = 'rejected', decision_reason = v_decision_summary, details = jsonb_set(coalesce(details, '{}'::jsonb), '{approval_steps}', coalesce(v_step_summary, '[]'::jsonb), true) where id = p_event_id; return;
  end if;
  if exists (select 1 from public.hr_event_approval_steps where event_id = p_event_id and status = 'pending') then update public.hr_events set details = jsonb_set(coalesce(details, '{}'::jsonb), '{approval_steps}', coalesce(v_step_summary, '[]'::jsonb), true) where id = p_event_id; return; end if;
  case coalesce(p_discount_type, 'none')
    when 'none' then v_amount := null; v_days := null;
    when 'fixed' then if coalesce(p_discount_value, 0) <= 0 then raise exception 'A positive fixed discount amount is required'; end if; v_amount := round(p_discount_value, 2); v_days := null;
    when 'days' then if coalesce(p_discount_value, 0) <= 0 then raise exception 'A positive number of discount days is required'; end if; select salary_amount into v_salary from public.employee_private where employee_id = v_event.employee_id; if coalesce(v_salary, 0) <= 0 then raise exception 'Employee salary is not registered'; end if; v_days := p_discount_value; v_amount := round(v_salary / 30 * v_days, 2);
    when 'half_day' then select salary_amount into v_salary from public.employee_private where employee_id = v_event.employee_id; if coalesce(v_salary, 0) <= 0 then raise exception 'Employee salary is not registered'; end if; v_days := 0.5; v_amount := round(v_salary / 30 * v_days, 2);
    when 'quarter_day' then select salary_amount into v_salary from public.employee_private where employee_id = v_event.employee_id; if coalesce(v_salary, 0) <= 0 then raise exception 'Employee salary is not registered'; end if; v_days := 0.25; v_amount := round(v_salary / 30 * v_days, 2);
    else raise exception 'Invalid leave discount type';
  end case;
  update public.hr_events set status = 'approved', decision_reason = v_decision_summary, amount = v_amount,
    amount_unit = case when v_amount is null then null else 'LYD' end,
    details = jsonb_set(jsonb_set(jsonb_set(coalesce(details, '{}'::jsonb), '{approval_steps}', coalesce(v_step_summary, '[]'::jsonb), true), '{leave_discount_type}', to_jsonb(coalesce(p_discount_type, 'none')), true), '{leave_discount_days}', coalesce(to_jsonb(v_days), 'null'::jsonb), true)
  where id = p_event_id;
end;
$$;
revoke all on function public.decide_hr_event_approval(uuid, text, text, text, numeric) from public;
grant execute on function public.decide_hr_event_approval(uuid, text, text, text, numeric) to authenticated;

