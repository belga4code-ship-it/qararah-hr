-- Auditors can create and decide salary deductions, and submit employee
-- evaluations. Other HR event decisions and goal management remain restricted.

drop policy if exists "auditor insert approved deductions" on public.hr_events;
create policy "auditor insert approved deductions" on public.hr_events
for insert to authenticated
with check (
  public.current_app_role()::text = 'auditor'
  and event_type = 'deduction'
  and status = 'approved'
  and amount > 0
  and amount_unit = 'LYD'
  and created_by = auth.uid()
  and approved_by = auth.uid()
  and approved_at is not null
  and decision_by = auth.uid()
  and decision_at is not null
  and payroll_recorded_by = auth.uid()
  and payroll_recorded_at is not null
  and nullif(trim(reason), '') is not null
  and nullif(trim(decision_reason), '') is not null
  and exists (
    select 1 from public.employees e
    where e.id = public.hr_events.employee_id and e.branch_id = public.hr_events.branch_id
  )
);

drop policy if exists "auditor decide deductions" on public.hr_events;
create policy "auditor decide deductions" on public.hr_events
for update to authenticated
using (
  public.current_app_role()::text = 'auditor'
  and event_type = 'deduction'
  and status = 'pending'
)
with check (
  public.current_app_role()::text = 'auditor'
  and event_type = 'deduction'
  and status in ('approved', 'rejected')
);

create or replace function public.record_hr_event_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'pending' and new.status in ('approved', 'rejected') then
    if public.current_app_role()::text = 'auditor' and (
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
    if public.current_app_role() not in ('admin', 'hr')
      and not (public.current_app_role()::text = 'auditor' and new.event_type = 'deduction') then
      raise exception 'You are not allowed to decide this request';
    end if;
    if nullif(trim(new.decision_reason), '') is null then
      raise exception 'A decision reason is required';
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

-- The security-definer RPC remains the only path for creating evaluation rows.
-- Auditors may evaluate without being assigned; other roles still need an assignment.
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
  if public.current_app_role() not in ('admin', 'hr')
    and public.current_app_role()::text <> 'auditor'
    and not exists (
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
