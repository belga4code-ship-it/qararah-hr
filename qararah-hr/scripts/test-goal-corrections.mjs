import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Exercise the real migration and PostgreSQL RLS/grants, with no company data.
const db = new PGlite();
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [admin, hr, manager, employee, secondaryHr, auditor, secondaryAdmin] = [1, 2, 3, 4, 5, 6, 7].map(id);
const [worker, otherWorker, branch, otherBranch] = [20, 21, 30, 31].map(id);
const readMigration = (name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');

try {
  await db.exec(`
    create role authenticated; create role anon; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table profiles(id uuid primary key,role text,user_roles text[] default '{}',additional_permissions text[] default '{}',employee_id uuid,branch_id uuid);
    create table employees(id uuid primary key,branch_id uuid);
    create function current_app_role() returns text language sql stable security definer as $$select role from profiles where id=auth.uid()$$;
    create function current_employee_id() returns uuid language sql stable security definer as $$select employee_id from profiles where id=auth.uid()$$;
    create function current_branch_id() returns uuid language sql stable security definer as $$select branch_id from profiles where id=auth.uid()$$;
    create table audit_log(id uuid default gen_random_uuid(),entity_table text,entity_id uuid,employee_id uuid,branch_id uuid,action text,changed_fields text[],old_data jsonb,new_data jsonb,actor_id uuid,created_at timestamptz default now());
    grant usage on schema public,auth to authenticated,anon;
    grant select on employees to authenticated;
    insert into employees values('${worker}','${branch}'),('${otherWorker}','${otherBranch}');
    insert into profiles values
      ('${admin}','admin','{}','{}',null,'${branch}'),
      ('${hr}','hr','{}','{}',null,'${branch}'),
      ('${manager}','branch_manager','{}','{goals.manage,goals.view_all}',null,'${branch}'),
      ('${employee}','employee','{}','{}','${worker}','${branch}'),
      ('${secondaryHr}','employee','{employee,hr}','{}',null,'${branch}'),
      ('${auditor}','auditor','{}','{goals.view_all}',null,'${branch}'),
      ('${secondaryAdmin}','branch_manager','{branch_manager,admin}','{}',null,'${branch}');
  `);
  const roles = await readMigration('20261028_multi_user_access.sql');
  await db.exec(roles.slice(roles.indexOf('create or replace function public.current_user_has_role'), roles.indexOf('-- Additive permissions')));
  const mobile = await readMigration('20261021_employee_mobile_workspace.sql');
  await db.exec(mobile.slice(0, mobile.indexOf('create table if not exists public.employee_reports')));
  await db.exec(await readMigration('20261023_employee_goal_progress_updates.sql'));
  const scoped = await readMigration('20261103_branch_manager_scoped_permissions.sql');
  await db.exec(scoped.slice(scoped.indexOf('drop policy if exists "extra permission view all goals"'), scoped.indexOf('drop policy if exists "extra permission create evaluations"')));

  const migration = await readMigration('20261107_employee_goal_corrections.sql');
  await db.exec(migration);
  await db.exec(migration); // Reapplying must not erase revisions or audit history.

  const actor = async (person) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [person || '']);
    await db.exec('set role authenticated');
  };
  const owner = async () => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  };
  const createGoal = async (employeeId = worker, actual = 7) => {
    await owner();
    return (await db.query(`insert into employee_goals(employee_id,period_month,title,description,target_value,target_unit,actual_value,created_by)
      values($1,'2026-10-01','Original goal','Original detail',20,'visits',$2,$3) returning *`, [employeeId, actual, hr])).rows[0];
  };
  const goalAsOwner = async (goalId) => {
    await owner();
    return (await db.query('select * from employee_goals where id=$1', [goalId])).rows[0];
  };
  const edit = async (goalId, revision = 0, overrides = {}) => {
    const values = { title: 'Corrected goal', description: 'Corrected detail', month: '2026-11-01', target: 25.12, unit: 'calls', reason: 'Corrected an entry mistake', ...overrides };
    return (await db.query('select to_jsonb(update_employee_goal($1,$2,$3,$4,$5,$6,$7,$8)) as goal', [goalId, revision, values.title, values.description, values.month, values.target, values.unit, values.reason])).rows[0].goal;
  };
  const archive = (goalId, revision = 0, reason = 'Entered by mistake') => db.query('select archive_employee_goal($1,$2,$3)', [goalId, revision, reason]);

  const goal = await createGoal();
  for (const person of [manager, employee, auditor]) {
    await actor(person);
    await assert.rejects(() => edit(goal.id), /Only a system administrator or HR manager/);
    await assert.rejects(() => archive(goal.id), /Only a system administrator or HR manager/);
  }
  await actor(null);
  await assert.rejects(() => edit(goal.id), /Only a system administrator or HR manager/);
  await actor(hr);
  for (const invalid of [{ title: '   ' }, { month: '2026-11-02' }, { month: 'infinity' }, { target: -1 }, { target: 'NaN' }, { target: 'Infinity' }, { target: '10000000000' }, { reason: '  ' }]) {
    await assert.rejects(() => edit(goal.id, 0, invalid), /Invalid goal|correction reason/);
  }
  await assert.rejects(() => edit(goal.id, null), /goal changed/);
  await assert.rejects(() => edit(goal.id, 0, { title: 'Original goal', description: 'Original detail', month: '2026-10-01', target: 20, unit: 'visits' }), /No goal fields/);
  await assert.rejects(() => db.query("update employee_goals set title='Direct update' where id=$1", [goal.id]), /permission denied/);
  await assert.rejects(() => db.query('delete from employee_goals where id=$1', [goal.id]), /permission denied/);

  const updated = await edit(goal.id);
  assert.equal(updated.title, 'Corrected goal');
  assert.equal(updated.description, 'Corrected detail');
  assert.equal(updated.period_month, '2026-11-01');
  assert.equal(updated.target_value, 25.12);
  assert.equal(updated.target_unit, 'calls');
  assert.equal(updated.actual_value, 7);
  assert.equal(updated.goal_revision, 1);
  assert.equal(updated.goal_edited_by, hr);
  assert.equal(updated.goal_edit_reason, 'Corrected an entry mistake');
  assert.equal(updated.created_by, hr);
  await assert.rejects(() => edit(goal.id), /goal changed/);
  await assert.rejects(() => archive(goal.id, 0), /goal changed/);
  await owner();
  const audit = (await db.query("select * from audit_log where entity_id=$1 and new_data->>'goal_revision'='1'", [goal.id])).rows[0];
  assert.equal(audit.entity_table, 'employee_goals');
  assert.equal(audit.actor_id, hr);
  assert.equal(audit.branch_id, branch);
  assert.equal(audit.old_data.target_value, 20);
  assert.equal(audit.new_data.target_value, 25.12);
  assert.equal(audit.old_data.actual_value, audit.new_data.actual_value);
  assert.ok(audit.changed_fields.includes('goal_edit_reason'));
  assert.ok(!audit.changed_fields.includes('actual_value'));

  // Existing goals.manage permission retains branch-scoped result entry only.
  await actor(manager);
  await db.query('update employee_goals set actual_value=9 where id=$1', [goal.id]);
  const progress = (await db.query('select * from employee_goals where id=$1', [goal.id])).rows[0];
  assert.equal(Number(progress.actual_value), 9);
  assert.equal(progress.goal_revision, 2);
  await assert.rejects(() => db.query('update employee_goals set actual_value=-1 where id=$1', [goal.id]), /nonnegative/);
  await actor(hr);
  await assert.rejects(() => edit(goal.id, 1), /goal changed/);
  await actor(employee);
  await db.query('update employee_goals set actual_value=999 where id=$1', [goal.id]);
  assert.equal(Number((await db.query('select actual_value from employee_goals where id=$1', [goal.id])).rows[0].actual_value), 9);
  const other = await createGoal(otherWorker);
  await actor(manager);
  assert.equal((await db.query('select id from employee_goals where id=$1', [other.id])).rows.length, 0);
  await db.query('update employee_goals set actual_value=999 where id=$1', [other.id]);
  assert.equal(Number((await goalAsOwner(other.id)).actual_value), 7);

  for (const person of [admin, secondaryHr, secondaryAdmin]) {
    const allowed = await createGoal();
    await actor(person);
    const result = await edit(allowed.id, 0, { target: null, description: '  ', unit: ' ' });
    assert.equal(result.goal_edited_by, person);
    assert.equal(result.actual_value, 7);
    assert.equal(result.target_value, null);
    assert.equal(result.description, null);
    assert.equal(result.target_unit, null);
    await archive(allowed.id, 1, 'Confirmed mistaken goal');
    const allowedArchive = await goalAsOwner(allowed.id);
    assert.equal(allowedArchive.deleted_by, person);
    assert.equal(Number(allowedArchive.actual_value), 7);
  }

  // The trigger remains protective even if a future grant exposes more columns.
  await owner();
  await db.exec('grant update,delete on employee_goals to authenticated');
  await actor(manager);
  await assert.rejects(() => db.query("update employee_goals set title='Bypass' where id=$1", [goal.id]), /Only a system administrator or HR manager/);
  await assert.rejects(() => db.query('delete from employee_goals where id=$1', [goal.id]), /Archive goals instead/);
  await actor(admin);
  await assert.rejects(() => db.query("update employee_goals set title='No audit' where id=$1", [goal.id]), /audited goal correction/);
  await assert.rejects(() => db.query('update employee_goals set employee_id=$1 where id=$2', [otherWorker, goal.id]), /identity and creation history/);
  await assert.rejects(() => db.query('update employee_goals set goal_revision=100 where id=$1', [goal.id]), /revision cannot be changed directly/);
  await assert.rejects(() => db.query(`update employee_goals set title='Changed result',actual_value=100,goal_revision=goal_revision+1,
    goal_edit_reason='reason',goal_edited_by=$1,goal_edited_at=now() where id=$2`, [admin, goal.id]), /cannot change recorded results/);
  await assert.rejects(() => db.query('delete from employee_goals where id=$1', [goal.id]), /Archive goals instead/);
  await assert.rejects(() => db.query(`insert into employee_goals(employee_id,period_month,title,deleted_at) values($1,'2026-10-01','Fake archive',now())`, [worker]), /cannot contain correction or archive metadata/);

  await actor(hr);
  await assert.rejects(() => archive(goal.id, 2, '  '), /deletion reason/);
  await archive(goal.id, 2);
  assert.equal((await db.query('select * from employee_goals where id=$1', [goal.id])).rows.length, 0);
  await assert.rejects(() => edit(goal.id, 3), /Active goal not found/);
  await assert.rejects(() => archive(goal.id, 3), /Active goal not found/);
  for (const person of [admin, manager, employee, secondaryHr, auditor]) {
    await actor(person);
    assert.equal((await db.query('select id from employee_goals where id=$1', [goal.id])).rows.length, 0);
    await db.query('update employee_goals set actual_value=777 where id=$1', [goal.id]);
  }
  const archived = await goalAsOwner(goal.id);
  assert.equal(archived.goal_revision, 3);
  assert.equal(Number(archived.actual_value), 9);
  assert.equal(archived.deleted_by, hr);
  assert.equal(archived.delete_reason, 'Entered by mistake');
  assert.ok(archived.deleted_at);
  const archivedAudit = (await db.query("select * from audit_log where entity_id=$1 and new_data->>'goal_revision'='3'", [goal.id])).rows[0];
  assert.equal(archivedAudit.actor_id, hr);
  assert.equal(archivedAudit.old_data.deleted_at, null);
  assert.equal(archivedAudit.new_data.deleted_by, hr);
  assert.equal(archivedAudit.new_data.actual_value, 9);
  assert.ok(archivedAudit.changed_fields.includes('delete_reason'));

  // A simulated obsolete RPC cannot restore an archived goal even as owner.
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [hr]);
  await assert.rejects(() => db.query('update employee_goals set deleted_at=null where id=$1', [goal.id]), /Archived goals cannot be changed/);
  await owner();
  await db.exec(migration);
  assert.equal((await db.query("select has_column_privilege('authenticated','employee_goals','title','UPDATE') as allowed")).rows[0].allowed, false);
  assert.equal((await db.query("select has_column_privilege('authenticated','employee_goals','actual_value','UPDATE') as allowed")).rows[0].allowed, true);
  assert.equal((await db.query("select has_table_privilege('authenticated','employee_goals','DELETE') as allowed")).rows[0].allowed, false);

  console.log('Passed HR/admin and secondary-role goal corrections, goals.manage-only denial, validation, actual-result preservation, optimistic revisions, branch scope, direct-update/delete guards, archive visibility, and atomic audit history.');
} finally {
  await db.close();
}
