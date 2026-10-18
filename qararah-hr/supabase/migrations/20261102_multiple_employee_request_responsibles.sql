-- Allow up to three employee-specific approvers for leave and permissions.
create table if not exists public.employee_request_responsibles (
  employee_id uuid not null references public.employees(id) on delete cascade,
  slot smallint not null check (slot between 1 and 3),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (employee_id, slot),
  unique (employee_id, profile_id)
);
alter table public.employee_request_responsibles enable row level security;
revoke all on public.employee_request_responsibles from anon, authenticated;
grant select on public.employee_request_responsibles to authenticated;
drop policy if exists "HR read employee request responsibles" on public.employee_request_responsibles;
create policy "HR read employee request responsibles" on public.employee_request_responsibles
for select to authenticated using (public.current_user_has_role('admin') or public.current_user_has_role('hr'));

alter table public.hr_event_approval_steps add column if not exists approver_profile_ids uuid[] not null default '{}'::uuid[];

create or replace function public.set_employee_request_responsibles(p_employee_id uuid, p_responsible_profile_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[] := coalesce(p_responsible_profile_ids, '{}'::uuid[]);
  v_slot record;
  v_first_employee_id uuid;
begin
  if not (public.current_user_has_role('admin') or public.current_user_has_role('hr')) then
    raise exception 'Only system administrators and human resources may assign employee responsibles';
  end if;
  if cardinality(v_ids) < 1 or cardinality(v_ids) > 3 then raise exception 'Choose between one and three responsible people'; end if;
  if (select count(distinct selected.profile_id) from unnest(v_ids) as selected(profile_id)) <> cardinality(v_ids) then raise exception 'Responsible people must be different'; end if;
  if not exists (select 1 from public.employees where id = p_employee_id) then raise exception 'Employee not found'; end if;
  if exists (
    select 1 from unnest(v_ids) selected(profile_id)
    left join public.profiles p on p.id = selected.profile_id
    where p.id is null or p.employee_id is null or p.employee_id = p_employee_id
  ) then raise exception 'Every responsible must have a distinct linked employee account'; end if;

  delete from public.employee_request_responsibles where employee_id = p_employee_id;
  for v_slot in select profile_id, ordinality from unnest(v_ids) with ordinality as selected(profile_id, ordinality) loop
    insert into public.employee_request_responsibles(employee_id, slot, profile_id)
    values (p_employee_id, v_slot.ordinality, v_slot.profile_id);
    if v_slot.ordinality = 1 then select employee_id into v_first_employee_id from public.profiles where id = v_slot.profile_id; end if;
  end loop;
  update public.employees set manager_id = v_first_employee_id where id = p_employee_id;
end;
$$;
revoke all on function public.set_employee_request_responsibles(uuid, uuid[]) from public;
grant execute on function public.set_employee_request_responsibles(uuid, uuid[]) to authenticated;

create or replace function public.is_assigned_hr_event_responsible(p_event_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.hr_events ev
    where ev.id = p_event_id and (
      case when ev.details ? 'responsible_profile_ids'
        then (ev.details -> 'responsible_profile_ids') ? auth.uid()::text
        when ev.details ? 'responsible_profile_id'
        then ev.details ->> 'responsible_profile_id' = auth.uid()::text
        else public.current_user_manages_employee(ev.employee_id)
      end
    )
  );
$$;
revoke all on function public.is_assigned_hr_event_responsible(uuid) from public;
grant execute on function public.is_assigned_hr_event_responsible(uuid) to authenticated;

create or replace function public.snapshot_hr_event_responsible()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_profile_ids uuid[];
begin
  if new.event_type not in ('leave', 'late_permission', 'permission') or new.status <> 'pending' then return new; end if;
  select array_agg(r.profile_id order by r.slot) into v_profile_ids
  from public.employee_request_responsibles r where r.employee_id = new.employee_id;
  if coalesce(cardinality(v_profile_ids), 0) = 0 then
    select array_agg(p.id order by p.created_at) into v_profile_ids
    from public.employees e join public.profiles p on p.employee_id = e.manager_id where e.id = new.employee_id;
  end if;
  if coalesce(cardinality(v_profile_ids), 0) = 0 then raise exception 'عيّن مسؤولاً واحداً على الأقل مرتبطاً بحساب دخول لهذا الموظف قبل إرسال الطلب'; end if;
  new.details := jsonb_set(coalesce(new.details, '{}'::jsonb), '{responsible_profile_ids}', to_jsonb(v_profile_ids), true);
  new.details := jsonb_set(new.details, '{responsible_profile_id}', to_jsonb(v_profile_ids[1]::text), true);
  return new;
end;
$$;

create or replace function public.initialize_leave_approval_steps()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_profile_ids uuid[];
begin
  if new.event_type <> 'leave' or new.status <> 'pending' then return new; end if;
  select array_agg(ids.profile_id::uuid) into v_profile_ids from jsonb_array_elements_text(coalesce(new.details -> 'responsible_profile_ids', '[]'::jsonb)) as ids(profile_id);
  if coalesce(cardinality(v_profile_ids), 0) = 0 and nullif(new.details ->> 'responsible_profile_id', '') is not null then
    v_profile_ids := array[(new.details ->> 'responsible_profile_id')::uuid];
  end if;
  insert into public.hr_event_approval_steps(event_id, step_order, approver_role, approver_profile_id, approver_profile_ids)
  values (new.id, 1, 'assigned_manager', v_profile_ids[1], coalesce(v_profile_ids, '{}'::uuid[]))
  on conflict (event_id, step_order) do nothing;
  return new;
end;
$$;

-- Update the snapshot and approval-step roster for pending leave requests.
with pending as (
  select ev.id, ev.details,
    coalesce(
      (select array_agg(r.profile_id order by r.slot) from public.employee_request_responsibles r where r.employee_id = ev.employee_id),
      (select array_agg(p.id order by p.created_at) from public.employees e join public.profiles p on p.employee_id = e.manager_id where e.id = ev.employee_id)
    ) as profile_ids
  from public.hr_events ev where ev.event_type = 'leave' and ev.status = 'pending'
), archived as (
  select p.id, p.profile_ids, jsonb_set(coalesce(p.details, '{}'::jsonb), '{previous_approval_steps}',
    coalesce((select jsonb_agg(jsonb_build_object('approver_role', s.approver_role, 'status', s.status, 'decided_by', s.decided_by, 'decided_at', s.decided_at, 'reason', s.reason) order by s.step_order) from public.hr_event_approval_steps s where s.event_id = p.id), '[]'::jsonb), true) as details
  from pending p
)
update public.hr_events ev set
  details = jsonb_set(jsonb_set(archived.details, '{responsible_profile_ids}', coalesce(to_jsonb(archived.profile_ids), '[]'::jsonb), true), '{responsible_profile_id}', coalesce(to_jsonb(archived.profile_ids[1]::text), 'null'::jsonb), true)
from archived where ev.id = archived.id;

delete from public.hr_event_approval_steps s using public.hr_events ev
where s.event_id = ev.id and ev.event_type = 'leave' and ev.status = 'pending';
insert into public.hr_event_approval_steps(event_id, step_order, approver_role, approver_profile_id, approver_profile_ids)
select ev.id, 1, 'assigned_manager', nullif(ev.details ->> 'responsible_profile_id', '')::uuid,
  coalesce((select array_agg(ids.profile_id::uuid) from jsonb_array_elements_text(coalesce(ev.details -> 'responsible_profile_ids', '[]'::jsonb)) as ids(profile_id)), '{}'::uuid[])
from public.hr_events ev where ev.event_type = 'leave' and ev.status = 'pending';

create or replace function public.decide_hr_event_approval(
  p_event_id uuid, p_status text, p_reason text, p_discount_type text default 'none', p_discount_value numeric default null
)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_is_override boolean := public.current_user_has_role('admin') or public.current_user_has_permission('effects.approve');
  v_event public.hr_events%rowtype;
  v_step public.hr_event_approval_steps%rowtype;
  v_salary numeric(12,2); v_amount numeric(12,2); v_days numeric(8,2);
  v_step_summary jsonb; v_decision_summary text;
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  if p_status not in ('approved', 'rejected') then raise exception 'Invalid approval decision'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'A decision reason is required'; end if;
  select * into v_event from public.hr_events where id = p_event_id and event_type = 'leave' and status = 'pending' for update;
  if not found then raise exception 'Leave request is not pending'; end if;
  select * into v_step from public.hr_event_approval_steps where event_id = p_event_id and status = 'pending' order by step_order limit 1 for update;
  if not found then raise exception 'No pending approval step was found'; end if;
  if not v_is_override then
    if v_step.approver_role = 'assigned_manager' then
      if not (auth.uid() = any(case when cardinality(v_step.approver_profile_ids) > 0 then v_step.approver_profile_ids else array[v_step.approver_profile_id] end)) then raise exception 'One of the assigned employee responsibles must decide this request'; end if;
    elsif v_step.approver_role = 'branch_manager' then
      if not public.current_user_has_role('branch_manager') or public.current_branch_id() is distinct from v_event.branch_id then raise exception 'The branch manager for this employee must decide first'; end if;
    elsif v_step.approver_role = 'auditor' then
      if not public.current_user_has_role('auditor') then raise exception 'An auditor must decide this leave request'; end if;
    elsif v_step.approver_role = 'hr' then
      if not public.current_user_has_role('hr') then raise exception 'Human resources must decide this leave request'; end if;
    end if;
  end if;
  if p_status = 'approved' and coalesce(p_discount_type, 'none') <> 'none' and not (v_is_override or v_step.approver_role = 'assigned_manager' or v_step.approver_role in ('auditor', 'hr')) then raise exception 'The leave deduction can only be set by an authorized final approver'; end if;
  if v_is_override and p_status = 'approved' then
    update public.hr_event_approval_steps set status = 'approved', decided_by = auth.uid(), decided_at = now(), reason = trim(p_reason) where event_id = p_event_id and status = 'pending';
  else
    update public.hr_event_approval_steps set status = p_status, decided_by = auth.uid(), decided_at = now(), reason = trim(p_reason) where id = v_step.id;
  end if;
  if p_status = 'rejected' then update public.hr_event_approval_steps set status = 'skipped', reason = 'توقفت الموافقات بعد رفض الطلب' where event_id = p_event_id and status = 'pending' and step_order > v_step.step_order; end if;
  select jsonb_agg(jsonb_build_object('step_order', s.step_order, 'approver_role', s.approver_role, 'approver_profile_ids', s.approver_profile_ids, 'status', s.status, 'decided_by', s.decided_by, 'decided_at', s.decided_at, 'reason', s.reason) order by s.step_order),
    string_agg(case s.approver_role when 'assigned_manager' then 'المسؤول المعيّن' when 'branch_manager' then 'مدير الفرع' when 'auditor' then 'مراجع الحسابات' else 'الموارد البشرية' end || ': ' || coalesce(s.reason, ''), E'\n' order by s.step_order)
  into v_step_summary, v_decision_summary from public.hr_event_approval_steps s where s.event_id = p_event_id;
  if p_status = 'rejected' then
    update public.hr_events set status = 'rejected', decision_reason = v_decision_summary, details = jsonb_set(coalesce(details, '{}'::jsonb), '{approval_steps}', coalesce(v_step_summary, '[]'::jsonb), true) where id = p_event_id; return;
  end if;
  if exists (select 1 from public.hr_event_approval_steps where event_id = p_event_id and status = 'pending') then update public.hr_events set details = jsonb_set(coalesce(details, '{}'::jsonb), '{approval_steps}', coalesce(v_step_summary, '[]'::jsonb), true) where id = p_event_id; return; end if;
  case coalesce(p_discount_type, 'none')
    when 'none' then v_amount := null; v_days := null;
    when 'fixed' then if coalesce(p_discount_value, 0) <= 0 then raise exception 'A positive fixed discount amount is required'; end if; v_amount := round(p_discount_value, 2); v_days := null;
    when 'days' then if coalesce(p_discount_value, 0) <= 0 then raise exception 'A positive number of discount days is required'; end if; select salary_amount into v_salary from public.employee_private where employee_id = v_event.employee_id; if coalesce(v_salary, 0) <= 0 then raise exception 'Employee salary is not registered'; end if; v_days := p_discount_value; v_amount := round(v_salary / 30 * v_days, 2);
    when 'half_day' then select salary_amount into v_salary from public.employee_private where employee_id = v_event.employee_id; if coalesce(v_salary, 0) <= 0 then raise exception 'Employee salary is not registered'; end if; v_days := 0.5; v_amount := round(v_salary / 30 * v_days, 2);
    when 'quarter_day' then select salary_amount into v_salary from public.employee_private where employee_id = v_event.employee_id; if coalesce(v_salary, 0) <= 0 then raise exception 'Employee salary is not registered'; end if; v_days := 0.25; v_amount := round(v_salary / 30 * v_days, 2);
    else raise exception 'Invalid leave discount type';
  end case;
  update public.hr_events set status = 'approved', decision_reason = v_decision_summary, amount = v_amount,
    amount_unit = case when v_amount is null then null else 'LYD' end,
    details = jsonb_set(jsonb_set(jsonb_set(coalesce(details, '{}'::jsonb), '{approval_steps}', coalesce(v_step_summary, '[]'::jsonb), true), '{leave_discount_type}', to_jsonb(coalesce(p_discount_type, 'none')), true), '{leave_discount_days}', coalesce(to_jsonb(v_days), 'null'::jsonb), true)
  where id = p_event_id;
end;
$$;
revoke all on function public.decide_hr_event_approval(uuid, text, text, text, numeric) from public;
grant execute on function public.decide_hr_event_approval(uuid, text, text, text, numeric) to authenticated;

