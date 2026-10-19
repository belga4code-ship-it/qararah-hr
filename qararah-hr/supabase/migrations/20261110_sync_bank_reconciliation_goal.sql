begin;

do $$
declare
  v_employee_id uuid;
  v_recurrence record;
  v_goal record;
  v_template jsonb;
  v_templates jsonb := '[
    {"title":"قرارة: مصرف الجمهورية مصراتة (2537)","sort_order":0},
    {"title":"قرارة: مصرف النوران مصراتة (5101)","sort_order":1},
    {"title":"قرارة: مصرف الواحة طرابلس، تحويلات وبطاقات (0018)","sort_order":2},
    {"title":"قرارة: مصرف شمال أفريقيا مصراتة (5014)","sort_order":3},
    {"title":"قرارة: مصرف الجمهورية للبطاقات (6267)","sort_order":4},
    {"title":"قرارة الرئيسي: مصرف الجمهورية، فرع أحمد الشريف (7436)","sort_order":5},
    {"title":"قرارة الرئيسي: مصرف الأندلس مصراتة (1015)","sort_order":6},
    {"title":"قرارة الرئيسي: مصرف السراي، تحويلات وبطاقات (6467)","sort_order":7},
    {"title":"البرج الدولية: المصرف الإسلامي مصراتة (5018)","sort_order":8},
    {"title":"البرج الدولية: مصرف الوحدة شركات مصراتة (0018)","sort_order":9},
    {"title":"البرج الدولية: مصرف التجارة والتنمية مصراتة (6001)","sort_order":10},
    {"title":"البرج الدولية: مصرف الاتحاد الوطني مصراتة (6001)","sort_order":11},
    {"title":"البرج الدولية: مصرف الواحة طرابلس، تحويلات وبطاقات (0015)","sort_order":12},
    {"title":"البرج الدولية: مصرف شمال أفريقيا للبطاقات (6028)","sort_order":13},
    {"title":"البرج الدولية: مصرف شمال أفريقيا مصراتة (6011)","sort_order":14},
    {"title":"البرج الدولية: مصرف السراي مصراتة (6765)","sort_order":15},
    {"title":"حساب فوزي إبراهيم الكرشيني: مصرف الجمهورية (6230)","sort_order":16},
    {"title":"حساب فوزي إبراهيم الكرشيني: مصرف شمال أفريقيا (4013)","sort_order":17},
    {"title":"حساب فوزي إبراهيم الكرشيني: مصرف التجارة والتنمية (1001)","sort_order":18}
  ]'::jsonb;
begin
  select id into v_employee_id
  from public.employees
  where employee_number = 'HR-EMP-00138' and status = 'active';

  if v_employee_id is null then
    raise exception 'Active employee HR-EMP-00138 was not found';
  end if;

  update public.employee_goal_recurrences
  set target_value = 19,
      target_unit = 'حساب مصرفي مطابق',
      description = 'مطابقة جميع الحسابات الواردة في كشف حسابات الشركة وإرفاق تقرير يوضح حالة المطابقة وأي فروقات. موعد التسليم قبل يوم 10 من الشهر التالي.',
      task_templates = v_templates,
      due_day = 10,
      active = true
  where employee_id = v_employee_id
    and title = 'مطابقة الحسابات المصرفية شهريًا';

  if not found then
    raise exception 'Monthly bank reconciliation recurrence was not found; apply the recurrence migration first';
  end if;

  for v_recurrence in
    select id from public.employee_goal_recurrences
    where employee_id = v_employee_id
      and title = 'مطابقة الحسابات المصرفية شهريًا'
      and active
  loop
    for v_goal in
      select id, period_month from public.employee_goals
      where recurrence_id = v_recurrence.id and deleted_at is null
    loop
      update public.employee_goals
      set target_value = 19,
          target_unit = 'حساب مصرفي مطابق',
          description = 'مطابقة جميع الحسابات الواردة في كشف حسابات الشركة وإرفاق تقرير يوضح حالة المطابقة وأي فروقات. موعد التسليم قبل يوم 10 من الشهر التالي.'
      where id = v_goal.id;

      -- Keep completed work and notes while renaming the old template tasks to their closest account matches.
      update public.employee_goal_tasks
      set title = 'قرارة: مصرف الجمهورية مصراتة (2537)', sort_order = 0
      where goal_id = v_goal.id and title = 'مطابقة حساب مصرف الجمهورية';
      update public.employee_goal_tasks
      set title = 'البرج الدولية: مصرف الوحدة شركات مصراتة (0018)', sort_order = 9
      where goal_id = v_goal.id and title = 'مطابقة حساب مصرف الوحدة';
      update public.employee_goal_tasks
      set title = 'قرارة: مصرف شمال أفريقيا مصراتة (5014)', sort_order = 3
      where goal_id = v_goal.id and title = 'مطابقة حساب مصرف شمال أفريقيا';

      -- The old Sahara Bank task is absent from the supplied account list. Preserve it only if already completed.
      update public.employee_goal_tasks
      set title = 'مهمة مكتملة من القائمة السابقة: مصرف الصحاري (غير مدرج في الكشف)', sort_order = 19
      where goal_id = v_goal.id
        and title = 'مطابقة حساب مصرف الصحاري'
        and is_completed;
      delete from public.employee_goal_tasks
      where goal_id = v_goal.id
        and title = 'مطابقة حساب مصرف الصحاري'
        and not is_completed;

      for v_template in select value from jsonb_array_elements(v_templates)
      loop
        update public.employee_goal_tasks
        set sort_order = (v_template->>'sort_order')::integer,
            due_date = (v_goal.period_month + interval '1 month')::date + 9
        where goal_id = v_goal.id and title = v_template->>'title';

        if not exists (
          select 1 from public.employee_goal_tasks
          where goal_id = v_goal.id and title = v_template->>'title'
        ) then
          insert into public.employee_goal_tasks(goal_id, title, sort_order, due_date)
          values (
            v_goal.id,
            v_template->>'title',
            (v_template->>'sort_order')::integer,
            (v_goal.period_month + interval '1 month')::date + 9
          );
        end if;
      end loop;
    end loop;
  end loop;
end;
$$;

commit;
