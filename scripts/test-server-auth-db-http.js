// Isolated Stage 3 HTTP/database proof; never targets an existing database.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServerSessionTestApp } from '../server/auth/serverSessionTestApp.js';
import { createPrivateSessionRepository } from '../server/auth/privateSessionRepository.js';

const run=promisify(execFile);
const database=process.argv[2];
if (!/^auth_stage3_[a-z0-9_]+$/.test(database || '')) throw Error('Disposable database required.');
for (const name of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_CONFIG']) {
  if (process.env[name]) throw Error('Docker overrides are forbidden.');
}
const container='supabase_db_Plannix';
const docker=async args=>(await run('docker',args,{timeout:9000,maxBuffer:65536})).stdout.trim();
if (await docker(['context','show'])!=='desktop-linux'
  || await docker(['inspect','--format','{{.Name}} {{.State.Running}}',container])!==`/${container} true`) {
  throw Error('Verified local Docker target required.');
}
const query=sql=>docker(['exec',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1',
  '-U','postgres','-d',database,'-c',sql]);
if (await query('select count(*) from auth.users')!=='0') throw Error('Database is not empty.');
const parameters={
  plannix_auth_issue_binding:[['target_hash','text']],
  plannix_auth_select:[['candidates','jsonb']],
  plannix_auth_begin:[['marker_name','text'],['provided_marker_hash','text'],
    ['target_kind','text'],['session_name','text'],['provided_session_hash','text']],
  plannix_auth_reserve_callback:[['marker_name','text'],['provided_marker_hash','text'],
    ['provided_state_hash','text'],['target_kind','text'],['initiating_intent','uuid']],
  plannix_auth_attach_callback:[['marker_name','text'],['provided_marker_hash','text'],
    ['provided_state_hash','text'],['target_kind','text'],['provided_flow_id','text'],
    ['verifier_cipher','jsonb']],
  plannix_auth_ready_callback:[['marker_name','text'],['provided_marker_hash','text'],
    ['provided_state_hash','text'],['target_kind','text']],
  plannix_auth_cancel_callback:[['marker_name','text'],['provided_marker_hash','text'],
    ['provided_state_hash','text'],['target_kind','text']],
  plannix_auth_claim_callback:[['marker_name','text'],['provided_marker_hash','text'],
    ['provided_state_hash','text'],['provided_flow_id','text'],['target_kind','text'],
    ['session_name','text'],['provided_session_hash','text']],
  plannix_auth_settle:[['target_intent','uuid'],['outcome','text'],['confirmed_owner','uuid'],
    ['target_hash','text'],['access_cipher','jsonb'],['refresh_cipher','jsonb']],
};
const literal=value=>value==null?'NULL':`'${String(typeof value==='object'?JSON.stringify(value):value).replaceAll("'","''")}'`;
const rpc=async(name,args)=>{
  const fields=parameters[name];
  if (!fields || Object.keys(args).length!==fields.length) throw Error('Unexpected RPC.');
  const input=fields.map(([field,type])=>`${field}=>${literal(args[field])}::${type}`).join(',');
  const output=await query(`begin;set local role service_role;select public.${name}(${input})::text;commit;`);
  return {data:JSON.parse(output)};
};
const cipher={encrypt:({token})=>({synthetic:true,token}),decrypt:({envelope})=>envelope.token};
const repository=createPrivateSessionRepository({rpc,cipher});
const origin='http://127.0.0.1:43579';
let callback;
const identity={login:async()=>{},validateAccess:async()=>({}),sendRecovery:async input=>{
  callback=input;
  await input.onVerifier('a'.repeat(32),'synthetic-verifier');
  throw Error('Synthetic provider failure');
}};
const app=createServerSessionTestApp({origin,repository,identity,csrfKey:Buffer.alloc(32,1)});
const listener=app.listen(43579,'127.0.0.1');
await new Promise(resolve=>listener.once('listening',resolve));
let fixtureMarkerHash;
try {
  const boot=await fetch(`${origin}/__stage3/auth/bootstrap`);
  assert.equal(boot.status,200);
  const cookie=boot.headers.get('set-cookie').split(';')[0];
  fixtureMarkerHash=createHash('sha256').update(cookie.split('=')[1]).digest('hex');
  const {csrfToken}=await boot.json();
  const recovery=await fetch(`${origin}/__stage3/auth/recover`,{method:'POST',
    headers:{Origin:origin,Cookie:cookie,'X-Plannix-CSRF':csrfToken,
      'Content-Type':'application/json'},body:JSON.stringify({email:'synthetic@example.test'})});
  assert.equal(recovery.status,200);
  assert.ok(callback);
  const state=new URL(callback.redirectTo).searchParams.get('state');
  assert.equal((await repository.claimCallback(cookie,{state,flowId:'a'.repeat(32),
    kind:'recovery'})).state,'invalid');
  assert.equal(await query('select count(*) from private.plannix_auth_callbacks where cancelled_at is not null'),'1');
  console.log('Disposable HTTP/database recovery failure: callback terminal; no claimable state.');
} finally {
  await new Promise(resolve=>listener.close(resolve));
  if (fixtureMarkerHash) await query(`delete from private.plannix_auth_browser_bindings
    where marker_hash='${fixtureMarkerHash}'`);
}
