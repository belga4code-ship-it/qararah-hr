begin;

alter table public.employee_goal_tasks
  add column if not exists due_date date,
  add column if not exists employee_note text,
  add column if not exists review_status text not null default 'pending',
  add column if not exists review_note text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null;

alter table public.employee_goals
  add column if not exists recurrence_id uuid;

create table if not exists public.employee_goal_recurrences (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  title text not null,
  description text,
  target_value numeric(12,2),
  target_unit text,
  start_month date not null,
  due_day integer not null default 10 check (due_day between 1 and 28),
  task_templates jsonb not null check (jsonb_typeof(task_templates) = 'array'),
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (employee_id, title, start_month)
);

alter table public.employee_goals drop constraint if exists employee_goals_recurrence_id_fkey;
alter table public.employee_goals add constraint employee_goals_recurrence_id_fkey
  foreign key (recurrence_id) references public.employee_goal_recurrences(id) on delete set null;
create unique index if not exists employee_goals_recurrence_period_uq
  on public.employee_goals(recurrence_id, period_month) where recurrence_id is not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'employee_goal_tasks_review_status_check') then
    alter table public.employee_goal_tasks add constraint employee_goal_tasks_review_status_check
      check (review_status in ('pending', 'approved', 'changes_requested'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'employee_goal_tasks_employee_note_length_check') then
    alter table public.employee_goal_tasks add constraint employee_goal_tasks_employee_note_length_check
      check (employee_note is null or length(employee_note) <= 2000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'employee_goal_tasks_review_note_length_check') then
    alter table public.employee_goal_tasks add constraint employee_goal_tasks_review_note_length_check
      check (review_note is null or length(review_note) <= 1000);
  end if;
end $$;

alter table public.employee_goal_recurrences enable row level security;
revoke all on public.employee_goal_recurrences from anon, authenticated;

grant update (is_completed, employee_note) on public.employee_goal_tasks to authenticated;

create or replace function public.review_employee_goal_task(p_task_id uuid, p_status text, p_note text default null)
returns public.employee_goal_tasks language plpgsql security definer set search_path = public as $$
declare
  v_task public.employee_goal_tasks%rowtype;
  v_branch_id uuid;
  v_employee_note text;
begin
  if auth.uid() is null or p_status is null or p_status not in ('approved', 'changes_requested') then
    raise exception 'Invalid task review request';
  end if;
  if not (public.current_user_has_role('admin') or public.current_user_has_role('hr') or public.current_user_has_permission('goals.manage')) then
    raise exception 'Not authorized to review goal tasks';
  end if;
  select b.id, t.employee_note into v_branch_id, v_employee_note
  from public.employee_goal_tasks t
  join public.employee_goals g on g.id = t.goal_id
  join public.employees e on e.id = g.employee_id
  join public.branches b on b.id = e.branch_id
  where t.id = p_task_id and g.deleted_at is null;
  if not found then raise exception 'Goal task was not found'; end if;
  if nullif(trim(v_employee_note), '') is null then raise exception 'Employee evidence is required before review'; end if;
  if public.current_user_has_role('branch_manager') and v_branch_id is distinct from public.current_branch_id() then
    raise exception 'Cannot review a task outside your branch';
  end if;
  update public.employee_goal_tasks
    set review_status = p_status,
        review_note = nullif(trim(p_note), ''),
        reviewed_at = now(),
        reviewed_by = auth.uid()
    where id = p_task_id returning * into v_task;
  return v_task;
end;
$$;
revoke all on function public.review_employee_goal_task(uuid, text, text) from public;
grant execute on function public.review_employee_goal_task(uuid, text, text) to authenticated;

create or replace function public.reset_employee_goal_task_review_on_note_change()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.employee_note is distinct from old.employee_note then
    new.review_status := 'pending';
    new.review_note := null;
    new.reviewed_at := null;
    new.reviewed_by := null;
  end if;
  return new;
end;
$$;
drop trigger if exists reset_employee_goal_task_review_on_note_change on public.employee_goal_tasks;
create trigger reset_employee_goal_task_review_on_note_change before update of employee_note on public.employee_goal_tasks
for each row execute function public.reset_employee_goal_task_review_on_note_change();

create or replace function public.stamp_employee_goal_task_completion()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.is_completed is distinct from old.is_completed then
    new.completed_at := case when new.is_completed then now() else null end;
    new.completed_by := case when new.is_completed then auth.uid() else null end;
  end if;
  return new;
end;
$$;
drop trigger if exists stamp_employee_goal_task_completion on public.employee_goal_tasks;
create trigger stamp_employee_goal_task_completion before update of is_completed on public.employee_goal_tasks
for each row execute function public.stamp_employee_goal_task_completion();

create or replace function public.ensure_monthly_employee_goal_instances()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_series record;
  v_goal_id uuid;
  v_month date;
  v_due_date date;
  v_template jsonb;
  v_created integer := 0;
begin
  if auth.uid() is null or not (
    public.current_user_has_role('admin')
    or public.current_user_has_role('hr')
    or public.current_user_has_permission('goals.manage')
  ) then
    raise exception 'Not authorized to create monthly goal instances';
  end if;

  for v_series in
    select r.* from public.employee_goal_recurrences r
    join public.employees e on e.id = r.employee_id
    where r.active
      and (not public.current_user_has_role('branch_manager') or e.branch_id = public.current_branch_id())
  loop
    for v_month in
      select generate_series(
        greatest(date_trunc('month', v_series.start_month)::date, date_trunc('month', current_date)::date),
        (date_trunc('month', current_date)::date + interval '11 months')::date,
        interval '1 month'
      )::date
    loop
      v_due_date := (v_month + interval '1 month')::date + (v_series.due_day - 1);
      insert into public.employee_goals(employee_id, period_month, title, description, target_value, target_unit, created_by, recurrence_id)
      values(v_series.employee_id, v_month, v_series.title, v_series.description, v_series.target_value, v_series.target_unit, v_series.created_by, v_series.id)
      on conflict (recurrence_id, period_month) where recurrence_id is not null do nothing
      returning id into v_goal_id;
      if v_goal_id is not null then
        v_created := v_created + 1;
        for v_template in select value from jsonb_array_elements(v_series.task_templates)
        loop
          insert into public.employee_goal_tasks(goal_id, title, sort_order, due_date, created_by)
          values(v_goal_id, trim(v_template->>'title'), coalesce((v_template->>'sort_order')::integer, 0), v_due_date, v_series.created_by);
        end loop;
      end if;
      v_goal_id := null;
    end loop;
  end loop;
  return v_created;
end;
$$;

revoke all on function public.ensure_monthly_employee_goal_instances() from public;
grant execute on function public.ensure_monthly_employee_goal_instances() to authenticated;

insert into public.employee_goal_recurrences(employee_id, title, description, target_value, target_unit, start_month, due_day, task_templates)
select e.id,
       'مطابقة الحسابات المصرفية شهريًا',
       'مطابقة الحسابات المصرفية للشركة وإرفاق تقرير يوضح حالة المطابقة وأي فروقات. موعد التسليم قبل يوم 10 من الشهر التالي.',
       19,
       'حساب مصرفي مطابق',
       date_trunc('month', now() at time zone 'Africa/Tripoli')::date,
       10,
       '[{"title":"قرارة: مصرف الجمهورية مصراتة (2537)","sort_order":0},{"title":"قرارة: مصرف النوران مصراتة (5101)","sort_order":1},{"title":"قرارة: مصرف الواحة طرابلس، تحويلات وبطاقات (0018)","sort_order":2},{"title":"قرارة: مصرف شمال أفريقيا مصراتة (5014)","sort_order":3},{"title":"قرارة: مصرف الجمهورية للبطاقات (6267)","sort_order":4},{"title":"قرارة الرئيسي: مصرف الجمهورية، فرع أحمد الشريف (7436)","sort_order":5},{"title":"قرارة الرئيسي: مصرف الأندلس مصراتة (1015)","sort_order":6},{"title":"قرارة الرئيسي: مصرف السراي، تحويلات وبطاقات (6467)","sort_order":7},{"title":"البرج الدولية: المصرف الإسلامي مصراتة (5018)","sort_order":8},{"title":"البرج الدولية: مصرف الوحدة شركات مصراتة (0018)","sort_order":9},{"title":"البرج الدولية: مصرف التجارة والتنمية مصراتة (6001)","sort_order":10},{"title":"البرج الدولية: مصرف الاتحاد الوطني مصراتة (6001)","sort_order":11},{"title":"البرج الدولية: مصرف الواحة طرابلس، تحويلات وبطاقات (0015)","sort_order":12},{"title":"البرج الدولية: مصرف شمال أفريقيا للبطاقات (6028)","sort_order":13},{"title":"البرج الدولية: مصرف شمال أفريقيا مصراتة (6011)","sort_order":14},{"title":"البرج الدولية: مصرف السراي مصراتة (6765)","sort_order":15},{"title":"حساب فوزي إبراهيم الكرشيني: مصرف الجمهورية (6230)","sort_order":16},{"title":"حساب فوزي إبراهيم الكرشيني: مصرف شمال أفريقيا (4013)","sort_order":17},{"title":"حساب فوزي إبراهيم الكرشيني: مصرف التجارة والتنمية (1001)","sort_order":18}]'::jsonb
from public.employees e
where e.employee_number = 'HR-EMP-00138'
  and e.status = 'active'
on conflict (employee_id, title, start_month) do update
set description = excluded.description,
    target_value = excluded.target_value,
    target_unit = excluded.target_unit,
    due_day = excluded.due_day,
    task_templates = excluded.task_templates,
    active = true;

do $$
declare
  v_series record;
  v_month date;
  v_due_date date;
  v_goal_id uuid;
  v_template jsonb;
begin
  for v_series in
    select r.* from public.employee_goal_recurrences r
    join public.employees e on e.id = r.employee_id
    where e.employee_number = 'HR-EMP-00138'
      and r.title = 'مطابقة الحسابات المصرفية شهريًا'
      and r.active
  loop
    for v_month in
      select generate_series(
        v_series.start_month,
        (v_series.start_month + interval '11 months')::date,
        interval '1 month'
      )::date
    loop
      v_due_date := (v_month + interval '1 month')::date + (v_series.due_day - 1);
      insert into public.employee_goals(employee_id, period_month, title, description, target_value, target_unit, created_by, recurrence_id)
      values(v_series.employee_id, v_month, v_series.title, v_series.description, v_series.target_value, v_series.target_unit, v_series.created_by, v_series.id)
      on conflict (recurrence_id, period_month) where recurrence_id is not null do nothing
      returning id into v_goal_id;
      if v_goal_id is not null then
        for v_template in select value from jsonb_array_elements(v_series.task_templates)
        loop
          insert into public.employee_goal_tasks(goal_id, title, sort_order, due_date, created_by)
          values(v_goal_id, trim(v_template->>'title'), coalesce((v_template->>'sort_order')::integer, 0), v_due_date, v_series.created_by);
        end loop;
      end if;
      v_goal_id := null;
    end loop;
  end loop;
end;
$$;

commit;
