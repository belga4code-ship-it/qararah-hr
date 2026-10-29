-- Only HR records the leave deduction decision. It is independent from the approval order;
-- the chosen amount is applied only if the request eventually receives final approval.
create table if not exists public.hr_leave_discount_decisions (
  event_id uuid primary key references public.hr_events(id) on delete cascade,
  discount_type text not null check (discount_type in ('none', 'fixed', 'days', 'half_day', 'quarter_day')),
  discount_value numeric,
  decided_by uuid not null references public.profiles(id),
  decided_at timestamptz not null default now(),
  check ((discount_type in ('fixed', 'days') and discount_value > 0) or (discount_type not in ('fixed', 'days') and discount_value is null))
);

alter table public.hr_leave_discount_decisions enable row level security;
revoke all on public.hr_leave_discount_decisions from anon, authenticated;
grant select on public.hr_leave_discount_decisions to authenticated;
drop policy if exists "HR and admins read leave discount decisions" on public.hr_leave_discount_decisions;
create policy "HR and admins read leave discount decisions" on public.hr_leave_discount_decisions
for select to authenticated
using (public.current_user_has_role('hr') or public.current_user_has_role('admin'));

create or replace function public.set_hr_leave_discount(
  p_event_id uuid,
  p_discount_type text,
  p_discount_value numeric default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.hr_events%rowtype;
  v_previous public.hr_leave_discount_decisions%rowtype;
  v_salary numeric;
  v_had_previous boolean;
begin
  if auth.uid() is null or not public.current_user_has_role('hr') then
    raise exception 'Only Human Resources may decide the leave deduction';
  end if;

  if p_discount_type not in ('none', 'fixed', 'days', 'half_day', 'quarter_day') then
    raise exception 'Invalid leave discount type';
  end if;

  select * into v_event
    from public.hr_events
   where id = p_event_id and event_type = 'leave' and status = 'pending'
   for update;
  if not found then raise exception 'طلب الإجازة غير موجود أو لم يعد قيد المراجعة'; end if;

  if p_discount_type in ('fixed', 'days') and coalesce(p_discount_value, 0) <= 0 then
    raise exception 'A positive discount amount or number of days is required';
  end if;
  if p_discount_type in ('half_day', 'quarter_day') then
    select salary_amount into v_salary from public.employee_private where employee_id = v_event.employee_id;
    if coalesce(v_salary, 0) <= 0 then raise exception 'Employee salary is not registered'; end if;
  end if;

  select * into v_previous from public.hr_leave_discount_decisions where event_id = p_event_id;
  v_had_previous := found;
  insert into public.hr_leave_discount_decisions(event_id, discount_type, discount_value, decided_by, decided_at)
  values (p_event_id, p_discount_type, case when p_discount_type in ('fixed', 'days') then p_discount_value else null end, auth.uid(), now())
  on conflict (event_id) do update
    set discount_type = excluded.discount_type,
        discount_value = excluded.discount_value,
        decided_by = excluded.decided_by,
        decided_at = excluded.decided_at;

  insert into public.audit_log(entity_table, entity_id, employee_id, branch_id, action, changed_fields, old_data, new_data, actor_id)
  values (
    'hr_leave_discount_decisions', p_event_id, v_event.employee_id, v_event.branch_id,
    case when v_had_previous then 'UPDATE' else 'INSERT' end,
    array['discount_type', 'discount_value'],
    case when v_previous.event_id is null then null else jsonb_build_object('discount_type', v_previous.discount_type, 'discount_value', v_previous.discount_value) end,
    jsonb_build_object('discount_type', p_discount_type, 'discount_value', case when p_discount_type in ('fixed', 'days') then p_discount_value else null end),
    auth.uid()
  );
end;
$$;

revoke all on function public.set_hr_leave_discount(uuid, text, numeric) from public, anon;
grant execute on function public.set_hr_leave_discount(uuid, text, numeric) to authenticated;

create or replace function public.decide_employee_request(
  p_event_id uuid,
  p_status text,
  p_reason text,
  p_discount_type text default 'none',
  p_discount_value numeric default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  ev public.hr_events%rowtype;
  own_step public.hr_event_approval_steps%rowtype;
  is_admin boolean := public.current_user_has_role('admin');
  final_approval boolean;
  summary jsonb;
  summary_text text;
  saved_discount public.hr_leave_discount_decisions%rowtype;
  discount_type text := 'none';
  discount_value numeric;
  salary numeric;
  discount numeric;
  days numeric;
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  if p_status is null or p_status not in ('approved', 'rejected') then raise exception 'Invalid approval decision'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'A decision reason is required'; end if;
  if coalesce(p_discount_type, 'none') <> 'none' or p_discount_value is not null then
    raise exception 'Only Human Resources may record a leave deduction decision';
  end if;

  select * into ev
    from public.hr_events
   where id = p_event_id and event_type in ('leave', 'permission', 'late_permission')
   for update;
  if not found or ev.status <> 'pending' then raise exception 'Request is not pending'; end if;

  if not is_admin then
    if public.current_user_has_role('branch_manager') and public.current_branch_id() is distinct from ev.branch_id then
      raise exception 'Request is outside your branch';
    end if;
    select * into own_step
      from public.hr_event_approval_steps
     where event_id = p_event_id and approver_profile_id = auth.uid() and status = 'pending'
     for update;
    if not found then raise exception 'No pending individual approval is assigned to this account'; end if;
  end if;

  final_approval := is_admin or (
    select count(*) = 1 from public.hr_event_approval_steps where event_id = p_event_id and status = 'pending'
  );

  if p_status = 'approved' and final_approval and ev.event_type = 'leave' then
    select * into saved_discount from public.hr_leave_discount_decisions where event_id = p_event_id;
    if not found then raise exception 'بانتظار تسجيل قرار الموارد البشرية بشأن الخصم أو اختيار بدون خصم'; end if;
    discount_type := saved_discount.discount_type;
    discount_value := saved_discount.discount_value;
    case discount_type
      when 'none' then discount := null; days := null;
      when 'fixed' then
        if coalesce(discount_value, 0) <= 0 then raise exception 'A positive discount amount is required'; end if;
        discount := round(discount_value, 2);
      when 'days', 'half_day', 'quarter_day' then
        days := case discount_type when 'days' then discount_value when 'half_day' then 0.5 else 0.25 end;
        if coalesce(days, 0) <= 0 then raise exception 'A positive number of days is required'; end if;
        select salary_amount into salary from public.employee_private where employee_id = ev.employee_id;
        if coalesce(salary, 0) <= 0 then raise exception 'Employee salary is not registered'; end if;
        discount := round(salary / 30 * days, 2);
      else raise exception 'Invalid saved HR leave discount decision';
    end case;
  end if;

  if not is_admin then
    update public.hr_event_approval_steps
       set status = p_status, decided_by = auth.uid(), decided_at = now(), reason = trim(p_reason)
     where id = own_step.id;
  end if;
  if p_status = 'rejected' or is_admin then
    update public.hr_event_approval_steps
       set status = 'skipped', reason = case when is_admin then 'تجاوز مدير النظام هذه الموافقة' else 'توقفت الموافقات بعد رفض الطلب' end
     where event_id = p_event_id and status = 'pending';
  end if;

  select jsonb_agg(to_jsonb(s) order by step_order),
         string_agg('المسؤول ' || step_order || ': ' || coalesce(reason, ''), E'\n' order by step_order)
    into summary, summary_text
    from public.hr_event_approval_steps s where event_id = p_event_id;

  if p_status = 'approved' and not final_approval then
    update public.hr_events
       set details = jsonb_set(coalesce(details, '{}'::jsonb), '{approval_steps}', coalesce(summary, '[]'::jsonb), true)
     where id = p_event_id;
    return 'pending';
  end if;

  update public.hr_events
     set status = p_status,
         decision_reason = case when is_admin then trim(p_reason) else coalesce(summary_text, trim(p_reason)) end,
         amount = case when ev.event_type = 'leave' and p_status = 'approved' then discount else amount end,
         amount_unit = case when ev.event_type = 'leave' and p_status = 'approved' then case when discount is null then null else 'LYD' end else amount_unit end,
         details = jsonb_set(
           coalesce(details, '{}'::jsonb) || case when ev.event_type = 'leave' and p_status = 'approved'
             then jsonb_build_object('leave_discount_type', discount_type, 'leave_discount_days', days)
             else '{}'::jsonb end,
           '{approval_steps}', coalesce(summary, '[]'::jsonb), true
         )
   where id = p_event_id;
  return p_status;
end;
$$;

revoke all on function public.decide_employee_request(uuid, text, text, text, numeric) from public;
grant execute on function public.decide_employee_request(uuid, text, text, text, numeric) to authenticated;

create or replace function public.decide_hr_event_approval(
  p_event_id uuid,
  p_status text,
  p_reason text,
  p_discount_type text default 'none',
  p_discount_value numeric default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.decide_employee_request(p_event_id, p_status, p_reason, p_discount_type, p_discount_value);
end;
$$;

revoke all on function public.decide_hr_event_approval(uuid, text, text, text, numeric) from public;
grant execute on function public.decide_hr_event_approval(uuid, text, text, text, numeric) to authenticated;
