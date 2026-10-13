-- Allow HR to assign any named roster employee as an evaluator. If that
-- employee has no linked login yet, the assignment remains ready and begins
-- granting evaluation access once profiles.employee_id is linked.
alter table public.employee_evaluators
  alter column evaluator_profile_id drop not null;

create or replace function public.is_employee_evaluator(p_employee_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.employee_evaluators ee
    where ee.employee_id = p_employee_id
      and (
        ee.evaluator_profile_id = auth.uid()
        or exists (
          select 1 from public.profiles current_profile
          where current_profile.id = auth.uid()
            and current_profile.employee_id = ee.evaluator_employee_id
        )
      )
  )
$$;
revoke all on function public.is_employee_evaluator(uuid) from public;
grant execute on function public.is_employee_evaluator(uuid) to authenticated;

drop policy if exists "assigned evaluators read assigned employees" on public.employees;
create policy "assigned evaluators read assigned employees" on public.employees
for select to authenticated
using (public.is_employee_evaluator(id));

drop policy if exists "HR and assigned evaluators read evaluations" on public.evaluations;
create policy "HR and assigned evaluators read evaluations" on public.evaluations
for select to authenticated
using (public.current_app_role() in ('admin', 'hr') or public.is_employee_evaluator(employee_id));

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
using (
  exists (
    select 1 from public.evaluations e
    where e.id = evaluation_id
      and (public.current_app_role() in ('admin', 'hr') or public.is_employee_evaluator(e.employee_id))
  )
);

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
  if not public.is_employee_evaluator(p_employee_id) then
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
  if not exists (select 1 from public.employees where id = p_primary_evaluator_employee_id and status = 'active') then
    raise exception 'The first evaluator must be an active employee';
  end if;
  if p_secondary_evaluator_employee_id is not null and not exists (select 1 from public.employees where id = p_secondary_evaluator_employee_id and status = 'active') then
    raise exception 'The second evaluator must be an active employee';
  end if;

  select id into v_primary_profile_id from public.profiles where employee_id = p_primary_evaluator_employee_id;
  if p_secondary_evaluator_employee_id is not null then
    select id into v_secondary_profile_id from public.profiles where employee_id = p_secondary_evaluator_employee_id;
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
