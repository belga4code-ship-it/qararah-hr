-- Qararah HR initial schema. Apply in the Supabase SQL editor.
create extension if not exists pgcrypto;

create type public.app_role as enum ('admin', 'hr', 'branch_manager', 'accountant', 'employee');
create type public.employee_status as enum ('active', 'on_leave', 'suspended', 'terminated', 'needs_review');
create type public.attendance_status as enum ('present', 'late', 'absent', 'incomplete', 'on_mission', 'leave', 'needs_review');
create type public.hr_event_type as enum ('new_hire', 'leave', 'termination', 'salary_hold', 'salary_release', 'deduction', 'mission', 'branch_transfer', 'status_change', 'advance', 'other');

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  branch_code text,
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role public.app_role not null default 'employee',
  branch_id uuid references public.branches(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table public.job_titles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  department_id uuid references public.departments(id) on delete set null,
  description text
);

create unique index job_titles_name_department_unique on public.job_titles (name, department_id);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  employee_number text not null unique,
  first_name text not null,
  last_name text,
  full_name text,
  branch_id uuid not null references public.branches(id),
  department_id uuid references public.departments(id),
  job_title_id uuid references public.job_titles(id),
  manager_id uuid references public.employees(id) on delete set null,
  hired_on date,
  phone text,
  email text,
  status public.employee_status not null default 'needs_review',
  zkt_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  branch_id uuid references public.branches(id) on delete cascade,
  starts_at time not null,
  ends_at time not null,
  grace_minutes integer not null default 0 check (grace_minutes >= 0),
  work_days smallint[] not null default array[0,1,2,3,4,5,6]::smallint[],
  is_active boolean not null default true
);

create table public.attendance_imports (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  source_file text not null,
  imported_by uuid references public.profiles(id),
  imported_at timestamptz not null default now(),
  period_start date,
  period_end date,
  row_count integer not null default 0,
  exception_count integer not null default 0,
  notes text
);

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  attendance_date date not null,
  first_in time,
  last_out time,
  total_work interval,
  status public.attendance_status not null default 'needs_review',
  exception_note text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  import_id uuid references public.attendance_imports(id) on delete set null,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (employee_id, attendance_date)
);

create table public.hr_events (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  branch_id uuid not null references public.branches(id),
  event_type public.hr_event_type not null,
  effective_date date not null,
  end_date date,
  reason text,
  amount numeric(12,2),
  amount_unit text,
  destination_branch_id uuid references public.branches(id),
  details jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.evaluations (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  branch_id uuid not null references public.branches(id),
  period_month date not null,
  evaluator_id uuid references public.profiles(id),
  total_score numeric(6,2),
  max_score numeric(6,2) not null,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved')),
  notes text,
  created_at timestamptz not null default now(),
  unique (employee_id, period_month)
);

create table public.evaluation_items (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references public.evaluations(id) on delete cascade,
  criterion text not null,
  score smallint not null check (score between 1 and 4),
  max_score smallint not null default 4 check (max_score between 1 and 4),
  evidence text
);

create index attendance_records_branch_date_idx on public.attendance_records(branch_id, attendance_date);
create index hr_events_branch_date_idx on public.hr_events(branch_id, effective_date);
create index employees_branch_status_idx on public.employees(branch_id, status);

create function public.current_app_role()
returns public.app_role
language sql stable security definer
set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;

create function public.current_branch_id()
returns uuid
language sql stable security definer
set search_path = public
as $$ select branch_id from public.profiles where id = auth.uid() $$;

alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.departments enable row level security;
alter table public.job_titles enable row level security;
alter table public.employees enable row level security;
alter table public.shifts enable row level security;
alter table public.attendance_imports enable row level security;
alter table public.attendance_records enable row level security;
alter table public.hr_events enable row level security;
alter table public.evaluations enable row level security;
alter table public.evaluation_items enable row level security;

create policy "signed in users read branches" on public.branches for select to authenticated using (true);
create policy "HR manage branches" on public.branches for all to authenticated using (public.current_app_role() in ('admin','hr')) with check (public.current_app_role() in ('admin','hr'));
create policy "users read own profile" on public.profiles for select to authenticated using (id = auth.uid() or public.current_app_role() in ('admin','hr'));
create policy "HR manage profiles" on public.profiles for all to authenticated using (public.current_app_role() in ('admin','hr')) with check (public.current_app_role() in ('admin','hr'));
create policy "signed in users read departments" on public.departments for select to authenticated using (true);
create policy "HR manage departments" on public.departments for all to authenticated using (public.current_app_role() in ('admin','hr')) with check (public.current_app_role() in ('admin','hr'));
create policy "signed in users read job titles" on public.job_titles for select to authenticated using (true);
create policy "HR manage job titles" on public.job_titles for all to authenticated using (public.current_app_role() in ('admin','hr')) with check (public.current_app_role() in ('admin','hr'));
create policy "branch scoped employee read" on public.employees for select to authenticated using (public.current_app_role() in ('admin','hr') or branch_id = public.current_branch_id());
create policy "HR manage employees" on public.employees for all to authenticated using (public.current_app_role() in ('admin','hr')) with check (public.current_app_role() in ('admin','hr'));
create policy "branch scoped shift read" on public.shifts for select to authenticated using (branch_id is null or branch_id = public.current_branch_id() or public.current_app_role() in ('admin','hr'));
create policy "HR manage shifts" on public.shifts for all to authenticated using (public.current_app_role() in ('admin','hr')) with check (public.current_app_role() in ('admin','hr'));
create policy "branch scoped attendance read" on public.attendance_records for select to authenticated using (public.current_app_role() in ('admin','hr') or branch_id = public.current_branch_id());
create policy "HR manage attendance" on public.attendance_records for all to authenticated using (public.current_app_role() in ('admin','hr')) with check (public.current_app_role() in ('admin','hr'));
create policy "branch scoped imports read" on public.attendance_imports for select to authenticated using (public.current_app_role() in ('admin','hr') or branch_id = public.current_branch_id());
create policy "HR manage imports" on public.attendance_imports for all to authenticated using (public.current_app_role() in ('admin','hr')) with check (public.current_app_role() in ('admin','hr'));
create policy "branch scoped events read" on public.hr_events for select to authenticated using (public.current_app_role() in ('admin','hr') or branch_id = public.current_branch_id());
create policy "HR manage events" on public.hr_events for all to authenticated using (public.current_app_role() in ('admin','hr')) with check (public.current_app_role() in ('admin','hr'));
create policy "branch scoped evaluations read" on public.evaluations for select to authenticated using (public.current_app_role() in ('admin','hr') or branch_id = public.current_branch_id());
create policy "HR managers manage evaluations" on public.evaluations for all to authenticated using (public.current_app_role() in ('admin','hr') or (public.current_app_role() = 'branch_manager' and branch_id = public.current_branch_id())) with check (public.current_app_role() in ('admin','hr') or (public.current_app_role() = 'branch_manager' and branch_id = public.current_branch_id()));
create policy "evaluation items via evaluation access" on public.evaluation_items for all to authenticated using (exists (select 1 from public.evaluations e where e.id = evaluation_id and (public.current_app_role() in ('admin','hr') or (public.current_app_role() = 'branch_manager' and e.branch_id = public.current_branch_id())))) with check (exists (select 1 from public.evaluations e where e.id = evaluation_id and (public.current_app_role() in ('admin','hr') or (public.current_app_role() = 'branch_manager' and e.branch_id = public.current_branch_id()))));
