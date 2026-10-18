-- Audited report corrections are restricted to system administrators.
begin;
alter table public.hr_events
  add column if not exists report_revision integer not null default 0,
  add column if not exists report_edit_reason text,
  add column if not exists report_edited_at timestamptz,
  add column if not exists report_edited_by uuid references public.profiles(id);

create or replace function public.guard_admin_report_corrections()
returns trigger language plpgsql security definer set search_path=public as $$
declare fields_changed boolean; metadata_changed boolean; normal_approval boolean;
begin
  if auth.uid() is null or old.event_type not in ('leave','permission','late_permission','mission','deduction') then return new;end if;
  fields_changed:=new.effective_date is distinct from old.effective_date or new.end_date is distinct from old.end_date
    or new.reason is distinct from old.reason or new.amount is distinct from old.amount or new.amount_unit is distinct from old.amount_unit;
  metadata_changed:=new.report_revision is distinct from old.report_revision or new.report_edit_reason is distinct from old.report_edit_reason
    or new.report_edited_at is distinct from old.report_edited_at or new.report_edited_by is distinct from old.report_edited_by;
  normal_approval:=old.status='pending' and new.status='approved' and old.event_type='leave'
    and new.effective_date is not distinct from old.effective_date and new.end_date is not distinct from old.end_date and new.reason is not distinct from old.reason;
  if not metadata_changed and (not fields_changed or normal_approval) then return new;end if;
  if not public.current_user_has_role('admin') then raise exception 'Only a system administrator may correct report records';end if;
  if new.status is distinct from old.status or new.employee_id is distinct from old.employee_id or new.event_type is distinct from old.event_type then
    raise exception 'Report correction cannot change employee, type, or approval status';
  end if;
  if new.report_revision<>old.report_revision+1 or new.report_edited_by is distinct from auth.uid()
    or new.report_edited_at is null or nullif(trim(new.report_edit_reason),'') is null then
    raise exception 'An audited correction with a reason is required';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_admin_report_corrections on public.hr_events;
create trigger guard_admin_report_corrections before update on public.hr_events for each row execute function public.guard_admin_report_corrections();

create or replace function public.admin_correct_hr_report(
  p_event_id uuid,p_expected_revision integer,p_expected_status text,p_effective_date date,p_end_date date,
  p_reason text,p_amount numeric,p_edit_reason text
) returns void language plpgsql security definer set search_path=public as $$
declare ev public.hr_events%rowtype; new_amount numeric; financial boolean; changed boolean;
begin
  if auth.uid() is null or not public.current_user_has_role('admin') then raise exception 'Only a system administrator may correct report records';end if;
  if nullif(trim(p_edit_reason),'') is null then raise exception 'A correction reason is required';end if;
  if nullif(trim(p_reason),'') is null then raise exception 'The request reason is required';end if;
  if p_effective_date is null or (p_end_date is not null and p_end_date<p_effective_date) then raise exception 'Invalid date range';end if;
  if p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<0 or p_amount>9999999999.99 then raise exception 'Invalid deduction amount';end if;
  select * into ev from public.hr_events where id=p_event_id for update;
  if not found or ev.event_type not in ('leave','permission','late_permission','mission','deduction') then raise exception 'Report record not found';end if;
  if p_expected_revision is distinct from ev.report_revision or p_expected_status is distinct from ev.status then raise exception 'The record changed; refresh it before saving';end if;
  if ev.event_type<>'leave' and p_end_date is distinct from ev.end_date then raise exception 'Only leave requests have an editable end date';end if;
  financial:=ev.event_type in ('leave','deduction');
  new_amount:=case when p_amount is null then null else round(p_amount,2) end;
  if not financial and new_amount is distinct from ev.amount then raise exception 'This request type has no editable deduction';end if;
  if ev.event_type='deduction' and coalesce(new_amount,0)<=0 then raise exception 'A deduction must have a positive amount';end if;
  if ev.event_type='leave' and ev.status<>'approved' and coalesce(new_amount,0)<>coalesce(ev.amount,0) then raise exception 'Set leave deductions during final approval';end if;
  if ev.event_type='leave' and coalesce(new_amount,0)=0 then new_amount:=null;end if;
  changed:=p_effective_date is distinct from ev.effective_date or p_end_date is distinct from ev.end_date or trim(p_reason) is distinct from ev.reason or new_amount is distinct from ev.amount;
  if not changed then raise exception 'No report fields were changed';end if;
  update public.hr_events set effective_date=p_effective_date,end_date=p_end_date,reason=trim(p_reason),amount=new_amount,
    amount_unit=case when financial then case when new_amount is null then null else 'LYD' end else amount_unit end,
    payroll_recorded_at=case when financial and status='approved' then case when coalesce(new_amount,0)>0 then coalesce(payroll_recorded_at,now()) else null end else payroll_recorded_at end,
    payroll_recorded_by=case when financial and status='approved' then case when coalesce(new_amount,0)>0 then coalesce(payroll_recorded_by,auth.uid()) else null end else payroll_recorded_by end,
    details=case when event_type='leave' and new_amount is distinct from ev.amount then coalesce(details,'{}'::jsonb)||jsonb_build_object('leave_discount_type',case when new_amount is null then 'none' else 'fixed' end,'leave_discount_days',null) else details end,
    report_revision=report_revision+1,report_edit_reason=trim(p_edit_reason),report_edited_at=now(),report_edited_by=auth.uid()
  where id=p_event_id;
  -- capture_audit_log records old/new fields, actor and correction reason atomically.
end;
$$;
revoke all on function public.admin_correct_hr_report(uuid,integer,text,date,date,text,numeric,text) from public,anon;
grant execute on function public.admin_correct_hr_report(uuid,integer,text,date,date,text,numeric,text) to authenticated;
revoke all on function public.guard_admin_report_corrections() from public;
notify pgrst,'reload schema';
commit;
