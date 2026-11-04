import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('receiver: atomic batches, duplicate/unknown mapping, RLS, cursor and unknown punch type', async () => {
  const db = new PGlite();
  const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
  const file = name => readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8');
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table profiles(id uuid primary key, role text, user_roles text[] default '{}');
      create function current_user_has_role(r text) returns boolean language sql stable security definer as $$select exists(select 1 from profiles where id=auth.uid() and (role=r or r=any(user_roles)))$$;
      create table branches(id uuid primary key,name text);
      create table employees(id uuid primary key,zkt_user_id text);
      grant usage on schema public,auth to service_role,authenticated,anon;
      grant select on employees,branches to service_role;
      insert into branches values('${id(1)}','Test');
      insert into employees values('${id(10)}','42'),('${id(11)}','DUP'),('${id(12)}','DUP');
      insert into profiles values('${id(20)}','admin','{}'),('${id(21)}','employee','{}'),('${id(22)}','employee','{hr}');`);
    await db.exec(await file('20261031_zkbio_attendance_ingest.sql'));
    await db.exec(await file('20261102_zkbio_receiver.sql'));
    await db.exec(`insert into attendance_devices(serial_number,branch_id) values('DEVICE','${id(1)}')`);
    const payload = {source_id:'zkbio-central',window_start:'2026-10-31T00:00:00Z',window_end:'2026-11-01T00:00:00Z',complete_window:true,
      devices:[{serial_number:'DEVICE',device_name:'Do not override',external_status_code:'1'}, {serial_number:'EXACT',device_name:'Test'}, {serial_number:'REVIEW',device_name:'Unknown branch'}],
      records:['42','DUP','MISSING'].map((code,i)=>({sync_key:String(i+1).repeat(64),external_employee_id:code,device_serial:'DEVICE',punch_time:'2026-10-31T07:00:00Z',punch_type:'255'}))};
    const ingest = async body => (await db.query('select ingest_zkbio_attendance($1::jsonb) as result',[JSON.stringify(body)])).rows[0].result;
    await db.exec('set role service_role');
    const result = await ingest(payload);
    assert.deepEqual(result,{accepted:3,duplicates:0,unmatched:2,ambiguous_employee_codes:1,complete_window:true});
    const again = await ingest(payload); assert.equal(again.accepted,0); assert.equal(again.duplicates,3);
    await db.exec('reset role');
    const rows=(await db.query('select * from attendance_raw_logs order by external_employee_id')).rows;
    assert.equal(rows.length,3); assert.equal(rows[0].employee_id,id(10));
    assert.equal(rows[1].employee_id,null); assert.equal(rows[2].employee_id,null);
    assert.ok(rows.every(r=>r.punch_type==='255' && r.branch_id===id(1)));
    assert.equal((await db.query("select branch_id from attendance_devices where serial_number='DEVICE'")).rows[0].branch_id,id(1));
    assert.equal((await db.query("select branch_id from attendance_devices where serial_number='EXACT'")).rows[0].branch_id,id(1));
    assert.equal((await db.query("select branch_id from attendance_devices where serial_number='REVIEW'")).rows[0].branch_id,null);
    const before=(await db.query('select last_successful_sync from attendance_sync_state')).rows[0].last_successful_sync;
    await db.exec('set role service_role');
    await assert.rejects(()=>ingest({...payload, devices:[{serial_number:'ROLLBACK'}],records:[{...payload.records[0],sync_key:'f'.repeat(64),punch_time:'invalid'}]}));
    await ingest({...payload,window_start:'2026-10-30T00:00:00Z',window_end:'2026-10-31T00:00:00Z'});
    await db.exec('reset role');
    assert.equal((await db.query("select count(*)::int as n from attendance_devices where serial_number='ROLLBACK'")).rows[0].n,0);
    assert.deepEqual((await db.query('select last_successful_sync from attendance_sync_state')).rows[0].last_successful_sync,before);
    await db.exec(await file('20261102_zkbio_receiver.sql'));
    const actor=async n=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(n)]);await db.exec('set role authenticated');};
    await actor(21); assert.equal((await db.query('select * from attendance_raw_logs')).rows.length,0);
    await assert.rejects(()=>ingest(payload),/permission denied/);
    await actor(20); assert.equal((await db.query('select * from attendance_raw_logs')).rows.length,3);
    await assert.rejects(()=>db.exec("delete from attendance_raw_logs"),/permission denied/);
    await actor(22); assert.equal((await db.query('select * from attendance_raw_logs')).rows.length,3);
  } finally { await db.close(); }
});
