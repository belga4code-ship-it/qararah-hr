-- Create the initial branch and link an existing Supabase Auth user as HR.
-- Uses the Supabase Auth account provided for the initial HR setup.
insert into public.branches (name)
values ('السبعة')
on conflict (name) do nothing;

insert into public.profiles (id, full_name, role, branch_id)
select u.id, 'مسؤول الموارد البشرية', 'hr', b.id
from auth.users u
join public.branches b on b.name = 'السبعة'
where u.email = 'CHANGE_TO_HR_EMAIL'
on conflict (id) do update
set role = 'hr', branch_id = excluded.branch_id
returning id, full_name, role, branch_id;
