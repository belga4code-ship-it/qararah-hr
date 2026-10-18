-- Explicit repair of the request reported during acceptance testing.
-- Preserve Ahmed's real approval; restore Khaled's pending approval, not a new one.
begin;
do $$
declare ev public.hr_events%rowtype; previous_steps jsonb; responsible uuid; ids uuid[]; pos integer; decision jsonb;
begin
  select * into ev from public.hr_events where id='13f9a0b2-374b-477a-b803-73cedc844285' for update;
  if not found or ev.status='pending' then return;end if;
  if ev.status<>'approved' or ev.decision_by is distinct from 'cde5dda5-b3dc-4f36-ac8e-ba2dbb14fb9a'::uuid
    or ev.employee_id<>'3786220a-222e-46a0-8c44-dcf34cf08306'::uuid then raise exception 'Request changed since diagnosis; review before repair';end if;
  if coalesce(ev.amount,0)<>0 or ev.payroll_recorded_at is not null or ev.payroll_recorded_by is not null then raise exception 'Payroll-linked request needs separate review';end if;
  select array_agg(value::uuid order by ordinality) into ids from jsonb_array_elements_text(ev.details->'responsible_profile_ids') with ordinality;
  if ids is distinct from array['cde5dda5-b3dc-4f36-ac8e-ba2dbb14fb9a'::uuid,'ce73d4f4-c780-4f15-840c-c8b9515ddf93'::uuid] then raise exception 'Responsibility roster changed; review before repair';end if;
  select coalesce(jsonb_agg(to_jsonb(s) order by step_order),'[]'::jsonb) into previous_steps from public.hr_event_approval_steps s where event_id=ev.id;
  update public.hr_events set status='pending',decision_by=null,decision_at=null,decision_reason=null,approved_by=null,approved_at=null,
    details=jsonb_set(coalesce(details,'{}'::jsonb),'{individual_approval_repair}',jsonb_build_object('repaired_at',now(),'previous_status',ev.status,'previous_decision_by',ev.decision_by,'previous_decision_at',ev.decision_at,'previous_reason',ev.decision_reason,'previous_steps',previous_steps),true)
    where id=ev.id;
  delete from public.hr_event_approval_steps where event_id=ev.id;
  for pos in 1..cardinality(ids) loop
    responsible:=ids[pos];
    select value into decision from jsonb_array_elements(previous_steps) where value->>'decided_by'=responsible::text and value->>'status'='approved' limit 1;
    insert into public.hr_event_approval_steps(event_id,step_order,approver_role,approver_profile_id,approver_profile_ids,status,decided_by,decided_at,reason)
    values(ev.id,pos,'assigned_manager',responsible,array[responsible],coalesce(decision->>'status','pending'),(decision->>'decided_by')::uuid,(decision->>'decided_at')::timestamptz,decision->>'reason');
  end loop;
  update public.hr_events set details=jsonb_set(details,'{approval_steps}',(select jsonb_agg(to_jsonb(s) order by step_order) from public.hr_event_approval_steps s where event_id=ev.id),true) where id=ev.id;
end;
$$;
commit;
