-- Employee explanations are deliberately separate from attendance records and payroll.
-- An HR decision is required before any later attendance or payroll workflow acts on them.
begin;

create table if not exists public.attendance_explanations (
  id uuid primary key default gen_random_uuid(),
  attendance_record_id uuid not null references public.attendance_records(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  explanation_kind text not null check (explanation_kind in ('late', 'incomplete', 'review')),
  explanation text not null check (char_length(trim(explanation)) between 5 and 1200),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  decision_note text,
  submitted_by uuid not null references public.profiles(id) on delete restrict,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (attendance_record_id, employee_id)
);

create index if not exists attendance_explanations_employee_created_idx
  on public.attendance_explanations(employee_id, created_at desc);
create index if not exists attendance_explanations_pending_idx
  on public.attendance_explanations(status, branch_id, created_at asc)
  where status = 'pending';

alter table public.attendance_explanations enable row level security;

drop policy if exists "employees read own attendance explanations" on public.attendance_explanations;
create policy "employees read own attendance explanations" on public.attendance_explanations
for select to authenticated using (
  employee_id = public.current_employee_id()
  or public.current_user_has_role('admin')
  or public.current_user_has_role('hr')
);

-- Insertions are only accepted through the RPC below, which verifies the biometric record.
drop policy if exists "HR review attendance explanations" on public.attendance_explanations;
create policy "HR review attendance explanations" on public.attendance_explanations
for update to authenticated using (
  public.current_user_has_role('admin') or public.current_user_has_role('hr')
) with check (
  public.current_user_has_role('admin') or public.current_user_has_role('hr')
);

create or replace function public.submit_attendance_explanation(
  p_attendance_record_id uuid,
  p_explanation_kind text,
  p_explanation text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_employee_id uuid := public.current_employee_id();
  v_record public.attendance_records%rowtype;
  v_result_id uuid;
  v_text text := trim(coalesce(p_explanation, ''));
begin
  if auth.uid() is null or v_employee_id is null then
    raise exception 'Your account is not linked to an employee record';
  end if;
  if p_explanation_kind not in ('late', 'incomplete', 'review') then
    raise exception 'Invalid explanation kind';
  end if;
  if char_length(v_text) not between 5 and 1200 then
    raise exception 'Explanation must be between 5 and 1200 characters';
  end if;

  select * into v_record from public.attendance_records
  where id = p_attendance_record_id and employee_id = v_employee_id
  for update;
  if not found then
    raise exception 'Attendance record was not found';
  end if;
  if not (
    v_record.status in ('late', 'incomplete', 'needs_review')
    or coalesce(left(v_record.first_in::text, 5), '') > '09:15'
  ) then
    raise exception 'This attendance record does not need an explanation';
  end if;

  insert into public.attendance_explanations (
    attendance_record_id, employee_id, branch_id, explanation_kind, explanation, submitted_by
  ) values (
    v_record.id, v_employee_id, v_record.branch_id, p_explanation_kind, v_text, auth.uid()
  ) on conflict (attendance_record_id, employee_id) do update set
    explanation_kind = excluded.explanation_kind,
    explanation = excluded.explanation,
    status = 'pending',
    decision_note = null,
    reviewed_by = null,
    reviewed_at = null,
    submitted_by = excluded.submitted_by,
    updated_at = now()
  where public.attendance_explanations.status = 'rejected'
  returning id into v_result_id;

  if v_result_id is null then
    raise exception 'An explanation for this record is already pending or decided';
  end if;
  return v_result_id;
end;
$$;
revoke all on function public.submit_attendance_explanation(uuid, text, text) from public;
grant execute on function public.submit_attendance_explanation(uuid, text, text) to authenticated;

create or replace function public.review_attendance_explanation(
  p_explanation_id uuid,
  p_status text,
  p_decision_note text default null
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.current_user_has_role('admin') or public.current_user_has_role('hr')) then
    raise exception 'Only human resources can review attendance explanations';
  end if;
  if p_status not in ('accepted', 'rejected') then
    raise exception 'Invalid review status';
  end if;
  update public.attendance_explanations
  set status = p_status,
      decision_note = nullif(trim(coalesce(p_decision_note, '')), ''),
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      updated_at = now()
  where id = p_explanation_id and status = 'pending';
  if not found then raise exception 'Explanation is not pending'; end if;
end;
$$;
revoke all on function public.review_attendance_explanation(uuid, text, text) from public;
grant execute on function public.review_attendance_explanation(uuid, text, text) to authenticated;

commit;
