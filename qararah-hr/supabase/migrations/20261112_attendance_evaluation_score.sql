-- Add a 0–100 attendance-and-departure item while preserving existing 1–4 criteria.
alter table public.evaluation_items drop constraint if exists evaluation_items_score_check;
alter table public.evaluation_items drop constraint if exists evaluation_items_max_score_check;
alter table public.evaluation_items
  add constraint evaluation_items_score_check check (score between 0 and 100),
  add constraint evaluation_items_max_score_check check (max_score between 1 and 100);

create or replace function public.submit_employee_evaluation(
  p_employee_id uuid, p_period_month date, p_notes text, p_items jsonb
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_branch_id uuid;
  v_evaluation_id uuid;
  v_month date := date_trunc('month', p_period_month)::date;
  v_total numeric(8,2);
  v_max numeric(8,2);
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
  if exists (
    select 1 from jsonb_array_elements(p_items) item
    where nullif(trim(item->>'criterion'), '') is null
      or case when item->>'criterion' = 'الالتزام بالحضور وإدارة الوقت وإنجاز المهام'
        then coalesce((item->>'score')::integer, -1) not between 0 and 100 or coalesce((item->>'max_score')::integer, 0) <> 100
        else coalesce((item->>'score')::integer, 0) not between 1 and 4 or coalesce((item->>'max_score')::integer, 4) <> 4
      end
  ) then raise exception 'Evaluation scores and criteria are invalid'; end if;
  select sum(case when item->>'criterion' = 'الالتزام بالحضور وإدارة الوقت وإنجاز المهام'
    then (item->>'score')::numeric / 25 else (item->>'score')::numeric end), count(*) * 4
    into v_total, v_max from jsonb_array_elements(p_items) item;
  insert into public.evaluations(employee_id, branch_id, period_month, evaluator_id, total_score, max_score, status, notes)
  values (p_employee_id, v_branch_id, v_month, auth.uid(), v_total, v_max, 'submitted', nullif(trim(p_notes), ''))
  on conflict (employee_id, period_month, evaluator_id) do update
    set total_score = excluded.total_score, max_score = excluded.max_score, status = 'submitted', notes = excluded.notes
  returning id into v_evaluation_id;
  delete from public.evaluation_items where evaluation_id = v_evaluation_id;
  insert into public.evaluation_items(evaluation_id, criterion, score, max_score, evidence)
  select v_evaluation_id, item->>'criterion', (item->>'score')::smallint, (item->>'max_score')::smallint,
    nullif(trim(item->>'evidence'), '') from jsonb_array_elements(p_items) item;
  return v_evaluation_id;
end;
$$;

revoke all on function public.submit_employee_evaluation(uuid, date, text, jsonb) from public;
grant execute on function public.submit_employee_evaluation(uuid, date, text, jsonb) to authenticated;
