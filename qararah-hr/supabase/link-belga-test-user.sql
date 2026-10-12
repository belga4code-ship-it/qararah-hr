-- Run after creating the Supabase Auth user belga@qararah.test.
-- Requires the HR workflow migration that adds profiles.employee_id.
insert into public.profiles (id, full_name, role, branch_id, employee_id)
select u.id, 'أبو القاسم حاتم بعيو', 'employee', e.branch_id, e.id
from auth.users as u
join public.employees as e on e.employee_number = 'HR-EMP-FK110'
where lower(u.email) = 'belga@qararah.test'
on conflict (id) do update
set full_name = excluded.full_name,
    role = 'employee',
    branch_id = excluded.branch_id,
    employee_id = excluded.employee_id
returning id, full_name, role, branch_id, employee_id;
