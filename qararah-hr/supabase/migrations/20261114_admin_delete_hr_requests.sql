-- Allow system administrators to remove test requests while preserving the audit trail.
create or replace function public.admin_delete_hr_request(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.hr_events%rowtype;
begin
  if auth.uid() is null or not public.current_user_has_role('admin') then
    raise exception 'Only system administrators may delete HR requests';
  end if;

  select *
    into v_event
    from public.hr_events
   where id = p_event_id
   for update;

  if not found then
    raise exception 'الطلب غير موجود أو تم حذفه';
  end if;

  if v_event.event_type not in ('leave', 'permission', 'late_permission', 'mission')
     and not (v_event.event_type = 'deduction' and v_event.status <> 'approved') then
    raise exception 'هذا النوع من السجلات لا يمكن حذفه من شاشة الطلبات';
  end if;

  if v_event.payroll_recorded_at is not null then
    raise exception 'لا يمكن حذف طلب مرتبط بترحيل إلى الراتب';
  end if;

  delete from public.hr_events where id = p_event_id;
end;
$$;

revoke all on function public.admin_delete_hr_request(uuid) from public, anon;
grant execute on function public.admin_delete_hr_request(uuid) to authenticated;
