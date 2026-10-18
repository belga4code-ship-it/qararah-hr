-- Every assigned responsible decides independently. Only admin can override.
begin;
alter table public.hr_event_approval_steps drop constraint if exists hr_event_approval_steps_step_order_check;
alter table public.hr_event_approval_steps add constraint hr_event_approval_steps_step_order_check check (step_order between 1 and 3);
alter table public.hr_event_approval_steps drop constraint if exists hr_event_approval_steps_event_id_approver_role_key;

create or replace function public.initialize_leave_approval_steps()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.event_type not in ('leave','permission','late_permission') or new.status <> 'pending' then return new; end if;
  insert into public.hr_event_approval_steps(event_id,step_order,approver_role,approver_profile_id,approver_profile_ids)
  select new.id, ids.ordinality, 'assigned_manager', ids.profile_id::uuid, array[ids.profile_id::uuid]
  from jsonb_array_elements_text(coalesce(new.details->'responsible_profile_ids',
    case when nullif(new.details->>'responsible_profile_id','') is not null then jsonb_build_array(new.details->>'responsible_profile_id') else '[]'::jsonb end)) with ordinality ids(profile_id,ordinality)
  on conflict(event_id,step_order) do nothing;
  return new;
end;
$$;

-- Convert pending grouped requests only; retain each recorded actor's decision.
-- Completed requests are never silently reopened by this migration.
do $$
declare ev record; old_steps jsonb; ids uuid[]; responsible uuid; pos integer; decision jsonb;
begin
  for ev in select * from public.hr_events where status='pending' and event_type in ('leave','permission','late_permission') for update loop
    select array_agg(value::uuid order by ordinality) into ids from jsonb_array_elements_text(coalesce(ev.details->'responsible_profile_ids',
      case when nullif(ev.details->>'responsible_profile_id','') is not null then jsonb_build_array(ev.details->>'responsible_profile_id') else '[]'::jsonb end)) with ordinality;
    if coalesce(cardinality(ids),0)=0 then continue; end if;
    if cardinality(ids)>3 then raise exception 'Request has more than three responsibles: %',ev.id; end if;
    select coalesce(jsonb_agg(to_jsonb(s) order by step_order),'[]'::jsonb) into old_steps from public.hr_event_approval_steps s where event_id=ev.id;
    update public.hr_events set details=jsonb_set(coalesce(details,'{}'::jsonb),'{individual_approval_migration}',old_steps,true) where id=ev.id and not coalesce(details,'{}'::jsonb) ? 'individual_approval_migration';
    delete from public.hr_event_approval_steps where event_id=ev.id;
    for pos in 1..cardinality(ids) loop
      responsible:=ids[pos];
      select value into decision from jsonb_array_elements(old_steps) where value->>'decided_by'=responsible::text and value->>'status' in ('approved','rejected') limit 1;
      insert into public.hr_event_approval_steps(event_id,step_order,approver_role,approver_profile_id,approver_profile_ids,status,decided_by,decided_at,reason)
      values(ev.id,pos,'assigned_manager',responsible,array[responsible],coalesce(decision->>'status','pending'),
        (decision->>'decided_by')::uuid,(decision->>'decided_at')::timestamptz,decision->>'reason');
    end loop;
  end loop;
end;
$$;

-- The request snapshot and decision ledger cannot be bypassed with a direct UPDATE.
create or replace function public.guard_individual_request_approval()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or old.event_type not in ('leave','permission','late_permission') then return new; end if;
  if new.employee_id is distinct from old.employee_id or new.branch_id is distinct from old.branch_id
    or new.event_type is distinct from old.event_type
    or new.details->'responsible_profile_ids' is distinct from old.details->'responsible_profile_ids'
    or new.details->'responsible_profile_id' is distinct from old.details->'responsible_profile_id' then
    raise exception 'Request responsibility snapshot cannot be changed';
  end if;
  if old.status <> 'pending' and new.status is distinct from old.status then raise exception 'Completed requests cannot be reopened through a decision'; end if;
  if old.status='pending' and new.status in ('approved','rejected') then
    if nullif(trim(new.decision_reason),'') is null then raise exception 'A decision reason is required'; end if;
    if public.current_user_has_role('admin') then
      if new.status='approved' then
        update public.hr_event_approval_steps set status='skipped',reason='تجاوز مدير النظام هذه الموافقة'
        where event_id=old.id and status='pending';
        new.details:=jsonb_set(coalesce(new.details,'{}'::jsonb),'{admin_override}',jsonb_build_object('profile_id',auth.uid(),'decided_at',now(),'reason',new.decision_reason),true);
      end if;
    else
      if not public.is_assigned_hr_event_responsible(old.id) then raise exception 'Only an assigned responsible or system administrator may decide'; end if;
      if new.status='approved' and (not exists(select 1 from public.hr_event_approval_steps where event_id=old.id)
        or exists(select 1 from public.hr_event_approval_steps where event_id=old.id and status<>'approved')) then
        raise exception 'All assigned responsibles must approve';
      end if;
      if not exists(select 1 from public.hr_event_approval_steps where event_id=old.id and status=new.status and decided_by=auth.uid()) then
        raise exception 'The deciding actor must have a recorded individual decision';
      end if;
    end if;
    new.decision_by:=auth.uid(); new.decision_at:=now();
    if new.status='approved' then
      new.approved_by:=auth.uid(); new.approved_at:=now();
      if new.event_type='leave' and coalesce(new.amount,0)>0 then new.payroll_recorded_at:=now(); new.payroll_recorded_by:=auth.uid(); end if;
    else
      new.approved_by:=null;new.approved_at:=null;new.payroll_recorded_at:=null;new.payroll_recorded_by:=null;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_individual_request_approval on public.hr_events;
create trigger guard_individual_request_approval before update on public.hr_events for each row execute function public.guard_individual_request_approval();

create or replace function public.guard_individual_request_submission()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is not null and new.event_type in ('leave','permission','late_permission')
    and not public.current_user_has_role('admin') and (new.status<>'pending' or new.decision_by is not null or new.approved_by is not null) then
    raise exception 'Employee requests must start pending without approval';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_individual_request_submission on public.hr_events;
create trigger guard_individual_request_submission before insert on public.hr_events for each row execute function public.guard_individual_request_submission();

-- Keep the legacy audit trigger for other event types, including payroll deductions.
drop trigger if exists hr_event_decision_audit on public.hr_events;
create trigger hr_event_decision_audit before update of status on public.hr_events
for each row when (old.event_type not in ('leave','permission','late_permission'))
execute function public.record_hr_event_decision();

create or replace function public.decide_employee_request(
  p_event_id uuid,p_status text,p_reason text,p_discount_type text default 'none',p_discount_value numeric default null
) returns text language plpgsql security definer set search_path=public as $$
declare
  ev public.hr_events%rowtype; own_step public.hr_event_approval_steps%rowtype;
  is_admin boolean:=public.current_user_has_role('admin'); final_approval boolean;
  summary jsonb; summary_text text; salary numeric; discount numeric; days numeric;
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  if p_status is null or p_status not in ('approved','rejected') then raise exception 'Invalid approval decision'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'A decision reason is required'; end if;
  select * into ev from public.hr_events where id=p_event_id and event_type in ('leave','permission','late_permission') for update;
  if not found or ev.status<>'pending' then raise exception 'Request is not pending'; end if;
  if not is_admin then
    if public.current_user_has_role('branch_manager') and public.current_branch_id() is distinct from ev.branch_id then raise exception 'Request is outside your branch'; end if;
    select * into own_step from public.hr_event_approval_steps where event_id=p_event_id and approver_profile_id=auth.uid() and status='pending' for update;
    if not found then raise exception 'No pending individual approval is assigned to this account'; end if;
  end if;
  final_approval:=is_admin or (select count(*)=1 from public.hr_event_approval_steps where event_id=p_event_id and status='pending');
  if coalesce(p_discount_type,'none')<>'none' and (ev.event_type<>'leave' or p_status<>'approved' or not final_approval) then raise exception 'Only the final leave approval can set a discount'; end if;
  if p_status='approved' and final_approval and ev.event_type='leave' then
    case coalesce(p_discount_type,'none')
      when 'none' then discount:=null;days:=null;
      when 'fixed' then if coalesce(p_discount_value,0)<=0 then raise exception 'A positive discount amount is required';end if;discount:=round(p_discount_value,2);
      when 'days','half_day','quarter_day' then
        days:=case p_discount_type when 'days' then p_discount_value when 'half_day' then 0.5 else 0.25 end;
        if coalesce(days,0)<=0 then raise exception 'A positive number of days is required';end if;
        select salary_amount into salary from public.employee_private where employee_id=ev.employee_id;
        if coalesce(salary,0)<=0 then raise exception 'Employee salary is not registered';end if;
        discount:=round(salary/30*days,2);
      else raise exception 'Invalid discount type';
    end case;
  end if;
  if not is_admin then
    update public.hr_event_approval_steps set status=p_status,decided_by=auth.uid(),decided_at=now(),reason=trim(p_reason) where id=own_step.id;
  end if;
  if p_status='rejected' or is_admin then
    update public.hr_event_approval_steps set status='skipped',reason=case when is_admin then 'تجاوز مدير النظام هذه الموافقة' else 'توقفت الموافقات بعد رفض الطلب' end where event_id=p_event_id and status='pending';
  end if;
  select jsonb_agg(to_jsonb(s) order by step_order),string_agg('المسؤول '||step_order||': '||coalesce(reason,''),E'\n' order by step_order)
  into summary,summary_text from public.hr_event_approval_steps s where event_id=p_event_id;
  if p_status='approved' and not final_approval then
    update public.hr_events set details=jsonb_set(coalesce(details,'{}'::jsonb),'{approval_steps}',coalesce(summary,'[]'::jsonb),true) where id=p_event_id;
    return 'pending';
  end if;
  update public.hr_events set status=p_status,
    decision_reason=case when is_admin then trim(p_reason) else coalesce(summary_text,trim(p_reason)) end,
    amount=case when ev.event_type='leave' and p_status='approved' then discount else amount end,
    amount_unit=case when ev.event_type='leave' and p_status='approved' then case when discount is null then null else 'LYD' end else amount_unit end,
    details=jsonb_set(coalesce(details,'{}'::jsonb),'{approval_steps}',coalesce(summary,'[]'::jsonb),true)
      || case when ev.event_type='leave' and p_status='approved' then jsonb_build_object('leave_discount_type',coalesce(p_discount_type,'none'),'leave_discount_days',days) else '{}'::jsonb end
  where id=p_event_id;
  return p_status;
end;
$$;
revoke all on function public.decide_employee_request(uuid,text,text,text,numeric) from public;
grant execute on function public.decide_employee_request(uuid,text,text,text,numeric) to authenticated;

-- Old clients must follow the same rules, never the previous group override.
create or replace function public.decide_hr_event_approval(p_event_id uuid,p_status text,p_reason text,p_discount_type text default 'none',p_discount_value numeric default null)
returns void language plpgsql security definer set search_path=public as $$
begin perform public.decide_employee_request(p_event_id,p_status,p_reason,p_discount_type,p_discount_value);end;
$$;
revoke all on function public.decide_hr_event_approval(uuid,text,text,text,numeric) from public;
grant execute on function public.decide_hr_event_approval(uuid,text,text,text,numeric) to authenticated;
revoke all on function public.initialize_leave_approval_steps(),public.guard_individual_request_approval(),public.guard_individual_request_submission(),public.record_hr_event_decision() from public;
commit;
