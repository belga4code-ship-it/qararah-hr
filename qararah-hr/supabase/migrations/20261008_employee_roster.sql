-- Extend the initial schema to match the supplied employee roster.
alter type public.employee_status add value if not exists 'needs_review';

alter table public.branches
  add column if not exists branch_code text;

drop index if exists public.branches_branch_code_unique;
create index if not exists branches_branch_code_idx
  on public.branches (branch_code)
  where branch_code is not null;

alter table public.employees
  add column if not exists full_name text;

-- Imported status values need an explicit review; do not silently mark a
-- record active when the source status is blank or contains a note.
alter table public.employees
  alter column status drop default;

-- The source reuses some job titles across departments.
alter table public.job_titles
  drop constraint if exists job_titles_name_key;
create unique index if not exists job_titles_name_department_unique
  on public.job_titles (name, department_id);

create table if not exists public.employee_private (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  salary_amount numeric(12,2),
  salary_updated_on date,
  education text,
  graduation_year smallint,
  date_of_birth date,
  religion text,
  marital_status text,
  blood_type text,
  residency_expires_on date,
  phone text,
  emergency_phone text,
  emergency_contact_name text,
  passport_number text,
  entered_libya_on date,
  home_country text,
  address text,
  notes text,
  source_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.employee_private
  add column if not exists source_data jsonb not null default '{}'::jsonb;

alter table public.employee_private enable row level security;
drop policy if exists "HR manage private employee data" on public.employee_private;
create policy "HR manage private employee data"
  on public.employee_private
  for all to authenticated
  using (public.current_app_role() in ('admin','hr'))
  with check (public.current_app_role() in ('admin','hr'));

grant select, insert, update, delete on public.employee_private to authenticated;
