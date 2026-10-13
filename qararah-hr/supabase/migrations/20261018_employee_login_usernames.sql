-- Login names are public profile metadata; passwords remain in Supabase Auth.
alter table public.profiles
  add column if not exists username text;

create unique index if not exists profiles_username_lower_unique
  on public.profiles (lower(username))
  where username is not null;
