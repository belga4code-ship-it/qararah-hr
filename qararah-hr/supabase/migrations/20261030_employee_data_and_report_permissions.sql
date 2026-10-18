-- Employees can read their own records only. Elevated roles and explicit
-- grants retain their intended scope.
drop policy if exists "branch scoped employee read" on public.employees;
drop policy if exists "secondary roles read all employees" on public.employees;
create policy "role and permission scoped employee read" on public.employees
for select to authenticated
using (
  public.current_user_has_role('admin')
  or public.current_user_has_role('hr')
  or public.current_user_has_role('auditor')
  or public.current_user_has_permission('employees.view_all')
  or public.current_user_has_permission('employees.edit')
  or public.current_user_has_permission('employees.manage_accounts')
  or public.current_user_has_permission('goals.view_all')
  or public.current_user_has_permission('goals.manage')
  or public.current_user_has_permission('evaluations.view_all')
  or public.current_user_has_permission('evaluations.evaluate')
  or public.current_user_has_permission('evaluations.assign')
  or public.current_user_has_permission('reports.view_all')
  or public.current_user_has_permission('reports.export')
  or (
    (public.current_user_has_role('branch_manager') or public.current_user_has_role('accountant') or public.current_user_has_role('yard_supervisor'))
    and branch_id = public.current_branch_id()
  )
  or (public.current_user_has_role('employee') and id = public.current_employee_id())
  or public.is_employee_evaluator(id)
);

drop policy if exists "branch scoped attendance read" on public.attendance_records;
drop policy if exists "secondary roles read attendance" on public.attendance_records;
create policy "role and permission scoped attendance read" on public.attendance_records
for select to authenticated
using (
  public.current_user_has_role('admin')
  or public.current_user_has_role('hr')
  or public.current_user_has_role('auditor')
  or public.current_user_has_permission('attendance.view_all')
  or public.current_user_has_permission('reports.view_all')
  or public.current_user_has_permission('reports.export')
  or (
    (public.current_user_has_role('branch_manager') or public.current_user_has_role('accountant') or public.current_user_has_role('yard_supervisor'))
    and branch_id = public.current_branch_id()
  )
  or (public.current_user_has_role('employee') and employee_id = public.current_employee_id())
);

drop policy if exists "branch scoped imports read" on public.attendance_imports;
create policy "role and permission scoped attendance imports read" on public.attendance_imports
for select to authenticated
using (
  public.current_user_has_role('admin')
  or public.current_user_has_role('hr')
  or public.current_user_has_role('auditor')
  or public.current_user_has_permission('attendance.view_all')
  or public.current_user_has_permission('reports.view_all')
  or public.current_user_has_permission('reports.export')
  or (
    (public.current_user_has_role('branch_manager') or public.current_user_has_role('accountant') or public.current_user_has_role('yard_supervisor'))
    and branch_id = public.current_branch_id()
  )
);

-- Apply the same multi-role rules to HR events; employees remain self-scoped.
drop policy if exists "role scoped events read" on public.hr_events;
create policy "role and permission scoped events read" on public.hr_events
for select to authenticated
using (
  public.current_user_has_role('admin')
  or public.current_user_has_role('hr')
  or public.current_user_has_role('auditor')
  or public.current_user_has_permission('effects.view_all')
  or public.current_user_has_permission('reports.view_all')
  or public.current_user_has_permission('reports.export')
  or (
    public.current_user_has_role('branch_manager')
    and branch_id = public.current_branch_id()
  )
  or (
    public.current_user_has_role('employee')
    and employee_id = public.current_employee_id()
  )
);

-- A permission to see all records is read-only. Existing export-capable roles
-- retain their access; other users need the explicit reports.export grant.
drop policy if exists "Employees read own goals" on public.employee_goals;
create policy "role and permission scoped goal read" on public.employee_goals
for select to authenticated
using (
  employee_id = public.current_employee_id()
  or public.current_user_has_role('admin')
  or public.current_user_has_role('hr')
  or public.current_user_has_permission('goals.view_all')
);

drop policy if exists "Employees read own evaluations" on public.evaluations;
create policy "role and permission scoped evaluation read" on public.evaluations
for select to authenticated
using (
  employee_id = public.current_employee_id()
  or public.current_user_has_role('admin')
  or public.current_user_has_role('hr')
  or public.current_user_has_role('auditor')
  or public.current_user_has_permission('evaluations.view_all')
);

-- Only a system administrator may grant or change per-user permissions.
create or replace function public.guard_additional_permission_grants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null
    and not public.current_user_has_role('admin')
    and new.additional_permissions is distinct from old.additional_permissions then
    raise exception 'Only a system administrator can grant or change additional permissions';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_additional_permission_grants on public.profiles;
create trigger guard_additional_permission_grants
before update of additional_permissions on public.profiles
for each row execute function public.guard_additional_permission_grants();

revoke all on function public.guard_additional_permission_grants() from public;
