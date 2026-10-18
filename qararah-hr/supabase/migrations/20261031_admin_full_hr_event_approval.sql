-- Give the system administrator full approval authority for HR requests, including every leave approval stage and its final discount.
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
    if not v_is_admin and (not public.current_user_has_role('branch_manager') or public.current_branch_id() is distinct from v_event.branch_id) then
      raise exception 'The branch manager for this employee must decide first';
    end if;
  elsif v_step.approver_role = 'auditor' then
    if not v_is_admin and not public.current_user_has_role('auditor') then raise exception 'An auditor must decide this leave request'; end if;
  elsif v_step.approver_role = 'hr' then
    if not public.current_user_has_role('admin') and not public.current_user_has_role('hr') then raise exception 'Human resources must decide this leave request'; end if;
  end if;

  if p_status = 'approved' and v_step.approver_role = 'branch_manager' and coalesce(p_discount_type, 'none') <> 'none' and not v_is_admin then
    raise exception 'The leave deduction can only be set by the final approver';
  end if;

  if v_is_admin and p_status = 'approved' then
    update public.hr_event_approval_steps
    set status = 'approved', decided_by = auth.uid(), decided_at = now(), reason = trim(p_reason)
    where event_id = p_event_id and status = 'pending';
  else
    update public.hr_event_approval_steps
    set status = p_status, decided_by = auth.uid(), decided_at = now(), reason = trim(p_reason)
    where id = v_step.id;
  end if;

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
