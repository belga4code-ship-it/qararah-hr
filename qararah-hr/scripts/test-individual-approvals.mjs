import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Runs the real migration in an isolated PostgreSQL engine; no company data.
const db = new PGlite();
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [a,b,c,admin,outsider] = [1,2,3,4,5].map(id);
await db.exec(`
create role authenticated; create role anon; create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table profiles(id uuid primary key,role text,branch_id uuid);
create table employee_private(employee_id uuid primary key,salary_amount numeric);
create table hr_events(id uuid primary key default gen_random_uuid(),employee_id uuid,branch_id uuid,event_type text,status text default 'pending',details jsonb default '{}',decision_reason text,decision_by uuid,decision_at timestamptz,approved_by uuid,approved_at timestamptz,payroll_recorded_at timestamptz,payroll_recorded_by uuid,amount numeric,amount_unit text);
create table hr_event_approval_steps(id uuid primary key default gen_random_uuid(),event_id uuid references hr_events(id),step_order smallint check(step_order between 1 and 2),approver_role text,approver_profile_id uuid,approver_profile_ids uuid[] default '{}',status text default 'pending',decided_by uuid,decided_at timestamptz,reason text,created_at timestamptz default now(),unique(event_id,step_order),unique(event_id,approver_role));
create function current_user_has_role(r text) returns boolean language sql stable security definer as $$select coalesce((select role=r from profiles where id=auth.uid()),false)$$;
create function current_branch_id() returns uuid language sql stable security definer as $$select branch_id from profiles where id=auth.uid()$$;
create function is_assigned_hr_event_responsible(e uuid) returns boolean language sql stable security definer as $$select coalesce((select details->'responsible_profile_ids' ? auth.uid()::text from hr_events where id=e),false)$$;
create function record_hr_event_decision() returns trigger language plpgsql as $$begin return new;end$$;
create function initialize_leave_approval_steps() returns trigger language plpgsql as $$begin return new;end$$;
create trigger initialize_leave_approval_steps after insert on hr_events for each row execute function initialize_leave_approval_steps();
grant usage on schema public,auth to authenticated;grant select,update on hr_events to authenticated;grant select on hr_event_approval_steps to authenticated;
insert into profiles values('${a}','branch_manager','${id(10)}'),('${b}','hr','${id(10)}'),('${c}','employee','${id(10)}'),('${admin}','admin','${id(10)}'),('${outsider}','hr','${id(10)}');
`);
const migrated = id(50);
await db.query(`insert into hr_events(id,event_type,details) values($1,'leave',$2)`,[migrated,JSON.stringify({responsible_profile_ids:[a,b]})]);
await db.query(`insert into hr_event_approval_steps(event_id,step_order,approver_role,approver_profile_id,approver_profile_ids,status,decided_by,decided_at,reason) values($1,1,'assigned_manager',$2,$3,'approved',$2,now(),'original')`,[migrated,a,[a,b]]);
const migration=await readFile(new URL('../supabase/migrations/20261105_individual_request_approvals.sql',import.meta.url),'utf8');
await db.exec(migration);
await db.exec("alter table hr_events add column effective_date date default '2026-10-18',add column end_date date,add column reason text default 'original reason'; create table audit_log(id uuid default gen_random_uuid(),entity_table text,entity_id uuid,employee_id uuid,branch_id uuid,action text,changed_fields text[],old_data jsonb,new_data jsonb,actor_id uuid,created_at timestamptz default now());");
const auditSQL=await readFile(new URL('../supabase/migrations/20261020_audit_log.sql',import.meta.url),'utf8');
const auditFunction=auditSQL.slice(auditSQL.indexOf('create or replace function public.capture_audit_log()'),auditSQL.indexOf('drop trigger if exists audit_profiles_changes'));
await db.exec(auditFunction+"create trigger audit_hr_event_changes after insert or update or delete on hr_events for each row execute function capture_audit_log();");
await db.exec(await readFile(new URL('../supabase/migrations/20261106_admin_report_corrections.sql',import.meta.url),'utf8'));

const steps = async(e)=>(await db.query('select * from hr_event_approval_steps where event_id=$1 order by step_order',[e])).rows;
assert.deepEqual((await steps(migrated)).map(s=>s.status),['approved','pending']);
assert.equal((await steps(migrated))[0].reason,'original');
const actor = async(person)=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[person||'']);await db.exec('set role authenticated');};
const request = async(kind='leave',people=[a,b,c])=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");return (await db.query(`insert into hr_events(employee_id,branch_id,event_type,details) values($1,$2,$3,$4) returning id`,[id(20),id(10),kind,JSON.stringify({responsible_profile_ids:people})])).rows[0].id;};
const decide=async(e,status='approved',type='none',value=null)=>(await db.query('select decide_employee_request($1,$2,$3,$4,$5) as status',[e,status,'test decision',type,value])).rows[0].status;
for(const kind of ['leave','permission','late_permission']){
  const e=await request(kind);
  assert.equal((await steps(e)).length,3);
  await actor(a);assert.equal(await decide(e),'pending');
  await assert.rejects(()=>decide(e),/No pending individual/);
  await actor(c);assert.equal(await decide(e),'pending');
  await actor(b);assert.equal(await decide(e),'approved');
  assert.deepEqual((await steps(e)).map(s=>s.decided_by),[a,b,c]);
}
const blocked=await request('permission');await actor(outsider);
await assert.rejects(()=>decide(blocked),/No pending individual/);
await assert.rejects(()=>db.query("update hr_events set status='approved',decision_reason='bypass' where id=$1",[blocked]),/assigned responsible/);
await actor(a);await assert.rejects(()=>db.query("update hr_events set status='approved',decision_reason='bypass' where id=$1",[blocked]),/All assigned/);
await assert.rejects(()=>db.query("update hr_events set details='{}' where id=$1",[blocked]),/snapshot cannot/);
await assert.rejects(()=>db.query("update hr_event_approval_steps set status='approved' where event_id=$1",[blocked]),/permission denied/);
await actor(null);await assert.rejects(()=>decide(blocked),/Authentication/);
await actor(a);assert.equal(await decide(blocked),'pending');await actor(admin);assert.equal(await decide(blocked),'approved');
const overrideSteps=await steps(blocked);assert.deepEqual(overrideSteps.map(s=>s.status),['approved','skipped','skipped']);assert.equal(overrideSteps[1].decided_by,null);
const override=(await db.query('select * from hr_events where id=$1',[blocked])).rows[0];assert.equal(override.details.admin_override.profile_id,admin);assert.equal(override.decision_by,admin);
const rejected=await request('late_permission');await actor(b);assert.equal(await decide(rejected,'rejected'),'rejected');assert.deepEqual((await steps(rejected)).map(s=>s.status),['skipped','rejected','skipped']);
const discounted=await request();await db.exec('reset role');await db.query('insert into employee_private values($1,3000)',[id(20)]);await actor(a);
await assert.rejects(()=>decide(discounted,'approved','days',1),/final leave approval/);assert.equal(await decide(discounted),'pending');await actor(b);assert.equal(await decide(discounted),'pending');await actor(c);assert.equal(await decide(discounted,'approved','days',1),'approved');assert.equal(Number((await db.query('select amount from hr_events where id=$1',[discounted])).rows[0].amount),100);
const oldClient=await request('leave',[a,b]);await actor(a);await db.query("select decide_hr_event_approval($1,'approved','old client')",[oldClient]);assert.equal((await db.query('select status from hr_events where id=$1',[oldClient])).rows[0].status,'pending');
// An out-of-branch manager cannot use the security-definer RPC to expand access.
await db.exec('reset role');await db.query('update profiles set branch_id=$1 where id=$2',[id(11),a]);const scoped=await request('permission');await actor(a);await assert.rejects(()=>decide(scoped),/outside your branch/);
await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");
// The targeted repair retains evidence and never reopens unrelated completed requests.
const repairId='13f9a0b2-374b-477a-b803-73cedc844285',ahmed='cde5dda5-b3dc-4f36-ac8e-ba2dbb14fb9a',khaled='ce73d4f4-c780-4f15-840c-c8b9515ddf93';
await db.query(`insert into hr_events(id,employee_id,event_type,status,decision_by,decision_at,details) values($1,'3786220a-222e-46a0-8c44-dcf34cf08306','leave','approved',$2,now(),$3)`,[repairId,ahmed,JSON.stringify({responsible_profile_ids:[ahmed,khaled]})]);
await db.query(`insert into hr_event_approval_steps(event_id,step_order,approver_role,approver_profile_ids,status,decided_by,decided_at,reason) values($1,1,'assigned_manager',$2,'approved',$3,now(),'preserved')`,[repairId,[ahmed,khaled],ahmed]);
const repair=await readFile(new URL('../supabase/repairs/yusuf_individual_approvals.sql',import.meta.url),'utf8');await db.exec(repair);await db.exec(repair);
assert.deepEqual((await steps(repairId)).map(s=>s.status),['approved','pending']);assert.equal((await steps(repairId))[0].reason,'preserved');assert.equal((await db.query('select status from hr_events where id=$1',[blocked])).rows[0].status,'approved');

// The report correction RPC must preserve approvals and enforce audit + revision checks.
const editable=await request('deduction',[]);await db.exec('reset role');await db.query("update hr_events set status='approved',amount=200,amount_unit='LYD',payroll_recorded_at=now(),decision_by=$2 where id=$1",[editable,admin]);
const edit=(revision=0,status='approved',value=175,note='correction reason')=>db.query("select admin_correct_hr_report($1,$2,$3,'2026-10-19',null,'corrected reason',$4,$5)",[editable,revision,status,value,note]);
await actor(b);await assert.rejects(()=>edit(),/Only a system administrator/);
await assert.rejects(()=>db.query("update hr_events set amount=175 where id=$1",[editable]),/Only a system administrator/);
await actor(admin);await assert.rejects(()=>edit(0,'approved',-1),/Invalid deduction/);
await assert.rejects(()=>edit(0,'approved',175,''),/correction reason/);
await assert.rejects(()=>edit(0,'pending'),/record changed/);
await assert.rejects(()=>db.query("update hr_events set amount=175 where id=$1",[editable]),/audited correction/);
await edit();
const corrected=(await db.query('select * from hr_events where id=$1',[editable])).rows[0];
assert.equal(Number(corrected.amount),175);assert.equal(corrected.report_revision,1);assert.equal(corrected.status,'approved');assert.equal(corrected.decision_by,admin);assert.equal(corrected.report_edited_by,admin);assert.equal(corrected.report_edit_reason,'correction reason');assert.ok(corrected.payroll_recorded_at);
await db.exec('reset role');const audit=(await db.query("select * from audit_log where entity_id=$1 and new_data->>'report_revision'='1'",[editable])).rows[0];assert.equal(Number(audit.old_data.amount),200);assert.equal(Number(audit.new_data.amount),175);assert.equal(audit.actor_id,admin);assert.ok(audit.changed_fields.includes('report_edit_reason'));
await actor(admin);await assert.rejects(()=>edit(),/record changed/);
const leaveEditable=await request('leave',[a,b]);await actor(admin);assert.equal(await decide(leaveEditable,'approved','fixed',100),'approved');
await db.query("select admin_correct_hr_report($1,0,'approved','2026-10-18',null,'original reason',0,'remove leave deduction')",[leaveEditable]);
const cleared=(await db.query('select * from hr_events where id=$1',[leaveEditable])).rows[0];assert.equal(cleared.amount,null);assert.equal(cleared.payroll_recorded_at,null);assert.equal(cleared.status,'approved');assert.equal(cleared.details.leave_discount_type,'none');
console.log('Passed admin-only corrections, direct-update protection, audited old/new amounts, correction reason, stale revision/status rejection, unchanged approvals, and payroll correction markers.');
await db.close();
console.log('Passed independent approvals for all three request types, out-of-order decisions, repeat/unauthorized/direct-update denial, admin override audit, rejection, final discounts, old clients, branch scope, pending migration, and targeted repair.');
