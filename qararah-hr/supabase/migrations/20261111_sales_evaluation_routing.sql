-- Route sales employees to their branch manager and Khaled from HR.
-- A manager's cross-branch access is limited to employees explicitly assigned
-- to them for evaluation; this does not widen their general branch access.

create table if not exists public.employee_evaluator_branch_scopes (
  evaluator_profile_id uuid not null references public.profiles(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (evaluator_profile_id, branch_id)
);

alter table public.employee_evaluator_branch_scopes enable row level security;

-- Ahmed Abu Zaqiya manages both locations, which have separate branch records.
insert into public.employee_evaluator_branch_scopes (evaluator_profile_id, branch_id)
select p.id, b.id
from public.profiles p
join public.employees manager on manager.id = p.employee_id
join public.branches manager_branch on manager_branch.id = p.branch_id
join public.branches b on b.name in ('السبعة', 'VIP', 'vip')
where manager.employee_number = 'HR-EMP-VIP-1004'
  and manager_branch.name = 'السبعة & vip'
  and (p.role = 'branch_manager' or 'branch_manager' = any(coalesce(p.user_roles, '{}'::text[])))
on conflict do nothing;

create or replace function public.sync_sales_employee_evaluators()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_hr_profile_id uuid;
  v_hr_employee_id uuid;
  v_manager_profile_id uuid;
  v_manager_employee_id uuid;
  v_manager_count integer;
  v_is_sales boolean;
begin
  select jt.name in ('مسئول مبيعات', 'مسؤول مبيعات', 'مسئول أول مبيعات', 'مسؤول أول مبيعات')
  into v_is_sales
  from public.job_titles jt
  where jt.id = new.job_title_id;

  if new.status <> 'active' or coalesce(v_is_sales, false) = false then
    return new;
  end if;

  select p.id, p.employee_id into v_hr_profile_id, v_hr_employee_id
  from public.profiles p
  join public.employees hr_employee on hr_employee.id = p.employee_id and hr_employee.status = 'active'
  where hr_employee.employee_number = 'HR-EMP-00176'
    and (p.role = 'hr' or 'hr' = any(coalesce(p.user_roles, '{}'::text[])))
  limit 1;

  if v_hr_profile_id is null then
    return new;
  end if;

  select count(*) into v_manager_count
  from public.profiles p
  join public.employees manager on manager.id = p.employee_id and manager.status = 'active'
  where (p.role = 'branch_manager' or 'branch_manager' = any(coalesce(p.user_roles, '{}'::text[])))
    and (p.branch_id = new.branch_id or exists (
      select 1 from public.employee_evaluator_branch_scopes s
      where s.evaluator_profile_id = p.id and s.branch_id = new.branch_id
    ));

  if v_manager_count = 1 then
    select p.id, p.employee_id into v_manager_profile_id, v_manager_employee_id
    from public.profiles p
    join public.employees manager on manager.id = p.employee_id and manager.status = 'active'
    where (p.role = 'branch_manager' or 'branch_manager' = any(coalesce(p.user_roles, '{}'::text[])))
      and (p.branch_id = new.branch_id or exists (
        select 1 from public.employee_evaluator_branch_scopes s
        where s.evaluator_profile_id = p.id and s.branch_id = new.branch_id
      ));
  end if;

  delete from public.employee_evaluators where employee_id = new.id;
  if v_manager_count = 1 and v_manager_profile_id is not null and v_manager_employee_id is not null then
    insert into public.employee_evaluators(employee_id, slot, evaluator_profile_id, evaluator_employee_id)
    values (new.id, 1, v_manager_profile_id, v_manager_employee_id);
    insert into public.employee_evaluators(employee_id, slot, evaluator_profile_id, evaluator_employee_id)
    values (new.id, 2, v_hr_profile_id, v_hr_employee_id);
  else
    -- A branch without a configured manager is reviewed by HR until one is assigned.
    insert into public.employee_evaluators(employee_id, slot, evaluator_profile_id, evaluator_employee_id)
    values (new.id, 1, v_hr_profile_id, v_hr_employee_id);
  end if;
  return new;
end;
$$;

drop trigger if exists sync_sales_employee_evaluators on public.employees;
create trigger sync_sales_employee_evaluators
after insert or update of job_title_id, branch_id, status on public.employees
for each row execute function public.sync_sales_employee_evaluators();

-- Backfill current active sales employees using the same rule as the trigger.
do $$
declare
  e record;
  h record;
  m record;
  manager_count integer;
begin
  select p.id, p.employee_id into h
  from public.profiles p
  join public.employees employee on employee.id = p.employee_id and employee.status = 'active'
  where employee.employee_number = 'HR-EMP-00176'
    and (p.role = 'hr' or 'hr' = any(coalesce(p.user_roles, '{}'::text[])))
  limit 1;

  if h.id is null then
    raise exception 'Active HR evaluator HR-EMP-00176 is not linked to a profile';
  end if;

  for e in
    select employee.id, employee.branch_id
    from public.employees employee
    join public.job_titles jt on jt.id = employee.job_title_id
    where employee.status = 'active'
      and jt.name in ('مسئول مبيعات', 'مسؤول مبيعات', 'مسئول أول مبيعات', 'مسؤول أول مبيعات')
  loop
    select count(*) into manager_count
    from public.profiles p
    join public.employees manager on manager.id = p.employee_id and manager.status = 'active'
    where (p.role = 'branch_manager' or 'branch_manager' = any(coalesce(p.user_roles, '{}'::text[])))
      and (p.branch_id = e.branch_id or exists (
        select 1 from public.employee_evaluator_branch_scopes s
        where s.evaluator_profile_id = p.id and s.branch_id = e.branch_id
      ));

    delete from public.employee_evaluators where employee_id = e.id;
    if manager_count = 1 then
      select p.id, p.employee_id into m
      from public.profiles p
      join public.employees manager on manager.id = p.employee_id and manager.status = 'active'
      where (p.role = 'branch_manager' or 'branch_manager' = any(coalesce(p.user_roles, '{}'::text[])))
        and (p.branch_id = e.branch_id or exists (
          select 1 from public.employee_evaluator_branch_scopes s
          where s.evaluator_profile_id = p.id and s.branch_id = e.branch_id
        ));
      insert into public.employee_evaluators(employee_id, slot, evaluator_profile_id, evaluator_employee_id)
      values (e.id, 1, m.id, m.employee_id);
      insert into public.employee_evaluators(employee_id, slot, evaluator_profile_id, evaluator_employee_id)
      values (e.id, 2, h.id, h.employee_id);
    else
      insert into public.employee_evaluators(employee_id, slot, evaluator_profile_id, evaluator_employee_id)
      values (e.id, 1, h.id, h.employee_id);
    end if;
  end loop;
end;
$$;

-- Cross-branch viewing remains limited to employees explicitly assigned for evaluation.
drop policy if exists "assigned evaluators read assigned employees" on public.employees;
create policy "assigned evaluators read assigned employees" on public.employees
for select to authenticated
using (public.is_employee_evaluator(id));

-- Evaluators can see their own assignment rows, including targets in a
-- separately managed branch, without seeing anyone else's assignments.
drop policy if exists "evaluators read own assignments" on public.employee_evaluators;
create policy "evaluators read own assignments" on public.employee_evaluators
for select to authenticated
using (evaluator_profile_id = auth.uid());

drop policy if exists "HR and assigned evaluators read evaluations" on public.evaluations;
create policy "HR and assigned evaluators read evaluations" on public.evaluations
for select to authenticated
using (public.current_user_has_role('admin') or public.current_user_has_role('hr')
  or public.is_employee_evaluator(employee_id));

drop policy if exists "assigned evaluators create evaluations" on public.evaluations;
create policy "assigned evaluators create evaluations" on public.evaluations
for insert to authenticated
with check (evaluator_id = auth.uid() and public.is_employee_evaluator(employee_id));

drop policy if exists "assigned evaluators update own evaluations" on public.evaluations;
create policy "assigned evaluators update own evaluations" on public.evaluations
for update to authenticated
using (evaluator_id = auth.uid() and public.is_employee_evaluator(employee_id))
with check (evaluator_id = auth.uid() and public.is_employee_evaluator(employee_id));

drop policy if exists "HR and assigned evaluators read evaluation items" on public.evaluation_items;
create policy "HR and assigned evaluators read evaluation items" on public.evaluation_items
for select to authenticated
using (exists (select 1 from public.evaluations ev where ev.id = evaluation_items.evaluation_id
  and (public.current_user_has_role('admin') or public.current_user_has_role('hr')
    or public.is_employee_evaluator(ev.employee_id))));

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
  if public.current_user_has_role('branch_manager')
    and v_branch_id is distinct from public.current_branch_id()
    and not exists (select 1 from public.employee_evaluators ee where ee.employee_id = p_employee_id and ee.evaluator_profile_id = auth.uid()) then
    raise exception 'Cross-branch evaluation requires an explicit evaluator assignment';
  end if;
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

revoke all on function public.sync_sales_employee_evaluators() from public;
