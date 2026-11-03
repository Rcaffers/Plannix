// Only the uniquely named disposable Supabase project may run this test.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { endpointHash } from '../server/push/subscription.js';
import { registerPushRoutes } from '../server/routes/push-routes.js';
import { errorHandler } from '../server/middleware/errorHandler.js';
import { verifyLocalDocker } from './test-academic-year-migration.js';
import { runContendedPair, waitForActualBlock } from './personal-events-race-core.js';

const workdir = fileURLToPath(new URL('..', import.meta.url));
const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');
const project = /^project_id\s*=\s*"([^"]+)"/m.exec(config)?.[1];
if (project !== 'plannix_notification_review') throw Error('Disposable notification project required.');
const verified = verifyLocalDocker({ project, workdir });
const args = [...verified.prefix, 'exec', '-i', verified.containerId,
  'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'];
const q = value => "'" + value + "'";
const a = 'ef000000-0000-4000-8000-000000000001';
const b = 'ef000000-0000-4000-8000-000000000002';
const aBinding = 'ef000000-0000-4000-8000-000000000011';
const bBinding = 'ef000000-0000-4000-8000-000000000012';
const externalBinding = 'ef000000-0000-4000-8000-000000000013';
const aSession = 'ef000000-0000-4000-8000-000000000021';
const bSession = 'ef000000-0000-4000-8000-000000000022';
const externalSession = 'ef000000-0000-4000-8000-000000000023';
const hash = 'f'.repeat(64), firstHash = 'e'.repeat(64);
const cleanupHashes = ['2','3','4'].map(n => n.padStart(64,'0'));
const cleanupBindings = ['ef000000-0000-4000-8000-000000000014',
  'ef000000-0000-4000-8000-000000000015',
  'ef000000-0000-4000-8000-000000000016'];
const cleanupSessions = ['ef000000-0000-4000-8000-000000000024',
  'ef000000-0000-4000-8000-000000000025',
  'ef000000-0000-4000-8000-000000000026'];
const endpoint = 'https://fcm.googleapis.com/fcm/send/fixture-device';
const httpEndpoint = 'https://fcm.googleapis.com/fcm/send/fixture-http-device';
const httpHash = endpointHash(httpEndpoint);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function bounded(work, milliseconds, label) {
  let timer;
  return Promise.race([work,new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(Error(label+' timed out.')),milliseconds);
  })]).finally(()=>clearTimeout(timer));
}
function sql(command) {
  const result = spawnSync('docker', args, { input:"set statement_timeout='8s';\n" + command,
    encoding:'utf8',env:verified.env,timeout:11000,maxBuffer:100000 });
  if (result.error || result.status !== 0) throw Error('Disposable notification database query failed.');
  return result.stdout.trim();
}
function register(session, targetHash, version) {
  return `select public.plannix_push_register_installation(${q(session)},${q(targetHash)},${q(endpoint)},${q('p'.repeat(87))},${q('q'.repeat(22))},${version ? q(version) : 'null'})->>'state'`;
}
function session(name, operation, hold) {
  const child = spawn('docker', args, { env:verified.env,stdio:['pipe','pipe','pipe'] });
  let output = '', exit;
  const deadline = setTimeout(() => child.kill('SIGKILL'),15000);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',chunk => { output += chunk; if (output.length > 10000) child.kill('SIGKILL'); });
  child.stderr.on('data',chunk => { if (chunk.length > 10000) child.kill('SIGKILL'); });
  const closed = new Promise(resolve => {
    child.on('error',() => { exit={ok:false,output};clearTimeout(deadline);resolve(); });
    child.on('close',code => { exit={ok:code===0,output};clearTimeout(deadline);resolve(); });
  });
  child.stdin.on('error',() => {});
  child.stdin.write(`set application_name=${q(name)};set statement_timeout='12s';begin;set local role service_role;select 'READY';\n`);
  return {
    name,closed,
    send(command) {
      if (exit) throw Error('Database session exited before barrier.');
      if (command==='OPERATE') child.stdin.write(operation + ';\n' + (hold ? "select 'OPERATED';\n" : 'commit;\n\\q\n'));
      else if (command==='COMMIT') child.stdin.end('commit;\n\\q\n');
    },
    async waitFor(marker) {
      const until=Date.now()+6000;
      while (Date.now()<until) {
        if (output.split(/\r?\n/).includes(marker)) return;
        if (exit) throw Error('Database session failed before barrier.');
        await pause(20);
      }
      throw Error('Database barrier timed out.');
    },
    async waitExit() { await Promise.race([closed,pause(13000).then(()=>{throw Error('Database child timed out.');})]); return exit; },
    stop() { if (!exit) child.kill('SIGKILL'); },
  };
}
function observation(first,second) {
  return sql("select json_build_object('aPid',a.pid,'bPid',b.pid,'aName',a.application_name,"
    + "'bName',b.application_name,'bState',b.state,'waitType',b.wait_event_type,'bQuery',b.query,"
    + "'blockers',pg_blocking_pids(b.pid),'waitingLocks',(select coalesce(json_agg(json_build_object("
    + "'locktype',l.locktype,'granted',l.granted)),'[]'::json) from pg_locks l where l.pid=b.pid and not l.granted)) "
    + `from pg_stat_activity a cross join pg_stat_activity b where a.application_name=${q(first)} and b.application_name=${q(second)}`);
}
async function race(label, firstOperation, secondOperation, expectedFirst, expectedSecond, expectedQuery) {
  const first=session('push_install_'+label+'_first',firstOperation,true);
  const second=session('push_install_'+label+'_second',secondOperation,false);
  await runContendedPair({ first,second,observe:()=>observation(first.name,second.name),expectedQuery,
    inspect:async (firstResult,secondResult,block) => {
      assert.equal(firstResult.ok,true); assert.equal(secondResult.ok,true);
      assert.match(firstResult.output,new RegExp(`\\b${expectedFirst}\\b`));
      assert.match(secondResult.output,new RegExp(`\\b${expectedSecond}\\b`));
      assert.ok(block.lockTypes.length>0);
    },
    cleanup:async () => {
      try { sql(`select pg_terminate_backend(pid) from pg_stat_activity where application_name in (${q(first.name)},${q(second.name)}) and pid<>pg_backend_pid()`); }
      finally { first.stop();second.stop();await Promise.all([first.closed,second.closed]); }
    },
  });
}

async function cancelledHttpRegistration() {
  assert.equal(sql(`set role service_role;select public.plannix_push_register_installation(${q(aSession)},
    ${q(httpHash)},${q(httpEndpoint)},${q('p'.repeat(87))},${q('q'.repeat(22))},null)->>'state'`),'registered');
  const oldVersion=sql(`select installation_version from private.plannix_push_subscriptions where endpoint_hash=${q(httpHash)}`);
  const holder=session('push_http_b_reassignment',`select public.plannix_push_register_installation(${q(bSession)},
    ${q(httpHash)},${q(httpEndpoint)},${q('p'.repeat(87))},${q('q'.repeat(22))},${q(oldVersion)})->>'state'`,true);
  const admitted=session('push_http_admitted_a',`select public.plannix_push_register_installation(${q(aSession)},
    ${q(httpHash)},${q(httpEndpoint)},${q('p'.repeat(87))},${q('q'.repeat(22))},${q(oldVersion)})->>'state'`,false);
  let entered, terminal;
  const enteredWork=new Promise(resolve=>{entered=resolve;});
  const terminalWork=new Promise(resolve=>{terminal=resolve;});
  let terminalState;
  const app=express();
  registerPushRoutes({app,requireAuth:(req,_res,next)=>{
    req.auth={userId:a};req.serverSession={sessionId:aSession};next();
  },service:{configured:()=>true,register:async()=>{
    entered();
    admitted.send('OPERATE');
    try { terminalState=await admitted.waitExit(); }
    finally { terminal(); }
  }}});
  app.use(errorHandler);
  const server=app.listen(0,'127.0.0.1');
  await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  let primary;
  try {
    await holder.waitFor('READY');
    await admitted.waitFor('READY');
    holder.send('OPERATE');
    await holder.waitFor('OPERATED');
    const controller=new AbortController();
    const request=fetch(`http://127.0.0.1:${server.address().port}/api/notifications/register`,{
      method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
      body:JSON.stringify({subscription:{endpoint:httpEndpoint,keys:{p256dh:'p'.repeat(87),auth:'q'.repeat(22)}},
        expectedVersion:oldVersion}),
    });
    void request.catch(()=>{});
    await bounded(enteredWork,6000,'HTTP admission barrier');
    const blocked=await waitForActualBlock({observe:()=>observation(holder.name,admitted.name),
      aName:holder.name,bName:admitted.name,expectedQuery:'plannix_push_register_installation'});
    assert.ok(blocked.lockTypes.length>0);
    controller.abort();
    await assert.rejects(request,error=>error.name==='AbortError');
    holder.send('COMMIT');
    assert.equal((await holder.waitExit()).ok,true);
    await bounded(terminalWork,13000,'HTTP terminal barrier');
    assert.equal(terminalState.ok,true);
    assert.match(terminalState.output,/\bconflict\b/);
    assert.equal(sql(`select user_id from private.plannix_push_subscriptions where endpoint_hash=${q(httpHash)}`),b);
  } catch (error) { primary=error;throw error; }
  finally {
    let cleanupError;
    try { sql(`select pg_terminate_backend(pid) from pg_stat_activity where application_name in
      (${q(holder.name)},${q(admitted.name)}) and pid<>pg_backend_pid()`); }
    catch (error) { cleanupError=error; }
    holder.stop();admitted.stop();
    try { await bounded(Promise.all([holder.closed,admitted.closed]),5000,'HTTP database cleanup'); }
    catch (error) { cleanupError ||= error; }
    server.closeAllConnections?.();
    try { await bounded(new Promise(resolve=>server.close(resolve)),5000,'HTTP server cleanup'); }
    catch (error) { cleanupError ||= error; }
    if (cleanupError) {
      if (!primary) throw cleanupError;
      console.error('Secondary HTTP race cleanup failure:',cleanupError.message);
    }
  }
}

if (sql(`select count(*) from auth.users where id in (${q(a)},${q(b)})`) !== '0')
  throw Error('Disposable fixture already exists.');
// A previous test run can leave the two synthetic browser markers because
// browser bindings are not owned by auth.users.
sql(`delete from private.plannix_auth_browser_bindings where id in (${q(aBinding)},${q(bBinding)},${q(externalBinding)},${cleanupBindings.map(q).join(',')})`);
sql(`delete from private.plannix_push_endpoint_history where endpoint_hash in (${q(hash)},${q(firstHash)},${q(httpHash)})
  or endpoint_hash in (select lpad(to_hex(n),64,'0') from generate_series(1,10) as n)`);
try {
  for (const [id, binding, marker, secret, generation] of [
    [a,aBinding,'a','c',920001],[b,bBinding,'b','d',920002],
  ]) {
    sql(`insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values ('00000000-0000-0000-0000-000000000000',${q(id)},'authenticated','authenticated',${q(id+'@example.test')},'',now(),'{}','{}',now(),now());`
      + `insert into private.plannix_auth_browser_bindings(id,marker_hash,expires_at,current_session_id) values (${q(binding)},repeat(${q(marker)},64),now()+interval '1 day',${q(id===a?aSession:bSession)});`
      + `insert into private.plannix_auth_sessions(id,binding_id,generation,owner_id,kind,secret_hash,access_envelope,refresh_envelope,expires_at) values (${q(id===a?aSession:bSession)},${q(binding)},${generation},${q(id)},'ordinary',repeat(${q(secret)},64),'{}','{}',now()+interval '1 day')`);
  }
  sql(`insert into private.plannix_auth_browser_bindings(id,marker_hash,expires_at,current_session_id)
    values (${q(externalBinding)},repeat('e',64),now()+interval '1 day',${q(externalSession)});
    insert into private.plannix_auth_sessions(id,binding_id,generation,owner_id,kind,secret_hash,access_envelope,refresh_envelope,expires_at)
    values (${q(externalSession)},${q(externalBinding)},920003,${q(a)},'ordinary',repeat('e',64),'{}','{}',now()+interval '1 day')`);
  assert.equal(sql('set role service_role;'+register(aSession,hash,null)), 'registered');
  for (let i=0;i<cleanupSessions.length;i++) {
    sql(`insert into private.plannix_auth_browser_bindings(id,marker_hash,expires_at,current_session_id)
      values (${q(cleanupBindings[i])},repeat(${q(String(i+2))},64),now()+interval '1 day',${q(cleanupSessions[i])});
      insert into private.plannix_auth_sessions(id,binding_id,generation,owner_id,kind,secret_hash,
        access_envelope,refresh_envelope,expires_at)
      values (${q(cleanupSessions[i])},${q(cleanupBindings[i])},${920004+i},${q(a)},'ordinary',
        repeat(${q(String(i+2))},64),'{}','{}',now()+interval '1 day')`);
    assert.equal(sql('set role service_role;'+register(cleanupSessions[i],cleanupHashes[i],null)),'registered');
  }
  for (let i=0;i<2;i++) {
    const oldVersion=sql(`select installation_version from private.plannix_push_subscriptions
      where endpoint_hash=${q(cleanupHashes[i])}`);
    const deletion=i===0
      ? `set local role postgres;delete from private.plannix_auth_sessions where id=${q(cleanupSessions[i])};select 'deleted'`
      : `set local role postgres;delete from private.plannix_auth_browser_bindings where id=${q(cleanupBindings[i])};select 'deleted'`;
    await race(i===0?'session_delete_vs_register':'binding_cascade_vs_register',deletion,
      register(bSession,cleanupHashes[i],oldVersion),'deleted','conflict','plannix_push_register_installation');
    assert.equal(sql(`select bound_session_id is null and detail_disabled from private.plannix_push_subscriptions
      where endpoint_hash=${q(cleanupHashes[i])}`),'t');
    assert.equal(sql(`select h.active and h.generation=s.installation_version
      from private.plannix_push_endpoint_history h join private.plannix_push_subscriptions s using(endpoint_hash)
      where h.endpoint_hash=${q(cleanupHashes[i])}`),'t');
    assert.equal(sql(`select count(*) from private.plannix_auth_sessions where id=${q(cleanupSessions[i])}`),'0');
    const freshVersion=sql(`select installation_version from private.plannix_push_subscriptions
      where endpoint_hash=${q(cleanupHashes[i])}`);
    assert.equal(sql('set role service_role;'+register(bSession,cleanupHashes[i],freshVersion)),'registered');
    assert.equal(sql(`select user_id from private.plannix_push_subscriptions where endpoint_hash=${q(cleanupHashes[i])}`),b);
  }
  const reverseVersion=sql(`select installation_version from private.plannix_push_subscriptions
    where endpoint_hash=${q(cleanupHashes[2])}`);
  await race('register_vs_session_delete',register(bSession,cleanupHashes[2],reverseVersion),
    `set local role postgres;delete from private.plannix_auth_sessions where id=${q(cleanupSessions[2])};select 'deleted'`,
    'registered','deleted','delete from private.plannix_auth_sessions');
  assert.equal(sql(`select user_id::text||':'||bound_session_id::text from private.plannix_push_subscriptions
    where endpoint_hash=${q(cleanupHashes[2])}`),`${b}:${bSession}`);
  assert.equal(sql(`select h.active and h.generation=s.installation_version
    from private.plannix_push_endpoint_history h join private.plannix_push_subscriptions s using(endpoint_hash)
    where h.endpoint_hash=${q(cleanupHashes[2])}`),'t');
  await cancelledHttpRegistration();
  const httpVersion=sql(`select installation_version from private.plannix_push_subscriptions where endpoint_hash=${q(httpHash)}`);
  const lateLegacyAfterRemoval=`do $legacy$ begin perform public.plannix_push_register_device(${q(a)},
    ${q(httpHash)},${q(httpEndpoint)},${q('p'.repeat(87))},${q('q'.repeat(22))});
    raise exception 'Legacy writer unexpectedly succeeded';
    exception when sqlstate 'P2002' then null; end $legacy$;select 'legacy_blocked'`;
  await race('legacy_after_new_remove',
    `select public.plannix_push_remove_installation(${q(bSession)},${q(httpHash)},${q(httpVersion)})`,
    lateLegacyAfterRemoval,'t','legacy_blocked','plannix_push_register_device');
  const oldVersion=sql(`select installation_version from private.plannix_push_subscriptions where endpoint_hash=${q(hash)}`);
  const oldGenericVersion=sql(`select subscription_version from private.plannix_push_subscriptions where endpoint_hash=${q(hash)}`);
  await race('reassign',register(bSession,hash,oldVersion),register(aSession,hash,oldVersion),
    'registered','conflict','plannix_push_register_installation');
  assert.equal(sql(`select user_id from private.plannix_push_subscriptions where endpoint_hash=${q(hash)}`),b);
  assert.equal(sql(`set role service_role;select public.plannix_push_remove_installation(${q(aSession)},${q(hash)},${q(oldVersion)})`),'f');
  assert.equal(sql(`set role service_role;select public.plannix_push_remove_expired_device(${q(a)},${q(hash)},${q(oldGenericVersion)})`),'f');
  const bVersion=sql(`select installation_version from private.plannix_push_subscriptions where endpoint_hash=${q(hash)}`);
  await race('remove',register(bSession,hash,bVersion),
    `select public.plannix_push_remove_installation(${q(aSession)},${q(hash)},${q(oldVersion)})`,
    'registered','f','plannix_push_remove_installation');
  const legacyRegister=`do $legacy$ begin perform public.plannix_push_register_device(${q(a)},${q(hash)},
    ${q(endpoint)},${q('p'.repeat(87))},${q('q'.repeat(22))});
    raise exception 'Legacy writer unexpectedly succeeded';
    exception when sqlstate 'P2002' then null; end $legacy$;select 'legacy_blocked'`;
  const beforeLegacy=sql(`select installation_version from private.plannix_push_subscriptions where endpoint_hash=${q(hash)}`);
  await race('legacy_register',register(bSession,hash,beforeLegacy),legacyRegister,
    'registered','legacy_blocked','plannix_push_register_device');
  const beforeLegacyRemove=sql(`select subscription_version from private.plannix_push_subscriptions where endpoint_hash=${q(hash)}`);
  const beforeNewUpdate=sql(`select installation_version from private.plannix_push_subscriptions where endpoint_hash=${q(hash)}`);
  await race('legacy_remove',register(bSession,hash,beforeNewUpdate),
    `select public.plannix_push_remove_device(${q(b)},${q(hash)},${q(beforeLegacyRemove)})`,
    'registered','f','plannix_push_remove_device');
  await race('first',register(aSession,firstHash,null),register(bSession,firstHash,null),
    'registered','conflict','plannix_push_register_installation');
  assert.equal(sql(`select user_id from private.plannix_push_subscriptions where endpoint_hash=${q(firstHash)}`),a);
  const firstVersion=sql(`select installation_version from private.plannix_push_subscriptions where endpoint_hash=${q(firstHash)}`);
  await race('remove_then_first',
    `select public.plannix_push_remove_installation(${q(aSession)},${q(firstHash)},${q(firstVersion)})`,
    register(aSession,firstHash,null),'t','conflict','plannix_push_register_installation');
  assert.equal(sql(`set role service_role;${register(aSession,firstHash,null)}`),'conflict');
  const tombstone=sql(`select generation from private.plannix_push_endpoint_history where endpoint_hash=${q(firstHash)}`);
  assert.equal(sql(`set role service_role;${register(bSession,firstHash,tombstone)}`),'registered');
  assert.equal(sql(`select user_id from private.plannix_push_subscriptions where endpoint_hash=${q(firstHash)}`),b);
  const afterReenable=sql(`select installation_version from private.plannix_push_subscriptions where endpoint_hash=${q(firstHash)}`);
  await race('external_revocation',
    `set local role postgres;select 1 from private.plannix_auth_browser_bindings where id=${q(externalBinding)} for update;
      update private.plannix_auth_sessions set revoked=true where id=${q(externalSession)};select 'revoked'`,
    register(externalSession,firstHash,afterReenable),'revoked','stale','plannix_push_register_installation');
  const markerGeneration=sql(`select generation from private.plannix_auth_browser_bindings where id=${q(bBinding)}`);
  const logout=`select public.plannix_auth_logout(${q('__Host-plannix-b-'+markerGeneration)},${q('b'.repeat(64))},${q('__Host-plannix-s-920002')},${q('d'.repeat(64))})->>'state'`;
  const finalVersion=sql(`select installation_version from private.plannix_push_subscriptions where endpoint_hash=${q(hash)}`);
  await race('logout',logout,register(bSession,hash,finalVersion),
    'revoked','stale','plannix_push_register_installation');
  assert.equal(sql(`select user_id from private.plannix_push_subscriptions where endpoint_hash=${q(hash)}`),b);
  assert.equal(sql(`select count(*) from private.plannix_push_subscriptions as p
    join private.plannix_auth_sessions as s on s.id=p.bound_session_id
    join private.plannix_auth_browser_bindings as binding on binding.id=s.binding_id
    where p.endpoint_hash=${q(hash)} and not p.detail_disabled
      and binding.current_session_id=p.bound_session_id and not s.revoked and not s.expired`),'0');
  const aMarkerGeneration=sql(`select generation from private.plannix_auth_browser_bindings where id=${q(aBinding)}`);
  const callbackIntent=sql(`set role service_role;select public.plannix_auth_begin(${q('__Host-plannix-b-'+aMarkerGeneration)},
    ${q('a'.repeat(64))},'ordinary',${q('__Host-plannix-s-920001')},${q('c'.repeat(64))})->>'intentId'`);
  const aDevice=sql(`select installation_version from private.plannix_push_subscriptions where endpoint_hash=${q('1'.padStart(64,'0'))}`);
  await race('callback_settlement',
    `select public.plannix_auth_settle(${q(callbackIntent)},'created',${q(b)},${q('1'.repeat(64))},'{}','{}')->>'state'`,
    register(aSession,'1'.padStart(64,'0'),aDevice),'created','stale','plannix_push_register_installation');
  console.log('Thirteen lock-observed installation/auth/cleanup races and HTTP cancellation with a real reassignment passed.');
} finally {
  sql(`delete from auth.users where id in (${q(a)},${q(b)})`);
  sql(`delete from private.plannix_auth_browser_bindings where id in (${q(aBinding)},${q(bBinding)},${q(externalBinding)},${cleanupBindings.map(q).join(',')})`);
  sql(`delete from private.plannix_push_endpoint_history where endpoint_hash in (${q(hash)},${q(firstHash)},${q(httpHash)})
    or endpoint_hash in (select lpad(to_hex(n),64,'0') from generate_series(1,10) as n)`);
}
