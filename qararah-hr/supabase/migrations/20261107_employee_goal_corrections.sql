-- Correct or remove mistaken goals without erasing recorded results or history.
begin;

alter table public.employee_goals
  add column if not exists goal_revision integer not null default 0,
  add column if not exists goal_edit_reason text,
  add column if not exists goal_edited_at timestamptz,
  add column if not exists goal_edited_by uuid references public.profiles(id),
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id),
  add column if not exists delete_reason text;

-- A restrictive policy also covers existing permissive goals.manage policies.
-- Archived records remain available to the audit log, not active goal lists.
drop policy if exists "Hide archived employee goals" on public.employee_goals;
create policy "Hide archived employee goals" on public.employee_goals
  as restrictive for select to authenticated using (deleted_at is null);

-- Secondary HR/admin role assignments have the same goal access as a primary role.
drop policy if exists "HR manage employee goals" on public.employee_goals;
create policy "HR manage employee goals" on public.employee_goals
  for all to authenticated
  using (public.current_user_has_role('admin') or public.current_user_has_role('hr'))
  with check (public.current_user_has_role('admin') or public.current_user_has_role('hr'));

create or replace function public.guard_employee_goal_changes()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  structural_change boolean;
  edit_metadata_change boolean;
  deletion_change boolean;
begin
  if tg_op='DELETE' then
    if auth.uid() is not null then
      raise exception 'Archive goals instead of permanently deleting their results and history';
    end if;
    return old;
  end if;

  if tg_op='INSERT' then
    if auth.uid() is not null and (
      new.goal_revision<>0 or new.goal_edit_reason is not null or new.goal_edited_at is not null
      or new.goal_edited_by is not null or new.deleted_at is not null
      or new.deleted_by is not null or new.delete_reason is not null
    ) then
      raise exception 'New goals cannot contain correction or archive metadata';
    end if;
    return new;
  end if;

  -- Trusted maintenance may still run as the database owner without a user JWT.
  if auth.uid() is null then
    new.goal_revision:=old.goal_revision+1;
    return new;
  end if;

  if old.deleted_at is not null then raise exception 'Archived goals cannot be changed'; end if;
  if new.id is distinct from old.id or new.employee_id is distinct from old.employee_id
    or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'Goal identity and creation history cannot be changed';
  end if;

  structural_change:=new.title is distinct from old.title or new.description is distinct from old.description
    or new.period_month is distinct from old.period_month or new.target_value is distinct from old.target_value
    or new.target_unit is distinct from old.target_unit;
  edit_metadata_change:=new.goal_edit_reason is distinct from old.goal_edit_reason
    or new.goal_edited_at is distinct from old.goal_edited_at or new.goal_edited_by is distinct from old.goal_edited_by;
  deletion_change:=new.deleted_at is distinct from old.deleted_at or new.deleted_by is distinct from old.deleted_by
    or new.delete_reason is distinct from old.delete_reason;

  if structural_change or edit_metadata_change or deletion_change then
    if not (public.current_user_has_role('admin') or public.current_user_has_role('hr')) then
      raise exception 'Only a system administrator or HR manager may edit or archive goals';
    end if;
    if new.actual_value is distinct from old.actual_value then
      raise exception 'Goal corrections cannot change recorded results';
    end if;
    if new.goal_revision<>old.goal_revision+1 or new.goal_edited_by is distinct from auth.uid()
      or new.goal_edited_at is null or nullif(trim(new.goal_edit_reason),'') is null then
      raise exception 'An audited goal correction with a reason is required';
    end if;
    if deletion_change then
      if structural_change or new.deleted_at is null or new.deleted_by is distinct from auth.uid()
        or nullif(trim(new.delete_reason),'') is null then
        raise exception 'An audited goal archive with a reason is required';
      end if;
    else
      if nullif(trim(new.title),'') is null or new.period_month is null
        or extract(day from new.period_month)<>1 then raise exception 'Invalid goal title or month'; end if;
      if new.target_value::text in ('NaN','Infinity','-Infinity') or new.target_value<0 then
        raise exception 'Invalid goal target value';
      end if;
    end if;
  else
    -- Existing authorized result updates stay available, but invalidate stale forms.
    if new.goal_revision is distinct from old.goal_revision then
      raise exception 'Goal revision cannot be changed directly';
    end if;
    if new.actual_value is distinct from old.actual_value then new.goal_revision:=old.goal_revision+1; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_employee_goal_changes on public.employee_goals;
create trigger guard_employee_goal_changes before insert or update or delete on public.employee_goals
  for each row execute function public.guard_employee_goal_changes();

-- Goal audit data contains the original definition, recorded result, correction
-- reason and actor. Deletion is an UPDATE with explicit archive metadata.
create or replace function public.capture_employee_goal_audit()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_fields text[];
  v_branch_id uuid;
begin
  if tg_op<>'INSERT' then v_old:=to_jsonb(old)-'created_at'; end if;
  if tg_op<>'DELETE' then v_new:=to_jsonb(new)-'created_at'; end if;
  if tg_op='UPDATE' then
    select coalesce(array_agg(k order by k),'{}') into v_fields
      from jsonb_object_keys(v_old||v_new) as keys(k) where v_old->k is distinct from v_new->k;
    if cardinality(v_fields)=0 then return new; end if;
  else
    select coalesce(array_agg(k order by k),'{}') into v_fields from jsonb_object_keys(coalesce(v_new,v_old)) as keys(k);
  end if;
  v_row:=coalesce(v_new,v_old);
  select branch_id into v_branch_id from public.employees where id=(v_row->>'employee_id')::uuid;
  insert into public.audit_log(entity_table,entity_id,employee_id,branch_id,action,changed_fields,old_data,new_data,actor_id)
    values('employee_goals',(v_row->>'id')::uuid,(v_row->>'employee_id')::uuid,v_branch_id,tg_op,v_fields,v_old,v_new,auth.uid());
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists audit_employee_goal_changes on public.employee_goals;
create trigger audit_employee_goal_changes after insert or update or delete on public.employee_goals
  for each row execute function public.capture_employee_goal_audit();

create or replace function public.update_employee_goal(
  p_goal_id uuid,p_expected_revision integer,p_title text,p_description text,p_period_month date,
  p_target_value numeric,p_target_unit text,p_change_reason text
) returns public.employee_goals language plpgsql security definer set search_path=public as $$
declare
  v_goal public.employee_goals%rowtype;
  v_target numeric;
begin
  if auth.uid() is null or not (public.current_user_has_role('admin') or public.current_user_has_role('hr')) then
    raise exception 'Only a system administrator or HR manager may edit or archive goals';
  end if;
  if nullif(trim(p_change_reason),'') is null then raise exception 'A goal correction reason is required'; end if;
  if nullif(trim(p_title),'') is null or p_period_month is null
    or not isfinite(p_period_month) or extract(day from p_period_month)<>1 then
    raise exception 'Invalid goal title or month';
  end if;
  if p_target_value::text in ('NaN','Infinity','-Infinity') or p_target_value<0 or p_target_value>9999999999.99 then
    raise exception 'Invalid goal target value';
  end if;
  v_target:=round(p_target_value,2);
  select * into v_goal from public.employee_goals where id=p_goal_id for update;
  if not found or v_goal.deleted_at is not null then raise exception 'Active goal not found'; end if;
  if p_expected_revision is distinct from v_goal.goal_revision then raise exception 'The goal changed; refresh it before saving'; end if;
  if trim(p_title) is not distinct from v_goal.title and nullif(trim(p_description),'') is not distinct from v_goal.description
    and p_period_month is not distinct from v_goal.period_month and v_target is not distinct from v_goal.target_value
    and nullif(trim(p_target_unit),'') is not distinct from v_goal.target_unit then raise exception 'No goal fields were changed'; end if;

  update public.employee_goals set title=trim(p_title),description=nullif(trim(p_description),''),period_month=p_period_month,
    target_value=v_target,target_unit=nullif(trim(p_target_unit),''),goal_revision=goal_revision+1,
    goal_edit_reason=trim(p_change_reason),goal_edited_by=auth.uid(),goal_edited_at=clock_timestamp()
    where id=p_goal_id returning * into v_goal;
  return v_goal;
end;
$$;

create or replace function public.archive_employee_goal(
  p_goal_id uuid,p_expected_revision integer,p_delete_reason text
) returns void language plpgsql security definer set search_path=public as $$
declare v_goal public.employee_goals%rowtype;
begin
  if auth.uid() is null or not (public.current_user_has_role('admin') or public.current_user_has_role('hr')) then
    raise exception 'Only a system administrator or HR manager may edit or archive goals';
  end if;
  if nullif(trim(p_delete_reason),'') is null then raise exception 'A goal deletion reason is required'; end if;
  select * into v_goal from public.employee_goals where id=p_goal_id for update;
  if not found or v_goal.deleted_at is not null then raise exception 'Active goal not found'; end if;
  if p_expected_revision is distinct from v_goal.goal_revision then raise exception 'The goal changed; refresh it before saving'; end if;
  update public.employee_goals set deleted_at=clock_timestamp(),deleted_by=auth.uid(),delete_reason=trim(p_delete_reason),
    goal_revision=goal_revision+1,goal_edit_reason=trim(p_delete_reason),goal_edited_at=clock_timestamp(),goal_edited_by=auth.uid()
    where id=p_goal_id;
end;
$$;

-- Only actual result updates remain exposed as direct table updates. Definition
-- changes use the RPCs above; physical deletion is never a user operation.
revoke update,delete on public.employee_goals from authenticated;
grant update(actual_value) on public.employee_goals to authenticated;
revoke all on function public.update_employee_goal(uuid,integer,text,text,date,numeric,text,text) from public,anon;
revoke all on function public.archive_employee_goal(uuid,integer,text) from public,anon;
grant execute on function public.update_employee_goal(uuid,integer,text,text,date,numeric,text,text) to authenticated;
grant execute on function public.archive_employee_goal(uuid,integer,text) to authenticated;
revoke all on function public.guard_employee_goal_changes() from public;
revoke all on function public.capture_employee_goal_audit() from public;

notify pgrst,'reload schema';
commit;
