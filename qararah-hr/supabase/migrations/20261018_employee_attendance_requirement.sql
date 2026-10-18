alter table public.employees
  add column if not exists attendance_required boolean not null default true;

comment on column public.employees.attendance_required is
  'Whether the employee is required to record attendance and departure punches.';

update public.employees e
   set attendance_required = exists (
     select 1
       from public.attendance_records a
      where a.employee_id = e.id
   )
 where e.attendance_required is distinct from exists (
   select 1
     from public.attendance_records a
    where a.employee_id = e.id
 );
