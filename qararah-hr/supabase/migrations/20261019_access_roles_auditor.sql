-- Add a read-only auditor role. The existing `hr` role is the HR manager role.
alter type public.app_role add value if not exists 'auditor';

-- Cross-branch read access for the auditor. This role receives no write policies.
drop policy if exists "branch scoped employee read" on public.employees;
create policy "branch scoped employee read" on public.employees
for select to authenticated
using (public.current_app_role() in ('admin', 'hr') or public.current_app_role()::text = 'auditor' or branch_id = public.current_branch_id());

drop policy if exists "branch scoped attendance read" on public.attendance_records;
create policy "branch scoped attendance read" on public.attendance_records
for select to authenticated
using (public.current_app_role() in ('admin', 'hr') or public.current_app_role()::text = 'auditor' or branch_id = public.current_branch_id());

drop policy if exists "branch scoped imports read" on public.attendance_imports;
create policy "branch scoped imports read" on public.attendance_imports
for select to authenticated
using (public.current_app_role() in ('admin', 'hr') or public.current_app_role()::text = 'auditor' or branch_id = public.current_branch_id());

drop policy if exists "branch scoped shift read" on public.shifts;
create policy "branch scoped shift read" on public.shifts
for select to authenticated
using (branch_id is null or branch_id = public.current_branch_id() or public.current_app_role() in ('admin', 'hr') or public.current_app_role()::text = 'auditor');

drop policy if exists "role scoped events read" on public.hr_events;
create policy "role scoped events read" on public.hr_events
for select to authenticated
using (
  public.current_app_role() in ('admin', 'hr')
  or public.current_app_role()::text = 'auditor'
  or (public.current_app_role() = 'branch_manager' and branch_id = public.current_branch_id())
  or (public.current_app_role() = 'employee' and employee_id = public.current_employee_id())
);

drop policy if exists "auditor read all evaluations" on public.evaluations;
create policy "auditor read all evaluations" on public.evaluations
for select to authenticated
using (public.current_app_role()::text = 'auditor');

drop policy if exists "auditor read evaluation items" on public.evaluation_items;
create policy "auditor read evaluation items" on public.evaluation_items
for select to authenticated
using (public.current_app_role()::text = 'auditor');
