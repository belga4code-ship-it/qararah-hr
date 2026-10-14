-- Goal completion is evaluated and recorded by HR/admin only.
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

-- Remove any earlier employee progress policy. HR/admin access remains
-- governed by the existing "HR manage employee goals" row-level policy.
drop policy if exists "Employees update own goal progress" on public.employee_goals;

-- Limit authenticated updates to the result field; RLS decides which roles
-- may update it, and employees have no UPDATE policy.
revoke update on public.employee_goals from authenticated;
grant update (actual_value) on public.employee_goals to authenticated;
