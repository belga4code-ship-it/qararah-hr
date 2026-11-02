-- Draft only: do not apply to production before review and staging validation.
-- Raw punch data is isolated from attendance_records (the app's daily aggregates).
create table if not exists public.attendance_devices (
  id uuid primary key default gen_random_uuid(),
  serial_number text not null unique,
  device_name text,
  branch_id uuid references public.branches(id) on delete set null,
  last_seen_at timestamptz,
  external_status_code text,
  raw_payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.attendance_raw_logs (
  id uuid primary key default gen_random_uuid(),
  source_system text not null default 'zkbio',
  sync_key text not null,
  external_record_id text,
  external_employee_id text not null,
  employee_id uuid references public.employees(id) on delete set null,
  device_id uuid references public.attendance_devices(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  punch_time timestamptz not null,
  punch_type text,
  raw_payload jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  unique (source_system, sync_key)
);
create index if not exists attendance_raw_logs_punch_time_idx on public.attendance_raw_logs (punch_time desc);
create index if not exists attendance_raw_logs_employee_time_idx on public.attendance_raw_logs (employee_id, punch_time desc);
create index if not exists attendance_raw_logs_unmatched_idx on public.attendance_raw_logs (external_employee_id) where employee_id is null;

create table if not exists public.attendance_sync_state (
  source_id text primary key,
  last_successful_sync timestamptz,
  cursor jsonb not null default '{}'::jsonb,
  status text not null default 'idle',
  last_error text,
  updated_at timestamptz not null default now()
);

alter table public.attendance_devices enable row level security;
alter table public.attendance_raw_logs enable row level security;
alter table public.attendance_sync_state enable row level security;
-- Deliberately no client policies. Only the Edge Function's service role accesses these tables.

-- Rollback (manual, staging only):
-- drop table if exists public.attendance_raw_logs;
-- drop table if exists public.attendance_sync_state;
-- drop table if exists public.attendance_devices;
