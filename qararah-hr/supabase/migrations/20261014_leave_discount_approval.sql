-- Record approved leave deductions in the HR event and payroll audit fields.
create or replace function public.record_hr_event_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'pending' and new.status in ('approved', 'rejected') then
    if public.current_app_role() not in ('admin', 'hr') then
      raise exception 'Only head office can decide on requests';
    end if;
    if nullif(trim(new.decision_reason), '') is null then
      raise exception 'A decision reason is required';
    end if;

    new.decision_by := auth.uid();
    new.decision_at := now();
    if new.status = 'approved' then
      new.approved_by := auth.uid();
      new.approved_at := now();
      if new.event_type = 'deduction' or (new.event_type = 'leave' and coalesce(new.amount, 0) > 0) then
        new.payroll_recorded_at := now();
        new.payroll_recorded_by := auth.uid();
      end if;
    else
      new.approved_by := null;
      new.approved_at := null;
      new.payroll_recorded_at := null;
      new.payroll_recorded_by := null;
    end if;
  end if;
  return new;
end;
$$;
