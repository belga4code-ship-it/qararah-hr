-- Add multiple account roles and additive per-user permissions while preserving
-- each existing profile.role as its current primary role.
alter table public.profiles
  add column if not exists user_roles text[] not null default '{}'::text[],
  add column if not exists additional_permissions text[] not null default '{}'::text[];

update public.profiles
set user_roles = array[role::text]
where cardinality(user_roles) = 0;

create or replace function public.current_user_has_role(p_role text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role::text = p_role or p_role = any(coalesce(p.user_roles, '{}'::text[])))
  );
$$;

create or replace function public.current_user_has_permission(p_permission text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p_permission = any(coalesce(p.additional_permissions, '{}'::text[]))
  );
$$;

revoke all on function public.current_user_has_role(text) from public;
revoke all on function public.current_user_has_permission(text) from public;
grant execute on function public.current_user_has_role(text) to authenticated;
grant execute on function public.current_user_has_permission(text) to authenticated;

-- Additive permissions and secondary role assignments participate in RLS,
-- without broadening existing branch-scoped access by default.
drop policy if exists "secondary roles read all employees" on public.employees;
create policy "secondary roles read all employees" on public.employees for select to authenticated
using (
  public.current_user_has_role('admin') or public.current_user_has_role('hr') or public.current_user_has_role('auditor')
  or public.current_user_has_permission('employees.view_all') or public.current_user_has_permission('employees.edit')
  or public.current_user_has_permission('employees.manage_accounts')
  or public.current_user_has_permission('goals.view_all') or public.current_user_has_permission('goals.manage')
  or public.current_user_has_permission('evaluations.view_all') or public.current_user_has_permission('evaluations.evaluate') or public.current_user_has_permission('evaluations.assign')
  or public.current_user_has_permission('effects.view_all')
  or ((public.current_user_has_permission('effects.create') or public.current_user_has_permission('effects.manage_deductions')) and branch_id = public.current_branch_id())
);
drop policy if exists "extra permission edit employees" on public.employees;
create policy "extra permission edit employees" on public.employees for update to authenticated
using (public.current_user_has_permission('employees.edit'))
with check (public.current_user_has_permission('employees.edit'));

drop policy if exists "extra permission read private employee data" on public.employee_private;
create policy "extra permission read private employee data" on public.employee_private for select to authenticated
using (public.current_user_has_permission('employees.view_sensitive') or public.current_user_has_permission('employees.edit'));
drop policy if exists "extra permission edit private employee data" on public.employee_private;
create policy "extra permission edit private employee data" on public.employee_private for all to authenticated
using (public.current_user_has_permission('employees.edit'))
with check (public.current_user_has_permission('employees.edit'));

drop policy if exists "secondary roles read attendance" on public.attendance_records;
create policy "secondary roles read attendance" on public.attendance_records for select to authenticated
using (
  public.current_user_has_role('admin') or public.current_user_has_role('hr') or public.current_user_has_role('auditor')
  or public.current_user_has_permission('attendance.view_all')
  or ((public.current_user_has_role('branch_manager') or public.current_user_has_role('yard_supervisor')) and branch_id = public.current_branch_id())
);
drop policy if exists "extra permission manage attendance" on public.attendance_records;
create policy "extra permission manage attendance" on public.attendance_records for all to authenticated
using (public.current_user_has_permission('attendance.manage'))
with check (public.current_user_has_permission('attendance.manage'));
drop policy if exists "extra permission manage attendance imports" on public.attendance_imports;
create policy "extra permission manage attendance imports" on public.attendance_imports for all to authenticated
using (public.current_user_has_permission('attendance.import'))
with check (public.current_user_has_permission('attendance.import'));

drop policy if exists "extra permission read all hr events" on public.hr_events;
create policy "extra permission read all hr events" on public.hr_events for select to authenticated
using (public.current_user_has_permission('effects.view_all'));
drop policy if exists "extra permission create hr events" on public.hr_events;
create policy "extra permission create hr events" on public.hr_events for insert to authenticated
with check (public.current_user_has_permission('effects.create'));
drop policy if exists "extra permission record approved deductions" on public.hr_events;
create policy "extra permission record approved deductions" on public.hr_events for insert to authenticated
with check (
  (public.current_user_has_role('auditor') or public.current_user_has_permission('effects.manage_deductions'))
  and event_type = 'deduction' and status = 'approved' and amount > 0
  and created_by = auth.uid() and approved_by = auth.uid() and decision_by = auth.uid()
  and payroll_recorded_by = auth.uid()
  and exists (select 1 from public.employees e where e.id = employee_id and e.branch_id = hr_events.branch_id)
);
drop policy if exists "extra permission decide hr events" on public.hr_events;
create policy "extra permission decide hr events" on public.hr_events for update to authenticated
using (public.current_user_has_permission('effects.approve') or public.current_user_has_permission('effects.manage_deductions'))
with check (public.current_user_has_permission('effects.approve') or public.current_user_has_permission('effects.manage_deductions'));

drop policy if exists "secondary roles read all evaluations" on public.evaluations;
create policy "secondary roles read all evaluations" on public.evaluations for select to authenticated
using (
  public.current_user_has_role('admin') or public.current_user_has_role('hr') or public.current_user_has_role('auditor')
  or public.current_user_has_permission('evaluations.view_all')
);
drop policy if exists "extra permission create evaluations" on public.evaluations;
create policy "extra permission create evaluations" on public.evaluations for all to authenticated
using (public.current_user_has_permission('evaluations.evaluate') or public.current_user_has_permission('evaluations.assign'))
with check (public.current_user_has_permission('evaluations.evaluate') or public.current_user_has_permission('evaluations.assign'));
drop policy if exists "extra permission read evaluation items" on public.evaluation_items;
create policy "extra permission read evaluation items" on public.evaluation_items for select to authenticated
using (public.current_user_has_permission('evaluations.view_all'));
drop policy if exists "extra permission manage evaluation items" on public.evaluation_items;
create policy "extra permission manage evaluation items" on public.evaluation_items for all to authenticated
using (public.current_user_has_permission('evaluations.evaluate'))
with check (public.current_user_has_permission('evaluations.evaluate'));

drop policy if exists "extra permission view all goals" on public.employee_goals;
create policy "extra permission view all goals" on public.employee_goals for select to authenticated
using (public.current_user_has_permission('goals.view_all'));
drop policy if exists "extra permission manage goals" on public.employee_goals;
create policy "extra permission manage goals" on public.employee_goals for all to authenticated
using (public.current_user_has_permission('goals.manage'))
with check (public.current_user_has_permission('goals.manage'));
drop policy if exists "extra permission view all employee reports" on public.employee_reports;
create policy "extra permission view all employee reports" on public.employee_reports for select to authenticated
using (public.current_user_has_permission('reports.view_all'));
drop policy if exists "extra permission create employee reports" on public.employee_reports;
create policy "extra permission create employee reports" on public.employee_reports for insert to authenticated
with check (public.current_user_has_permission('reports.view_all'));

drop policy if exists "extra permission read audit log" on public.audit_log;
create policy "extra permission read audit log" on public.audit_log for select to authenticated
using (public.current_user_has_permission('audit.view'));

comment on column public.profiles.user_roles is 'Additional account roles; profile.role remains the primary legacy role.';
comment on column public.profiles.additional_permissions is 'Additive, per-user permission grants; these never remove rights inherited from assigned roles.';


-- Honor secondary roles and additive approval grants in the leave and effects decision paths.
create or replace function public.decide_hr_event_approval(
  p_event_id uuid,
  p_status text,
  p_reason text,
  p_discount_type text default 'none',
  p_discount_value numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.hr_events%rowtype;
  v_step public.hr_event_approval_steps%rowtype;
  v_actor_role text := coalesce(public.current_app_role()::text, '');
  v_salary numeric(12,2);
  v_amount numeric(12,2);
  v_days numeric(8,2);
  v_step_summary jsonb;
  v_decision_summary text;
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  if p_status is null or p_status not in ('approved', 'rejected') then raise exception 'Invalid approval decision'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'A decision reason is required'; end if;

  select * into v_event from public.hr_events
  where id = p_event_id and event_type = 'leave' and status = 'pending'
  for update;
  if not found then raise exception 'Leave request is not pending'; end if;

  select * into v_step from public.hr_event_approval_steps
  where event_id = p_event_id and status = 'pending'
  order by step_order limit 1 for update;
  if not found then raise exception 'No pending approval step was found'; end if;

  if v_step.approver_role = 'branch_manager' then
    if not public.current_user_has_role('branch_manager') or public.current_branch_id() is distinct from v_event.branch_id then
      raise exception 'The branch manager for this employee must decide first';
    end if;
  elsif v_step.approver_role = 'auditor' then
    if not public.current_user_has_role('auditor') then raise exception 'An auditor must decide this leave request'; end if;
  elsif v_step.approver_role = 'hr' then
    if not public.current_user_has_role('admin') and not public.current_user_has_role('hr') then raise exception 'Human resources must decide this leave request'; end if;
  end if;

  if p_status = 'approved' and v_step.approver_role = 'branch_manager' and coalesce(p_discount_type, 'none') <> 'none' then
    raise exception 'The leave deduction can only be set by the final approver';
  end if;

  update public.hr_event_approval_steps
  set status = p_status, decided_by = auth.uid(), decided_at = now(), reason = trim(p_reason)
  where id = v_step.id;

  if p_status = 'rejected' then
    update public.hr_event_approval_steps set status = 'skipped', reason = 'توقفت الموافقات بعد رفض الطلب'
    where event_id = p_event_id and status = 'pending' and step_order > v_step.step_order;
  end if;

  select jsonb_agg(jsonb_build_object(
    'step_order', s.step_order, 'approver_role', s.approver_role, 'status', s.status,
    'decided_by', s.decided_by, 'decided_at', s.decided_at, 'reason', s.reason
  ) order by s.step_order), string_agg(
    case s.approver_role when 'branch_manager' then 'مدير الفرع' when 'auditor' then 'مراجع الحسابات' else 'الموارد البشرية' end || ': ' || coalesce(s.reason, ''), E'\n' order by s.step_order
  )
  into v_step_summary, v_decision_summary
  from public.hr_event_approval_steps s where s.event_id = p_event_id;

  if p_status = 'rejected' then
    update public.hr_events set status = 'rejected', decision_reason = v_decision_summary,
      details = jsonb_set(coalesce(details, '{}'::jsonb), '{approval_steps}', coalesce(v_step_summary, '[]'::jsonb), true)
    where id = p_event_id;
    return;
  end if;

  if exists (select 1 from public.hr_event_approval_steps where event_id = p_event_id and status = 'pending') then
    update public.hr_events set details = jsonb_set(coalesce(details, '{}'::jsonb), '{approval_steps}', coalesce(v_step_summary, '[]'::jsonb), true)
    where id = p_event_id;
    return;
  end if;

  case coalesce(p_discount_type, 'none')
    when 'none' then v_amount := null; v_days := null;
    when 'fixed' then
      if coalesce(p_discount_value, 0) <= 0 then raise exception 'A positive fixed discount amount is required'; end if;
      v_amount := round(p_discount_value, 2); v_days := null;
    when 'days' then
      if coalesce(p_discount_value, 0) <= 0 then raise exception 'A positive number of discount days is required'; end if;
      select salary_amount into v_salary from public.employee_private where employee_id = v_event.employee_id;
      if coalesce(v_salary, 0) <= 0 then raise exception 'Employee salary is not registered'; end if;
      v_days := p_discount_value; v_amount := round(v_salary / 30 * v_days, 2);
    when 'half_day' then
      select salary_amount into v_salary from public.employee_private where employee_id = v_event.employee_id;
      if coalesce(v_salary, 0) <= 0 then raise exception 'Employee salary is not registered'; end if;
      v_days := 0.5; v_amount := round(v_salary / 30 * v_days, 2);
    when 'quarter_day' then
      select salary_amount into v_salary from public.employee_private where employee_id = v_event.employee_id;
      if coalesce(v_salary, 0) <= 0 then raise exception 'Employee salary is not registered'; end if;
      v_days := 0.25; v_amount := round(v_salary / 30 * v_days, 2);
    else raise exception 'Invalid leave discount type';
  end case;

  if v_step.approver_role = 'auditor' and coalesce(p_discount_type, 'none') = 'fixed' and v_amount <= 0 then
    raise exception 'A valid discount amount is required';
  end if;

  update public.hr_events
  set status = 'approved', decision_reason = v_decision_summary,
    amount = v_amount, amount_unit = case when v_amount is null then null else 'LYD' end,
    details = jsonb_set(
      jsonb_set(
        jsonb_set(coalesce(details, '{}'::jsonb), '{approval_steps}', coalesce(v_step_summary, '[]'::jsonb), true),
        '{leave_discount_type}', to_jsonb(coalesce(p_discount_type, 'none')), true
      ), '{leave_discount_days}', coalesce(to_jsonb(v_days), 'null'::jsonb), true
    )
  where id = p_event_id;
end;
$$;

revoke all on function public.decide_hr_event_approval(uuid, text, text, text, numeric) from public;
grant execute on function public.decide_hr_event_approval(uuid, text, text, text, numeric) to authenticated;

create or replace function public.record_hr_event_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := coalesce(public.current_app_role()::text, '');
  v_is_auditor boolean := public.current_user_has_role('auditor');
  v_is_hr boolean := public.current_user_has_role('admin') or public.current_user_has_role('hr');
  v_can_approve boolean := public.current_user_has_role('admin') or public.current_user_has_role('hr') or public.current_user_has_permission('effects.approve');
  v_last_step public.hr_event_approval_steps%rowtype;
begin
  if old.status = 'pending' and new.status in ('approved', 'rejected') then
    if new.event_type = 'leave' then
      if nullif(trim(new.decision_reason), '') is null then raise exception 'A decision reason is required'; end if;
      if new.status = 'approved' then
        if not exists (select 1 from public.hr_event_approval_steps where event_id = old.id)
          or exists (select 1 from public.hr_event_approval_steps where event_id = old.id and status <> 'approved') then
          raise exception 'Both required leave approvals must be completed';
        end if;
        select * into v_last_step from public.hr_event_approval_steps where event_id = old.id order by step_order desc limit 1;
        if v_last_step.decided_by is distinct from auth.uid() or v_last_step.status <> 'approved' then
          raise exception 'The final leave approver must complete this request';
        end if;
      else
        if not exists (select 1 from public.hr_event_approval_steps where event_id = old.id and status = 'rejected' and decided_by = auth.uid()) then
          raise exception 'A leave rejection must be recorded by an assigned approver';
        end if;
      end if;
    else
      if not v_is_hr and (
        new.event_type is distinct from old.event_type
        or new.employee_id is distinct from old.employee_id
        or new.branch_id is distinct from old.branch_id
        or new.effective_date is distinct from old.effective_date
        or new.end_date is distinct from old.end_date
        or new.reason is distinct from old.reason
        or new.details is distinct from old.details
        or new.amount is distinct from old.amount
        or new.amount_unit is distinct from old.amount_unit
        or new.created_by is distinct from old.created_by
      ) then
        raise exception 'Approvers may only decide the request and record its reason';
      end if;
      if v_is_auditor and not (public.current_user_has_role('admin') or public.current_user_has_role('hr')) and (
        new.event_type is distinct from old.event_type
        or new.employee_id is distinct from old.employee_id
        or new.branch_id is distinct from old.branch_id
        or new.effective_date is distinct from old.effective_date
        or new.end_date is distinct from old.end_date
        or new.reason is distinct from old.reason
        or new.details is distinct from old.details
        or new.amount is distinct from old.amount
        or new.amount_unit is distinct from old.amount_unit
        or new.created_by is distinct from old.created_by
      ) then
        raise exception 'Auditors may only decide deduction requests';
      end if;
      if not v_can_approve
        and not (new.event_type = 'deduction' and (v_is_auditor or public.current_user_has_permission('effects.manage_deductions'))) then
        raise exception 'You are not allowed to decide this request';
      end if;
      if nullif(trim(new.decision_reason), '') is null then raise exception 'A decision reason is required'; end if;
    end if;

    new.decision_by := auth.uid();
    new.decision_at := now();
    if new.status = 'approved' then
      new.approved_by := auth.uid();
      new.approved_at := now();
      if new.event_type = 'deduction' or (new.event_type = 'leave' and coalesce(new.amount, 0) > 0) then
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


drop policy if exists "read approval steps for visible events" on public.hr_event_approval_steps;
create policy "read approval steps for visible events" on public.hr_event_approval_steps
for select to authenticated
using (exists (select 1 from public.hr_events e where e.id = event_id and (
  public.current_user_has_role('admin') or public.current_user_has_role('hr') or public.current_user_has_role('auditor')
  or (public.current_user_has_role('branch_manager') and e.branch_id = public.current_branch_id())
  or (public.current_user_has_role('employee') and e.employee_id = public.current_employee_id())
  or public.current_user_has_permission('effects.view_all')
)));


-- Let additive evaluation permissions control assignment and evaluation workflows.
create or replace function public.set_employee_evaluators(
  p_employee_id uuid,
  p_primary_evaluator_employee_id uuid,
  p_secondary_evaluator_employee_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_primary_profile_id uuid;
  v_secondary_profile_id uuid;
begin
  if not public.current_user_has_role('admin') and not public.current_user_has_role('hr') and not public.current_user_has_permission('evaluations.assign') then
    raise exception 'Only HR can assign employee evaluators';
  end if;
  if p_primary_evaluator_employee_id is null then
    raise exception 'A primary evaluator is required';
  end if;
  if p_primary_evaluator_employee_id = p_secondary_evaluator_employee_id then
    raise exception 'The first and second evaluators must be different';
  end if;
  if not exists (select 1 from public.employees where id = p_employee_id) then
    raise exception 'Employee was not found';
  end if;
  if p_primary_evaluator_employee_id = p_employee_id or p_secondary_evaluator_employee_id = p_employee_id then
    raise exception 'Employees cannot evaluate themselves';
  end if;

  select p.id into v_primary_profile_id
  from public.profiles p join public.employees e on e.id = p.employee_id
  where p.employee_id = p_primary_evaluator_employee_id
    and (p.role in ('admin', 'hr', 'branch_manager', 'accountant') or 'admin' = any(coalesce(p.user_roles, '{}'::text[])) or 'hr' = any(coalesce(p.user_roles, '{}'::text[])) or 'branch_manager' = any(coalesce(p.user_roles, '{}'::text[])) or 'accountant' = any(coalesce(p.user_roles, '{}'::text[])) or 'auditor' = any(coalesce(p.user_roles, '{}'::text[])) or 'yard_supervisor' = any(coalesce(p.user_roles, '{}'::text[])) or 'evaluations.evaluate' = any(coalesce(p.additional_permissions, '{}'::text[])))
    and e.status = 'active';
  if v_primary_profile_id is null then
    raise exception 'The selected first evaluator needs an active employee record linked to a manager or HR account';
  end if;

  if p_secondary_evaluator_employee_id is not null then
    select p.id into v_secondary_profile_id
    from public.profiles p join public.employees e on e.id = p.employee_id
    where p.employee_id = p_secondary_evaluator_employee_id
      and (p.role in ('admin', 'hr', 'branch_manager', 'accountant') or 'admin' = any(coalesce(p.user_roles, '{}'::text[])) or 'hr' = any(coalesce(p.user_roles, '{}'::text[])) or 'branch_manager' = any(coalesce(p.user_roles, '{}'::text[])) or 'accountant' = any(coalesce(p.user_roles, '{}'::text[])) or 'auditor' = any(coalesce(p.user_roles, '{}'::text[])) or 'yard_supervisor' = any(coalesce(p.user_roles, '{}'::text[])) or 'evaluations.evaluate' = any(coalesce(p.additional_permissions, '{}'::text[])))
      and e.status = 'active';
    if v_secondary_profile_id is null then
      raise exception 'The selected second evaluator needs an active employee record linked to a manager or HR account';
    end if;
  end if;

  delete from public.employee_evaluators where employee_id = p_employee_id;
  insert into public.employee_evaluators(employee_id, slot, evaluator_profile_id, evaluator_employee_id, assigned_by)
  values (p_employee_id, 1, v_primary_profile_id, p_primary_evaluator_employee_id, auth.uid());
  if p_secondary_evaluator_employee_id is not null then
    insert into public.employee_evaluators(employee_id, slot, evaluator_profile_id, evaluator_employee_id, assigned_by)
    values (p_employee_id, 2, v_secondary_profile_id, p_secondary_evaluator_employee_id, auth.uid());
  end if;
end;
$$;

revoke all on function public.set_employee_evaluators(uuid, uuid, uuid) from public;
grant execute on function public.set_employee_evaluators(uuid, uuid, uuid) to authenticated;

drop policy if exists "HR manage employee evaluators" on public.employee_evaluators;
create policy "HR manage employee evaluators" on public.employee_evaluators for all to authenticated
using (public.current_user_has_role('admin') or public.current_user_has_role('hr'))
with check (public.current_user_has_role('admin') or public.current_user_has_role('hr'));
drop policy if exists "extra permission manage evaluator assignments" on public.employee_evaluators;
create policy "extra permission manage evaluator assignments" on public.employee_evaluators for all to authenticated
using (public.current_user_has_permission('evaluations.assign'))
with check (public.current_user_has_permission('evaluations.assign'));
drop policy if exists "extra permission read evaluator assignments" on public.employee_evaluators;
create policy "extra permission read evaluator assignments" on public.employee_evaluators for select to authenticated
using (public.current_user_has_permission('evaluations.view_all') or public.current_user_has_permission('evaluations.evaluate') or public.current_user_has_permission('evaluations.assign'));


-- Allow explicitly authorized evaluators to submit without a per-employee assignment.
create or replace function public.submit_employee_evaluation(
  p_employee_id uuid,
  p_period_month date,
  p_notes text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_id uuid;
  v_evaluation_id uuid;
  v_month date := date_trunc('month', p_period_month)::date;
  v_total numeric(6,2);
  v_max numeric(6,2);
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one scored evaluation item is required';
  end if;
  if not exists (
    select 1 from public.employee_evaluators ee
    where ee.employee_id = p_employee_id and ee.evaluator_profile_id = auth.uid()
  ) and not public.current_user_has_permission('evaluations.evaluate') and not public.current_user_has_role('auditor') then
    raise exception 'You are not assigned to evaluate this employee';
  end if;
  select branch_id into v_branch_id from public.employees where id = p_employee_id;
  if v_branch_id is null then raise exception 'Employee was not found'; end if;

  select sum((item->>'score')::numeric), sum(coalesce((item->>'max_score')::numeric, 4))
  into v_total, v_max
  from jsonb_array_elements(p_items) item;
  if exists (
    select 1 from jsonb_array_elements(p_items) item
    where coalesce((item->>'score')::integer, 0) not between 1 and 4
      or coalesce((item->>'max_score')::integer, 4) not between 1 and 4
      or nullif(trim(item->>'criterion'), '') is null
  ) then
    raise exception 'Evaluation scores and criteria are invalid';
  end if;

  insert into public.evaluations(employee_id, branch_id, period_month, evaluator_id, total_score, max_score, status, notes)
  values (p_employee_id, v_branch_id, v_month, auth.uid(), v_total, v_max, 'submitted', nullif(trim(p_notes), ''))
  on conflict (employee_id, period_month, evaluator_id)
  do update set total_score = excluded.total_score, max_score = excluded.max_score,
    status = 'submitted', notes = excluded.notes
  returning id into v_evaluation_id;

  delete from public.evaluation_items where evaluation_id = v_evaluation_id;
  insert into public.evaluation_items(evaluation_id, criterion, score, max_score, evidence)
  select v_evaluation_id, item->>'criterion', (item->>'score')::smallint,
    coalesce((item->>'max_score')::smallint, 4), nullif(trim(item->>'evidence'), '')
  from jsonb_array_elements(p_items) item;

  return v_evaluation_id;
end;
$$;

revoke all on function public.submit_employee_evaluation(uuid, date, text, jsonb) from public;
grant execute on function public.submit_employee_evaluation(uuid, date, text, jsonb) to authenticated;
