-- Live acceptance checks. Every attempted decision is rolled back.
begin;
select set_config('request.jwt.claim.sub','ce73d4f4-c780-4f15-840c-c8b9515ddf93',true);
set local role authenticated;
do $$
declare result text;
begin
  result:=public.decide_employee_request('13f9a0b2-374b-477a-b803-73cedc844285','approved','اختبار تقني داخل معاملة يتم التراجع عنها');
  if result<>'approved' then raise exception 'Khaled must be able to complete his pending approval';end if;
  if (select count(*) from public.hr_event_approval_steps where event_id='13f9a0b2-374b-477a-b803-73cedc844285' and status='approved')<>2 then raise exception 'Both individual approvals must be present';end if;
end;
$$;
rollback;

begin;
select set_config('request.jwt.claim.sub','cde5dda5-b3dc-4f36-ac8e-ba2dbb14fb9a',true);
set local role authenticated;
do $$
begin
  begin
    perform public.decide_employee_request('13f9a0b2-374b-477a-b803-73cedc844285','approved','اختبار تكرار الموافقة');
    raise exception 'Duplicate approval was incorrectly accepted';
  exception when others then
    if sqlerrm not like '%No pending individual approval%' then raise;end if;
  end;
end;
$$;
rollback;

select e.status,s.step_order,p.full_name,s.status as individual_status,s.decided_at
from public.hr_events e join public.hr_event_approval_steps s on s.event_id=e.id
left join public.profiles p on p.id=s.approver_profile_id
where e.id='13f9a0b2-374b-477a-b803-73cedc844285' order by s.step_order;
