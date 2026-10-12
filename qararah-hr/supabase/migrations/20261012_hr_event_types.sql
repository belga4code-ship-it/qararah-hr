-- Add request event types before applying the workflow migration.
alter type public.hr_event_type add value if not exists 'late_permission';
alter type public.hr_event_type add value if not exists 'permission';
