-- Let accountant accounts submit and track personal leave/permission requests.
-- Accountant access is scoped to their linked employee record only.

drop policy if exists "employees submit own requests" on public.hr_events;
create policy "employees submit own requests" on public.hr_events
for insert to authenticated with check (
  branch_id = public.current_branch_id()
  and created_by = auth.uid()
  and status = 'pending'
  and approved_by is null and approved_at is null
  and event_type in ('leave', 'late_permission', 'permission', 'mission')
  and nullif(trim(reason), '') is not null
  and (end_date is null or end_date >= effective_date)
  and (
    ((public.current_user_has_role('employee') or public.current_user_has_role('accountant'))
      and employee_id = public.current_employee_id())
    or (public.current_user_has_role('branch_manager') and exists (
      select 1 from public.employees e
      where e.id = employee_id and e.branch_id = public.current_branch_id()
    ))
  )
);

drop policy if exists "role and permission scoped events read" on public.hr_events;
create policy "role and permission scoped events read" on public.hr_events
for select to authenticated using (
  public.current_user_has_role('admin') or public.current_user_has_role('hr') or public.current_user_has_role('auditor')
  or ((public.current_user_has_permission('effects.view_all') or public.current_user_has_permission('reports.view_all') or public.current_user_has_permission('reports.export'))
    and (not public.current_user_has_role('branch_manager') or branch_id = public.current_branch_id()))
  or (public.current_user_has_role('branch_manager') and branch_id = public.current_branch_id())
  or ((public.current_user_has_role('employee') or public.current_user_has_role('accountant'))
    and employee_id = public.current_employee_id())
);

drop policy if exists "read approval steps for visible events" on public.hr_event_approval_steps;
create policy "read approval steps for visible events" on public.hr_event_approval_steps
for select to authenticated using (
  (public.is_assigned_hr_event_responsible(event_id) and (not public.current_user_has_role('branch_manager') or exists (
    select 1 from public.hr_events e where e.id = event_id and e.branch_id = public.current_branch_id()
  )))
  or exists (select 1 from public.hr_events e where e.id = event_id and (
    public.current_user_has_role('admin') or public.current_user_has_role('hr') or public.current_user_has_role('auditor')
    or ((public.current_user_has_permission('effects.view_all') or public.current_user_has_permission('attendance.view_all') or public.current_user_has_permission('reports.view_all') or public.current_user_has_permission('reports.export'))
      and (not public.current_user_has_role('branch_manager') or e.branch_id = public.current_branch_id()))
    or (public.current_user_has_role('branch_manager') and e.branch_id = public.current_branch_id())
    or ((public.current_user_has_role('employee') or public.current_user_has_role('accountant'))
      and e.employee_id = public.current_employee_id())
  ))
);

create or replace function public.get_hr_event_requesters(p_event_ids uuid[])
returns table (
  event_id uuid,
  full_name text,
  role text,
  user_roles text[],
  employee_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, p.full_name, p.role::text, coalesce(p.user_roles, '{}'::text[]), p.employee_id
  from public.hr_events e
  join public.profiles p on p.id = e.created_by
  where e.id = any(coalesce(p_event_ids, '{}'::uuid[]))
    and (
      public.current_user_has_role('admin')
      or public.current_user_has_role('hr')
      or public.current_user_has_role('auditor')
      or public.current_user_has_permission('effects.view_all')
      or public.current_user_has_permission('effects.approve')
      or public.current_user_has_permission('effects.manage_deductions')
      or (public.current_user_has_role('branch_manager') and e.branch_id = public.current_branch_id())
      or ((public.current_user_has_role('employee') or public.current_user_has_role('accountant'))
        and e.employee_id = public.current_employee_id())
    );
$$;

revoke all on function public.get_hr_event_requesters(uuid[]) from public;
grant execute on function public.get_hr_event_requesters(uuid[]) to authenticated;
