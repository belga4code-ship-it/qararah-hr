-- Route accountants' leave requests to the branch manager and auditor.
-- Other employees continue through the branch manager and HR.
create or replace function public.initialize_leave_approval_steps()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_title text;
  v_department text;
  v_is_accountant boolean;
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

  select
    lower(v_department || ' ' || v_job_title) like '%محاسب%'
    or lower(v_department || ' ' || v_job_title) like '%حسابات%'
    or lower(v_department || ' ' || v_job_title) like '%محاسبة%'
    or lower(v_department || ' ' || v_job_title) like '%accountant%'
    or lower(v_department || ' ' || v_job_title) like '%accounting%'
    or exists (
      select 1
      from public.profiles p
      where p.employee_id = new.employee_id
        and (
          p.role::text = 'accountant'
          or 'accountant' = any(coalesce(p.user_roles, '{}'::text[]))
        )
    )
  into v_is_accountant;

  v_central_role := case when v_is_accountant then 'auditor' else 'hr' end;

  insert into public.hr_event_approval_steps(event_id, step_order, approver_role)
  values (new.id, 1, 'branch_manager'), (new.id, 2, v_central_role)
  on conflict (event_id, step_order) do nothing;
  return new;
end;
$$;

-- Correct the reviewer on requests already pending, without changing decisions
-- that have already been made.
with leave_routes as (
  select e.id,
    case when
      lower(coalesce(d.name, '') || ' ' || coalesce(j.name, '')) like '%محاسب%'
      or lower(coalesce(d.name, '') || ' ' || coalesce(j.name, '')) like '%حسابات%'
      or lower(coalesce(d.name, '') || ' ' || coalesce(j.name, '')) like '%محاسبة%'
      or lower(coalesce(d.name, '') || ' ' || coalesce(j.name, '')) like '%accountant%'
      or lower(coalesce(d.name, '') || ' ' || coalesce(j.name, '')) like '%accounting%'
      or exists (
        select 1 from public.profiles p
        where p.employee_id = e.employee_id
          and (p.role::text = 'accountant' or 'accountant' = any(coalesce(p.user_roles, '{}'::text[])))
      ) then 'auditor' else 'hr' end as central_role
  from public.hr_events e
  join public.employees emp on emp.id = e.employee_id
  left join public.departments d on d.id = emp.department_id
  left join public.job_titles j on j.id = emp.job_title_id
  where e.event_type = 'leave' and e.status = 'pending'
)
update public.hr_event_approval_steps s
set approver_role = r.central_role
from leave_routes r
where s.event_id = r.id
  and s.step_order = 2
  and s.status = 'pending'
  and s.approver_role is distinct from r.central_role;

with leave_routes as (
  select e.id,
    case when
      lower(coalesce(d.name, '') || ' ' || coalesce(j.name, '')) like '%محاسب%'
      or lower(coalesce(d.name, '') || ' ' || coalesce(j.name, '')) like '%حسابات%'
      or lower(coalesce(d.name, '') || ' ' || coalesce(j.name, '')) like '%محاسبة%'
      or lower(coalesce(d.name, '') || ' ' || coalesce(j.name, '')) like '%accountant%'
      or lower(coalesce(d.name, '') || ' ' || coalesce(j.name, '')) like '%accounting%'
      or exists (
        select 1 from public.profiles p
        where p.employee_id = e.employee_id
          and (p.role::text = 'accountant' or 'accountant' = any(coalesce(p.user_roles, '{}'::text[])))
      ) then 'auditor' else 'hr' end as central_role
  from public.hr_events e
  join public.employees emp on emp.id = e.employee_id
  left join public.departments d on d.id = emp.department_id
  left join public.job_titles j on j.id = emp.job_title_id
  where e.event_type = 'leave' and e.status = 'pending'
    and exists (
      select 1 from public.hr_event_approval_steps first_step
      where first_step.event_id = e.id and first_step.step_order = 1
    )
    and not exists (
      select 1 from public.hr_event_approval_steps second_step
      where second_step.event_id = e.id and second_step.step_order = 2
    )
)
insert into public.hr_event_approval_steps(event_id, step_order, approver_role)
select id, 2, central_role from leave_routes
on conflict (event_id, step_order) do nothing;
