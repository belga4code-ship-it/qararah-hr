-- Track actual monthly goal results so employees and HR can review attainment.
alter table public.employee_goals
  add column if not exists actual_value numeric(12,2);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.employee_goals'::regclass
      and conname = 'employee_goals_actual_value_nonnegative'
  ) then
    alter table public.employee_goals
      add constraint employee_goals_actual_value_nonnegative
      check (actual_value is null or actual_value >= 0);
  end if;
end;
$$;
