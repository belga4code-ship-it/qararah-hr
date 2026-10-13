create table if not exists public.employee_goals (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  period_month date not null,
  title text not null check (length(trim(title)) > 0),
  description text,
  target_value numeric(12,2),
  target_unit text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists employee_goals_employee_month_idx
  on public.employee_goals(employee_id, period_month desc);
alter table public.employee_goals enable row level security;
drop policy if exists "Employees read own goals" on public.employee_goals;
create policy "Employees read own goals" on public.employee_goals
for select to authenticated
using (employee_id = public.current_employee_id() or public.current_app_role() in ('admin', 'hr'));
drop policy if exists "HR manage employee goals" on public.employee_goals;
create policy "HR manage employee goals" on public.employee_goals
for all to authenticated
using (public.current_app_role() in ('admin', 'hr'))
with check (public.current_app_role() in ('admin', 'hr'));
grant select, insert, update, delete on public.employee_goals to authenticated;

create table if not exists public.employee_reports (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  category text not null default 'other' check (category in ('workplace', 'safety', 'suggestion', 'other')),
  subject text not null check (length(trim(subject)) > 0),
  message text not null check (length(trim(message)) > 0),
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'resolved')),
  hr_response text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  handled_by uuid references public.profiles(id) on delete set null
);

create index if not exists employee_reports_employee_created_idx
  on public.employee_reports(employee_id, created_at desc);
create index if not exists employee_reports_status_created_idx
  on public.employee_reports(status, created_at desc);
alter table public.employee_reports enable row level security;
drop policy if exists "Employees read own reports" on public.employee_reports;
create policy "Employees read own reports" on public.employee_reports
for select to authenticated
using (employee_id = public.current_employee_id() or public.current_app_role() in ('admin', 'hr'));
drop policy if exists "Employees submit own reports" on public.employee_reports;
create policy "Employees submit own reports" on public.employee_reports
for insert to authenticated
with check (
  public.current_app_role() = 'employee'
  and employee_id = public.current_employee_id()
  and branch_id = public.current_branch_id()
);
drop policy if exists "HR update employee reports" on public.employee_reports;
create policy "HR update employee reports" on public.employee_reports
for update to authenticated
using (public.current_app_role() in ('admin', 'hr'))
with check (public.current_app_role() in ('admin', 'hr'));
grant select, insert, update on public.employee_reports to authenticated;

drop policy if exists "Employees read own evaluations" on public.evaluations;
create policy "Employees read own evaluations" on public.evaluations
for select to authenticated
using (employee_id = public.current_employee_id());
drop policy if exists "Employees read own evaluation items" on public.evaluation_items;
create policy "Employees read own evaluation items" on public.evaluation_items
for select to authenticated
using (
  exists (
    select 1 from public.evaluations e
    where e.id = evaluation_items.evaluation_id
      and e.employee_id = public.current_employee_id()
  )
);
