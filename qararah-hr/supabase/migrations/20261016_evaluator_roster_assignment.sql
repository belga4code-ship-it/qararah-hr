-- Keep evaluator assignments tied to a person in the employee roster while
-- retaining the linked profile id used for authentication and access control.
alter table public.employee_evaluators
  add column if not exists evaluator_employee_id uuid references public.employees(id) on delete restrict;

update public.employee_evaluators ee
set evaluator_employee_id = p.employee_id
from public.profiles p
where p.id = ee.evaluator_profile_id
  and ee.evaluator_employee_id is null
  and p.employee_id is not null;

create unique index if not exists employee_evaluators_person_unique
  on public.employee_evaluators(employee_id, evaluator_employee_id)
  where evaluator_employee_id is not null;

drop function if exists public.set_employee_evaluators(uuid, uuid, uuid);
create function public.set_employee_evaluators(
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
  if public.current_app_role() not in ('admin', 'hr') then
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
    and p.role in ('admin', 'hr', 'branch_manager', 'accountant')
    and e.status = 'active';
  if v_primary_profile_id is null then
    raise exception 'The selected first evaluator needs an active employee record linked to a manager or HR account';
  end if;

  if p_secondary_evaluator_employee_id is not null then
    select p.id into v_secondary_profile_id
    from public.profiles p join public.employees e on e.id = p.employee_id
    where p.employee_id = p_secondary_evaluator_employee_id
      and p.role in ('admin', 'hr', 'branch_manager', 'accountant')
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
