-- Allow HR/admin to submit the same itemized employee evaluation from the
-- employee overview. Other users still need an explicit evaluator assignment.
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
  if public.current_app_role() not in ('admin', 'hr') and not exists (
    select 1 from public.employee_evaluators ee
    where ee.employee_id = p_employee_id and ee.evaluator_profile_id = auth.uid()
  ) then
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
