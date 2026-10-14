-- Leave requests require branch approval followed by an appropriate central reviewer.
create table if not exists public.hr_event_approval_steps (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.hr_events(id) on delete cascade,
  step_order smallint not null check (step_order between 1 and 2),
  approver_role text not null check (approver_role in ('branch_manager', 'auditor', 'hr')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'skipped')),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  reason text,
  created_at timestamptz not null default now(),
  unique (event_id, step_order),
  unique (event_id, approver_role)
);

create index if not exists hr_event_approval_steps_event_idx
  on public.hr_event_approval_steps(event_id, step_order);

alter table public.hr_event_approval_steps enable row level security;
revoke all on public.hr_event_approval_steps from anon, authenticated;
grant select on public.hr_event_approval_steps to authenticated;
drop policy if exists "read approval steps for visible events" on public.hr_event_approval_steps;
create policy "read approval steps for visible events" on public.hr_event_approval_steps
for select to authenticated
using (
  exists (
    select 1 from public.hr_events e
    where e.id = event_id
      and (
        public.current_app_role() in ('admin', 'hr')
        or public.current_app_role()::text = 'auditor'
        or (public.current_app_role() = 'branch_manager' and e.branch_id = public.current_branch_id())
        or (public.current_app_role() = 'employee' and e.employee_id = public.current_employee_id())
      )
  )
);

create or replace function public.initialize_leave_approval_steps()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_title text;
  v_department text;
  v_central_role text;
begin
  if new.event_type <> 'leave' or new.status <> 'pending' then
    return new;
  end if;

  select coalesce(d.name, ''), coalesce(j.name, '')
  into v_department, v_job_title
  from public.employees e
  left join public.departments d on d.id = e.department_id
  left join public.job_titles j on j.id = e.job_title_id
  where e.id = new.employee_id;

  if lower(v_department || ' ' || v_job_title) like '%محاسب%'
    or lower(v_department || ' ' || v_job_title) like '%حسابات%'
    or lower(v_department || ' ' || v_job_title) like '%محاسبة%'
    or lower(v_department || ' ' || v_job_title) like '%accountant%'
    or lower(v_department || ' ' || v_job_title) like '%accounting%' then
    v_central_role := 'auditor';
  else
    v_central_role := 'hr';
  end if;

  insert into public.hr_event_approval_steps(event_id, step_order, approver_role)
  values (new.id, 1, 'branch_manager'), (new.id, 2, v_central_role)
  on conflict (event_id, step_order) do nothing;
  return new;
end;
$$;

drop trigger if exists initialize_leave_approval_steps on public.hr_events;
create trigger initialize_leave_approval_steps
after insert on public.hr_events
for each row execute function public.initialize_leave_approval_steps();

-- Preserve the approval chain for requests already waiting when the migration is applied.
with leave_requests as (
  select e.id, e.employee_id,
    case when lower(coalesce(d.name, '') || ' ' || coalesce(j.name, '')) like '%محاسب%'
      or lower(coalesce(d.name, '') || ' ' || coalesce(j.name, '')) like '%حسابات%'
      or lower(coalesce(d.name, '') || ' ' || coalesce(j.name, '')) like '%محاسبة%'
      or lower(coalesce(d.name, '') || ' ' || coalesce(j.name, '')) like '%accountant%'
      or lower(coalesce(d.name, '') || ' ' || coalesce(j.name, '')) like '%accounting%'
      then 'auditor' else 'hr' end as central_role
  from public.hr_events e
  join public.employees emp on emp.id = e.employee_id
  left join public.departments d on d.id = emp.department_id
  left join public.job_titles j on j.id = emp.job_title_id
  where e.event_type = 'leave' and e.status = 'pending'
)
insert into public.hr_event_approval_steps(event_id, step_order, approver_role)
select id, 1, 'branch_manager' from leave_requests
union all
select id, 2, central_role from leave_requests
on conflict (event_id, step_order) do nothing;

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
    if v_actor_role is distinct from 'branch_manager' or public.current_branch_id() is distinct from v_event.branch_id then
      raise exception 'The branch manager for this employee must decide first';
    end if;
  elsif v_step.approver_role = 'auditor' then
    if v_actor_role is distinct from 'auditor' then raise exception 'An auditor must decide this leave request'; end if;
  elsif v_step.approver_role = 'hr' then
    if v_actor_role is distinct from 'admin' and v_actor_role is distinct from 'hr' then raise exception 'Human resources must decide this leave request'; end if;
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

-- Status changes for leave may only finalize a completed chain or a recorded rejection.
create or replace function public.record_hr_event_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := coalesce(public.current_app_role()::text, '');
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
      if v_role = 'auditor' and (
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
      if v_role not in ('admin', 'hr')
        and not (v_role = 'auditor' and new.event_type = 'deduction') then
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
