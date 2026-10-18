-- Route employee leave and permission requests to the employee's assigned direct manager.
-- The system administrator and explicit effects.approve permission remain overrides.

alter table public.hr_event_approval_steps
  add column if not exists approver_profile_id uuid references public.profiles(id);

alter table public.hr_event_approval_steps
  drop constraint if exists hr_event_approval_steps_approver_role_check;
alter table public.hr_event_approval_steps
  add constraint hr_event_approval_steps_approver_role_check
  check (approver_role in ('branch_manager', 'auditor', 'hr', 'assigned_manager'));

create or replace function public.set_employee_direct_manager(p_employee_id uuid, p_manager_employee_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.current_user_has_role('admin') or public.current_user_has_role('hr')) then
    raise exception 'Only system administrators and human resources may assign employee responsibles';
  end if;
  if p_manager_employee_id = p_employee_id then raise exception 'An employee cannot be their own responsible'; end if;
  if p_manager_employee_id is not null and not exists (select 1 from public.profiles where employee_id = p_manager_employee_id) then
    raise exception 'The selected responsible must have a linked login account';
  end if;
  update public.employees set manager_id = p_manager_employee_id where id = p_employee_id;
  if not found then raise exception 'Employee not found'; end if;
end;
$$;
revoke all on function public.set_employee_direct_manager(uuid, uuid) from public;
grant execute on function public.set_employee_direct_manager(uuid, uuid) to authenticated;

create or replace function public.current_user_manages_employee(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.employees e
    join public.profiles p on p.employee_id = e.manager_id
    where e.id = p_employee_id and p.id = auth.uid()
  );
$$;

create or replace function public.is_assigned_hr_event_responsible(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.hr_events ev
    where ev.id = p_event_id
      and (
        case when ev.details ? 'responsible_profile_id'
          then ev.details ->> 'responsible_profile_id' = auth.uid()::text
          else public.current_user_manages_employee(ev.employee_id)
        end
      )
  );
$$;

revoke all on function public.current_user_manages_employee(uuid) from public;
grant execute on function public.current_user_manages_employee(uuid) to authenticated;
revoke all on function public.is_assigned_hr_event_responsible(uuid) from public;
grant execute on function public.is_assigned_hr_event_responsible(uuid) to authenticated;

-- Snapshot the assignee at submission time so reassignment does not silently
-- redirect requests that are already in progress.
create or replace function public.snapshot_hr_event_responsible()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_manager_employee_id uuid;
  v_responsible_profile_id uuid;
begin
  if new.event_type not in ('leave', 'late_permission', 'permission') or new.status <> 'pending' then
    return new;
  end if;
  select manager_id into v_manager_employee_id from public.employees where id = new.employee_id;
  if v_manager_employee_id is not null then
    select id into v_responsible_profile_id from public.profiles where employee_id = v_manager_employee_id order by created_at limit 1;
  end if;
  if v_responsible_profile_id is null then
    raise exception 'عيّن مسؤولاً مرتبطاً بحساب دخول لهذا الموظف قبل إرسال الطلب';
  end if;
  new.details := jsonb_set(coalesce(new.details, '{}'::jsonb), '{responsible_profile_id}', to_jsonb(v_responsible_profile_id::text), true);
  return new;
end;
$$;

drop trigger if exists snapshot_hr_event_responsible on public.hr_events;
create trigger snapshot_hr_event_responsible
before insert on public.hr_events
for each row execute function public.snapshot_hr_event_responsible();

create or replace function public.initialize_leave_approval_steps()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_responsible_profile_id uuid;
begin
  if new.event_type <> 'leave' or new.status <> 'pending' then return new; end if;
  v_responsible_profile_id := nullif(new.details ->> 'responsible_profile_id', '')::uuid;
  insert into public.hr_event_approval_steps(event_id, step_order, approver_role, approver_profile_id)
  values (new.id, 1, 'assigned_manager', v_responsible_profile_id)
  on conflict (event_id, step_order) do nothing;
  return new;
end;
$$;

drop trigger if exists initialize_leave_approval_steps on public.hr_events;
create trigger initialize_leave_approval_steps
after insert on public.hr_events
for each row execute function public.initialize_leave_approval_steps();

-- Re-route already pending leave requests and retain their former steps in the
-- event audit details before replacing the active route.
with pending_leaves as (
  select ev.id, ev.details,
    (select p.id from public.profiles p where p.employee_id = emp.manager_id order by p.created_at limit 1) as responsible_profile_id
  from public.hr_events ev
  join public.employees emp on emp.id = ev.employee_id
  where ev.event_type = 'leave' and ev.status = 'pending'
), archived as (
  select p.id, jsonb_set(
    coalesce(p.details, '{}'::jsonb),
    '{previous_approval_steps}',
    coalesce((select jsonb_agg(jsonb_build_object('approver_role', s.approver_role, 'status', s.status, 'decided_by', s.decided_by, 'decided_at', s.decided_at, 'reason', s.reason) order by s.step_order) from public.hr_event_approval_steps s where s.event_id = p.id), '[]'::jsonb),
    true
  ) as details,
  p.responsible_profile_id
  from pending_leaves p
)
update public.hr_events ev
set details = jsonb_set(archived.details, '{responsible_profile_id}', coalesce(to_jsonb(archived.responsible_profile_id::text), 'null'::jsonb), true)
from archived where ev.id = archived.id;

delete from public.hr_event_approval_steps s
using public.hr_events ev
where s.event_id = ev.id and ev.event_type = 'leave' and ev.status = 'pending';

insert into public.hr_event_approval_steps(event_id, step_order, approver_role, approver_profile_id)
select ev.id, 1, 'assigned_manager', nullif(ev.details ->> 'responsible_profile_id', '')::uuid
from public.hr_events ev
where ev.event_type = 'leave' and ev.status = 'pending';

-- Assigned managers can read their direct reports and the reports' requests.
drop policy if exists "assigned managers read direct report employee records" on public.employees;
create policy "assigned managers read direct report employee records" on public.employees
for select to authenticated
using (public.current_user_manages_employee(id));

drop policy if exists "assigned responsible read hr events" on public.hr_events;
create policy "assigned responsible read hr events" on public.hr_events
for select to authenticated
using (public.is_assigned_hr_event_responsible(id));

drop policy if exists "assigned responsible update permissions" on public.hr_events;
create policy "assigned responsible update permissions" on public.hr_events
for update to authenticated
using (
  public.is_assigned_hr_event_responsible(id)
  and event_type in ('permission', 'late_permission')
  and status = 'pending'
)
with check (
  public.is_assigned_hr_event_responsible(id)
  and event_type in ('permission', 'late_permission')
);

drop policy if exists "read approval steps for visible events" on public.hr_event_approval_steps;
create policy "read approval steps for visible events" on public.hr_event_approval_steps
for select to authenticated
using (
  public.is_assigned_hr_event_responsible(event_id)
  or exists (
    select 1 from public.hr_events e
    where e.id = event_id and (
      public.current_user_has_role('admin') or public.current_user_has_role('hr') or public.current_user_has_role('auditor')
      or public.current_user_has_permission('effects.view_all')
      or public.current_user_has_permission('attendance.view_all')
      or public.current_user_has_permission('reports.view_all')
      or public.current_user_has_permission('reports.export')
      or (public.current_user_has_role('branch_manager') and e.branch_id = public.current_branch_id())
      or (public.current_user_has_role('employee') and e.employee_id = public.current_employee_id())
    )
  )
);

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
  v_is_admin boolean := public.current_user_has_role('admin');
  v_is_override boolean := public.current_user_has_role('admin') or public.current_user_has_permission('effects.approve');
  v_event public.hr_events%rowtype;
  v_step public.hr_event_approval_steps%rowtype;
  v_salary numeric(12,2);
  v_amount numeric(12,2);
  v_days numeric(8,2);
  v_step_summary jsonb;
  v_decision_summary text;
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  if p_status is null or p_status not in ('approved', 'rejected') then raise exception 'Invalid approval decision'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'A decision reason is required'; end if;
  select * into v_event from public.hr_events where id = p_event_id and event_type = 'leave' and status = 'pending' for update;
  if not found then raise exception 'Leave request is not pending'; end if;
  select * into v_step from public.hr_event_approval_steps where event_id = p_event_id and status = 'pending' order by step_order limit 1 for update;
  if not found then raise exception 'No pending approval step was found'; end if;

  if not v_is_override then
    if v_step.approver_role = 'assigned_manager' then
      if v_step.approver_profile_id is distinct from auth.uid() then raise exception 'The assigned employee responsible must decide this request'; end if;
    elsif v_step.approver_role = 'branch_manager' then
      if not public.current_user_has_role('branch_manager') or public.current_branch_id() is distinct from v_event.branch_id then raise exception 'The branch manager for this employee must decide first'; end if;
    elsif v_step.approver_role = 'auditor' then
      if not public.current_user_has_role('auditor') then raise exception 'An auditor must decide this leave request'; end if;
    elsif v_step.approver_role = 'hr' then
      if not public.current_user_has_role('hr') then raise exception 'Human resources must decide this leave request'; end if;
    end if;
  end if;

  if p_status = 'approved' and coalesce(p_discount_type, 'none') <> 'none' and not (v_is_override or v_step.approver_role = 'assigned_manager' or v_step.approver_role in ('auditor', 'hr')) then
    raise exception 'The leave deduction can only be set by an authorized final approver';
  end if;
  if v_is_override and p_status = 'approved' then
    update public.hr_event_approval_steps set status = 'approved', decided_by = auth.uid(), decided_at = now(), reason = trim(p_reason)
    where event_id = p_event_id and status = 'pending';
  else
    update public.hr_event_approval_steps set status = p_status, decided_by = auth.uid(), decided_at = now(), reason = trim(p_reason) where id = v_step.id;
  end if;
  if p_status = 'rejected' then
    update public.hr_event_approval_steps set status = 'skipped', reason = 'توقفت الموافقات بعد رفض الطلب'
    where event_id = p_event_id and status = 'pending' and step_order > v_step.step_order;
  end if;

  select jsonb_agg(jsonb_build_object('step_order', s.step_order, 'approver_role', s.approver_role, 'approver_profile_id', s.approver_profile_id, 'status', s.status, 'decided_by', s.decided_by, 'decided_at', s.decided_at, 'reason', s.reason) order by s.step_order),
    string_agg(case s.approver_role when 'assigned_manager' then 'المسؤول المعيّن' when 'branch_manager' then 'مدير الفرع' when 'auditor' then 'مراجع الحسابات' else 'الموارد البشرية' end || ': ' || coalesce(s.reason, ''), E'\n' order by s.step_order)
  into v_step_summary, v_decision_summary from public.hr_event_approval_steps s where s.event_id = p_event_id;

  if p_status = 'rejected' then
    update public.hr_events set status = 'rejected', decision_reason = v_decision_summary,
      details = jsonb_set(coalesce(details, '{}'::jsonb), '{approval_steps}', coalesce(v_step_summary, '[]'::jsonb), true) where id = p_event_id;
    return;
  end if;
  if exists (select 1 from public.hr_event_approval_steps where event_id = p_event_id and status = 'pending') then
    update public.hr_events set details = jsonb_set(coalesce(details, '{}'::jsonb), '{approval_steps}', coalesce(v_step_summary, '[]'::jsonb), true) where id = p_event_id;
    return;
  end if;

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

create or replace function public.record_hr_event_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := coalesce(public.current_app_role()::text, '');
  v_is_admin boolean := public.current_user_has_role('admin');
  v_can_approve boolean := public.current_user_has_role('admin') or public.current_user_has_role('hr') or public.current_user_has_permission('effects.approve');
  v_is_auditor boolean := public.current_user_has_role('auditor');
  v_is_assigned boolean := public.is_assigned_hr_event_responsible(old.id);
  v_last_step public.hr_event_approval_steps%rowtype;
begin
  if old.status = 'pending' and new.status in ('approved', 'rejected') then
    if new.event_type = 'leave' then
      if nullif(trim(new.decision_reason), '') is null then raise exception 'A decision reason is required'; end if;
      if new.status = 'approved' then
        if not exists (select 1 from public.hr_event_approval_steps where event_id = old.id)
          or exists (select 1 from public.hr_event_approval_steps where event_id = old.id and status <> 'approved') then raise exception 'All required leave approvals must be completed'; end if;
        select * into v_last_step from public.hr_event_approval_steps where event_id = old.id order by step_order desc limit 1;
        if v_last_step.decided_by is distinct from auth.uid() or v_last_step.status <> 'approved' then raise exception 'The final leave approver must complete this request'; end if;
      else
        if not exists (select 1 from public.hr_event_approval_steps where event_id = old.id and status = 'rejected' and decided_by = auth.uid()) then raise exception 'A leave rejection must be recorded by an assigned approver'; end if;
      end if;
    else
      if new.event_type in ('permission', 'late_permission') then
        if not (v_is_admin or public.current_user_has_permission('effects.approve') or v_is_assigned) then raise exception 'Only the assigned responsible or system administrator may decide this request'; end if;
      elsif not (v_role in ('admin', 'hr') or (v_is_auditor and new.event_type = 'deduction') or public.current_user_has_permission('effects.approve') or (new.event_type = 'deduction' and public.current_user_has_permission('effects.manage_deductions'))) then
        raise exception 'You are not allowed to decide this request';
      end if;
      if not (v_role in ('admin', 'hr')) and (
        new.event_type is distinct from old.event_type or new.employee_id is distinct from old.employee_id or new.branch_id is distinct from old.branch_id
        or new.effective_date is distinct from old.effective_date or new.end_date is distinct from old.end_date or new.reason is distinct from old.reason
        or new.details is distinct from old.details or new.amount is distinct from old.amount or new.amount_unit is distinct from old.amount_unit or new.created_by is distinct from old.created_by
      ) then raise exception 'Approvers may only decide the request and record its reason'; end if;
      if nullif(trim(new.decision_reason), '') is null then raise exception 'A decision reason is required'; end if;
    end if;
    new.decision_by := auth.uid(); new.decision_at := now();
    if new.status = 'approved' then
      new.approved_by := auth.uid(); new.approved_at := now();
      if new.event_type = 'deduction' or (new.event_type = 'leave' and coalesce(new.amount, 0) > 0) then new.payroll_recorded_at := now(); new.payroll_recorded_by := auth.uid(); end if;
    else
      new.approved_by := null; new.approved_at := null; new.payroll_recorded_at := null; new.payroll_recorded_by := null;
    end if;
  end if;
  return new;
end;
$$;

