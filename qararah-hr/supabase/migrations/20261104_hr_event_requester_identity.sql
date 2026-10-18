-- Allow reviewers to see only the identity of the user who created each visible HR event.
-- This avoids granting broad read access to profiles just to identify a request submitter.
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
      or (public.current_user_has_role('employee') and e.employee_id = public.current_employee_id())
    );
$$;

revoke all on function public.get_hr_event_requesters(uuid[]) from public;
grant execute on function public.get_hr_event_requesters(uuid[]) to authenticated;
