import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';

test('Edge receiver authenticates machine token, validates payload, and hides database errors', async () => {
  const file=await readFile(new URL('../supabase/functions/zkbio-attendance-ingest/index.ts',import.meta.url),'utf8');
  const code=stripTypeScriptTypes(file.replace(/^import .*;\r?\n/,''));
  let handler, calls=0, fail=false, errorState;
  runInNewContext(code,{
    crypto:globalThis.crypto,TextEncoder,Uint8Array,Response,Date,Number,console:{error(){}},
    Deno:{env:{get:name=>({SYNC_INGEST_TOKEN:'test-only',SUPABASE_URL:'http://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only'})[name]},serve:fn=>handler=fn},
    createClient:()=>({rpc:async(name,payload)=>{calls++;assert.equal(name,'ingest_zkbio_attendance');assert.equal(payload.p_payload.records[0].punch_type,'255');return fail?{error:new Error('DO NOT EXPOSE')}:{data:{accepted:1,duplicates:0,complete_window:true}};},from:()=>({upsert:async row=>{errorState=row;return {error:null};}})}),
  });
  const body={source_id:'zkbio-central',window_start:'2026-10-31T00:00:00Z',window_end:'2026-11-01T00:00:00Z',complete_window:true,devices:[],records:[{sync_key:'a'.repeat(64),external_employee_id:'42',device_serial:'DEVICE',punch_time:'2026-10-31T07:00:00Z',punch_type:'255'}]};
  const request=(token,payload=body)=>new Request('https://receiver.invalid',{method:'POST',headers:{'content-type':'application/json','x-sync-token':token},body:JSON.stringify(payload)});
  assert.equal((await handler(request('wrong'))).status,401);assert.equal(calls,0);
  assert.equal((await handler(request('test-only',{...body,records:[{}]}))).status,400);
  assert.equal((await handler(request('test-only',{...body,window_start:'2026-11-02T00:00:00Z'}))).status,400);
  const success=await handler(request('test-only'));assert.equal(success.status,200);assert.equal((await success.json()).accepted,1);
  fail=true;const failure=await handler(request('test-only'));assert.equal(failure.status,500);
  assert.deepEqual(await failure.json(),{error:'ingest_failed'});assert.equal(errorState.status,'error');
});
