// Actual Express route + PostgREST + PostgreSQL. Synthetic, unlinked DB only.
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {spawnSync,spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import express from 'express';
import {createClient} from '@supabase/supabase-js';
import {verifyLocalDocker} from './test-academic-year-migration.js';
import {createPrivateSessionRepository} from '../server/auth/privateSessionRepository.js';
import {createServerSessionRouter} from '../server/auth/serverSessionRouter.js';
import {createBrowserResetProofs,orphanContext} from '../server/auth/browserSignInReset.js';
const [project,workdir,cli]=process.argv.slice(2);
assert.match(project||'',/^plannix-reset-guard-[a-z0-9_-]+$/);
assert.equal(path.basename(workdir),project);
assert.equal(existsSync(path.join(workdir,'supabase/.temp/project-ref')),false);
const target=verifyLocalDocker({project,workdir});
const args=[...target.prefix,'exec','-i',target.containerId,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'];
function sql(text){const r=spawnSync('docker',args,{input:text,encoding:'utf8',env:target.env,timeout:10000});assert.equal(r.status,0,'disposable SQL failed');return r.stdout.trim();}
const status=spawnSync(cli,['status','-o','json'],{cwd:workdir,encoding:'utf8',env:target.env});
assert.equal(status.status,0,'local status failed');
const local=JSON.parse(status.stdout);
assert.ok(['127.0.0.1','localhost'].includes(new URL(local.API_URL).hostname));
// Local-only JWT signed using this disposable PostgREST instance's key.
const inspect=JSON.parse(spawnSync('docker',[...target.prefix,'inspect','supabase_rest_'+project],{env:target.env,encoding:'utf8'}).stdout)[0];
const secret=inspect.Config.Env.find(x=>x.startsWith('PGRST_JWT_SECRET=')).slice('PGRST_JWT_SECRET='.length);
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const jwk=JSON.parse(secret).keys.find(k=>k.kty==='oct');
assert.ok(jwk);
const unsigned=encode({alg:'HS256',typ:'JWT',...(jwk.kid?{kid:jwk.kid}:{})})+'.'+encode({role:'service_role',exp:Math.floor(Date.now()/1000)+3600});
const serviceKey=unsigned+'.'+createHmac('sha256',Buffer.from(jwk.k,'base64url')).update(unsigned).digest('base64url');
const client=createClient(local.API_URL,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
let mode='normal', resetCalls=0;
const repository=createPrivateSessionRepository({cipher:{encrypt:()=>({}),decrypt:()=>''},rpc:async(name,input)=>{
  if(name==='plannix_auth_reset_orphan_generation') resetCalls++;
  if(name==='plannix_auth_confirm_orphan_reset') {
    if(mode==='confirmation-error') throw Error('synthetic confirmation failure');
    if(mode==='confirmation-timeout') return new Promise(()=>{});
    if(mode==='confirmation-missing') return {data:{state:'unconfirmed'}};
  }
  if(mode==='database-error' && name==='plannix_auth_check_orphan_generation') throw Error('synthetic unavailable');
  const result=await client.rpc(name,input);
  if(result.error) console.log("Synthetic RPC failure",name,result.status,result.error.code);
  if(mode==='confirmation-uncertain' && name==='plannix_auth_confirm_orphan_reset') throw Error('synthetic lost confirmation acknowledgement');
  if(mode==='uncertain' && name==='plannix_auth_reset_orphan_generation') throw Error('synthetic lost commit acknowledgement');
  return result;
}});
const initialBindings=JSON.parse(sql("select coalesce(json_agg(id),'[]'::json) from private.plannix_auth_browser_bindings;"));
const owner='dd000000-0000-4000-8000-000000000097';
assert.equal(sql(`select count(*) from auth.users where id='${owner}';`),'0');
sql(`insert into auth.users(id,email,email_confirmed_at) values('${owner}','reset-http@example.test',now());`);
const key=Buffer.alloc(32,9);
let origin;
const app=express(); const server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
origin=`http://127.0.0.1:${server.address().port}`;
app.use('/auth',createServerSessionRouter({repository,identity:{login:async({password})=>{if(password!=='synthetic-success')throw {kind:'credentials'}; return {user:{id:owner},session:{access_token:'synthetic-access',refresh_token:'synthetic-refresh'}};}},origin,csrfKey:key,limiter:{check:async()=>{}},providerDeadlineMs:3000}));
const cookie=g=>`__Host-plannix-s-${g}=${'a'.repeat(43)}`;
const orphan=()=>sql("select nextval('private.plannix_auth_generation_seq');");
async function request(route,h,body,extra={}){return fetch(origin+'/auth/'+route,{method:body?'POST':'GET',headers:{cookie:h,origin,'content-type':'application/json',...extra},...(body?{body:JSON.stringify(body)}:{})});}
async function offer(h){const r=await request('bootstrap',h);assert.equal(r.status,401);assert.equal(r.headers.get('set-cookie'),null);return (await r.json()).browserResetProof;}
const count=g=>sql(`select count(*) from private.plannix_auth_retired_generations where generation=${g};`);
async function noDelete(r,status){assert.equal(r.status,status);assert.equal(r.headers.get('set-cookie'),null);}
async function until(f,label){const end=Date.now()+4000;while(Date.now()<end){if(f())return;await new Promise(r=>setTimeout(r,20));}throw Error('Missing barrier: '+label);}
function nextNetwork(container){return Object.keys(container.NetworkSettings.Networks)[0];}
async function untilAsync(test,label){const deadline=Date.now()+5000;while(Date.now()<deadline){if(await test())return;await new Promise(r=>setTimeout(r,50));}throw Error('Missing barrier: '+label);}
const children=[];
function held(text){const child=spawn('docker',args,{env:target.env,stdio:['pipe','pipe','pipe']});children.push(child);let out='';child.stdout.on('data',b=>out+=b);child.stderr.resume();const timer=setTimeout(()=>child.kill('SIGKILL'),8000);const done=new Promise(r=>child.once('exit',code=>{clearTimeout(timer);r(code);}));child.stdin.write(text+'\n');return {child,out:()=>out,done};}
try {
  const g=orphan(), h=cookie(g), proof=await offer(h);assert.ok(proof);assert.equal(count(g),'0');
  await noDelete(await request('browser-reset',cookie(orphan()),{proof}),403);
  await noDelete(await request('browser-reset',h,{proof},{origin:'https://other.test'}),403);
  const expired=createBrowserResetProofs({key,origin,now:()=>Date.now()-61000}).issue(orphanContext(h));
  await noDelete(await request('browser-reset',h,{proof:expired}),403);
  const r=await request('browser-reset',h,{proof});assert.equal(r.status,204);
  assert.equal(r.headers.get('set-cookie'),`__Host-plannix-s-${g}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`);
  assert.equal(count(g),'1');await noDelete(await request('browser-reset',h,{proof}),409);
  console.log('HTTP offer is non-retiring; context, origin, expiry, commit and replay checks passed.');

  // Generic/mixed/future rejection and classifier failure never advertise reset.
  for(const c of [cookie('9999999999999999'),h+'; __Host-plannix-b-1='+'b'.repeat(43),h+'; '+h]) assert.equal(await offer(c),undefined);
  mode='database-error';assert.equal(await offer(cookie(orphan())),undefined);mode='normal';
  // A normal bad-password login keeps its existing 401, with no reset proof.
  const boot=await request('bootstrap','');assert.equal(boot.status,200);
  const marker=boot.headers.get('set-cookie').split(';')[0], csrf=(await boot.json()).csrfToken;
  const bad=await request('login',marker,{email:'synthetic@example.test',password:'synthetic-not-real'},{'x-plannix-csrf':csrf});
  assert.equal(bad.status,401);assert.equal((await bad.json()).browserResetProof,undefined);
  console.log('Incorrect password, generic rejection and database failure do not offer reset.');

  // Held uncommitted login reservation: actual begin allocates its generation.
  const markerName=marker.split('=')[0];
  const hash=sql(`select marker_hash from private.plannix_auth_browser_bindings where generation=substring('${markerName}','[0-9]+$')::bigint;`);
  const login=held(`begin; select public.plannix_auth_begin('${markerName}','${hash}','ordinary',null,null);\n\\echo RESERVED`);
  await until(()=>login.out().includes('RESERVED'),'login reservation');
  const reserved=JSON.parse(login.out().split('\n').find(x=>x.startsWith('{'))).generation;
  assert.equal(await offer(cookie(reserved)),undefined);
  // Previously offered proof cannot delete while ANY login writer is admitted.
  const g2=orphan(), h2=cookie(g2);
  const signed=createBrowserResetProofs({key,origin}).issue(orphanContext(h2));
  await noDelete(await request('browser-reset',h2,{proof:signed}),409);
  login.child.stdin.end('commit;\n\\q\n');assert.equal(await login.done,0);
  assert.equal(await offer(cookie(reserved)),undefined);
  console.log('Uncommitted and committed login reservations prevent cleanup.');

  const g3=orphan(), h3=cookie(g3), p3=await offer(h3);mode='uncertain';
  await noDelete(await request('browser-reset',h3,{proof:p3}),503);mode='normal';
  assert.equal(count(g3),'1');await noDelete(await request('browser-reset',h3,{proof:p3}),409);
  console.log('Lost commit acknowledgement sends no cookie deletion and does not retry.');

  // Retirement committed, but confirmation fails/is missing/never completes.
  const baselineMutations=resetCalls;
  for(const failure of ['confirmation-error','confirmation-missing','confirmation-timeout','confirmation-uncertain']) {
    const current=orphan(),currentCookie=cookie(current),currentProof=await offer(currentCookie);
    mode=failure;
    await noDelete(await request('browser-reset',currentCookie,{proof:currentProof}),503);
    mode='normal';assert.equal(count(current),'1');
  }
  assert.equal(resetCalls-baselineMutations,4,'confirmation failures never replay mutation');
  // The cookie remains usable only as reset context, never session authority.
  const recoveryGeneration=orphan(),recoveryCookie=cookie(recoveryGeneration),firstProof=await offer(recoveryCookie);
  mode='confirmation-error';await noDelete(await request('browser-reset',recoveryCookie,{proof:firstProof}),503);mode='normal';
  assert.equal(count(recoveryGeneration),'1');
  const freshProof=await offer(recoveryCookie);assert.ok(freshProof && freshProof!==firstProof);
  const recovered=await request('browser-reset',recoveryCookie,{proof:freshProof});assert.equal(recovered.status,204);
  assert.equal(recovered.headers.get('set-cookie'),`__Host-plannix-s-${recoveryGeneration}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`);
  assert.equal(count(recoveryGeneration),'1');
  console.log('Failed confirmation keeps cookies intact; a later explicit fresh-proof reset safely recovers committed retirement.');

  // Delay AFTER guard acquired its SHARE locks. No production test hooks.
  sql(`create function private.reset_test_delay() returns trigger language plpgsql as $$begin perform pg_sleep(10); return new; end$$;
    create trigger reset_test_delay after insert on private.plannix_auth_retired_generations for each row execute function private.reset_test_delay();`);
  for(const disconnect of [false,true]) {
    const g4=orphan(), h4=cookie(g4), p4=await offer(h4), controller=new AbortController();
    const start=Date.now();
    const pending=fetch(origin+'/auth/browser-reset',{method:'POST',headers:{cookie:h4,origin,'content-type':'application/json'},body:JSON.stringify({proof:p4}),signal:controller.signal}).catch(()=>null);
    await until(()=>Number(sql("select count(*) from pg_locks where relation='private.plannix_auth_sessions'::regclass and mode='ShareLock' and granted;"))>0,'retirement lock');
    if(disconnect)controller.abort();
    const unrelated=repository.issueBinding();
    const result=await pending;if(result)await noDelete(result,503);
    const issued=await unrelated;
    assert.equal(issued.state,'issued');
    const unrelatedCookie=issued.setCookie.split(';')[0];
    const ready=await request('bootstrap',unrelatedCookie);assert.equal(ready.status,200);
    const loggedIn=await request('login',unrelatedCookie,{email:'reset-http@example.test',password:'synthetic-success'},
      {'x-plannix-csrf':(await ready.json()).csrfToken});
    assert.equal(loggedIn.status,200);assert.equal((await loggedIn.json()).authenticated,true);
    assert.equal(sql(`select count(*) from private.plannix_auth_sessions where owner_id='${owner}' and not revoked and not expired;`),disconnect?'2':'1');
    assert.ok(Date.now()-start<4000,'database deadline released unrelated sign-in');
    assert.equal(count(g4),'0');
    assert.equal(sql("select count(*) from pg_locks where relation='private.plannix_auth_sessions'::regclass and mode='ShareLock' and granted;"),'0');
  }
  sql('drop trigger reset_test_delay on private.plannix_auth_retired_generations; drop function private.reset_test_delay();');
  console.log('Real transaction timeout rolls back/releases locks, including after HTTP disconnect; unrelated ordinary HTTP login and database settlement complete.');
  // Function return is NOT commit: transaction-local timer also kills idle work.
  const idleGeneration=orphan();
  const idle=held(`begin; set local role service_role; set local application_name='reset_http_idle';
    select public.plannix_auth_reset_orphan_generation(
      jsonb_build_object('markers','[]'::jsonb,'sessions',jsonb_build_array(jsonb_build_object('name','__Host-plannix-s-${idleGeneration}','hash',repeat('a',64)))),
      repeat('8',64),clock_timestamp()+interval '1 minute');
    \n\\echo RESET_HELD`);
  await until(()=>idle.out().includes('RESET_HELD'),'provisional reset result');
  assert.equal(count(idleGeneration),'0','retirement is uncommitted');
  const idleStart=Date.now(), waiting=repository.issueBinding();
  await until(()=>Number(sql("select count(*) from pg_stat_activity where cardinality(pg_blocking_pids(pid))>0;"))>0,'unrelated binding waits for reset');
  assert.equal((await waiting).state,'issued');
  // psql can still be waiting on stdin after PostgreSQL killed its backend.
  // Ask for commit to observe the terminal failure, never infer from process exit.
  idle.child.stdin.end('commit;\n\\q\n');
  assert.notEqual(await idle.done,0,'database terminates idle transaction');
  assert.ok(Date.now()-idleStart<4000);
  assert.equal(count(idleGeneration),'0');
  console.log('Provisional RPC return cannot retain locks through an idle transaction: deadline rolls back and unblocks issuance.');
  assert.equal(resetCalls,13,'exactly one DB call per admitted reset; no replay');
  const restContainer='supabase_rest_'+project;
  const rest=JSON.parse(spawnSync('docker',[...target.prefix,'inspect',restContainer],{env:target.env,encoding:'utf8'}).stdout)[0];
  const rollbackContainer=project+'-rollback-http';
  const rollbackEnv={...target.env};const forwarded=[];
  for(const entry of rest.Config.Env) {const split=entry.indexOf('=');const name=entry.slice(0,split);
    if(name.startsWith('PGRST_')) {rollbackEnv[name]=entry.slice(split+1);forwarded.push('-e',name);}}
  rollbackEnv.PGRST_DB_TX_END='rollback';
  const start=spawnSync('docker',[...target.prefix,'run','-d','--name',rollbackContainer,
    '--network',nextNetwork(rest),'--publish','127.0.0.1::3000',...forwarded,'-e','PGRST_DB_TX_END',rest.Config.Image],
    {env:rollbackEnv,encoding:'utf8'});
  assert.equal(start.status,0,'disposable rollback gateway start');
  try {
    const details=JSON.parse(spawnSync('docker',[...target.prefix,'inspect',rollbackContainer],{env:target.env,encoding:'utf8'}).stdout)[0];
    const port=details.NetworkSettings.Ports['3000/tcp'][0].HostPort;
    const rollback=createClient('http://127.0.0.1:'+port,serviceKey,{auth:{persistSession:false,autoRefreshToken:false},
      global:{fetch:(url,options)=>fetch(String(url).replace('/rest/v1/','/'),options)}});
    await untilAsync(async()=>{const r=await rollback.rpc('plannix_auth_browser_reset_preflight');return !r.error;},'rollback gateway ready');
    let rollbackMutations=0;
    const rollbackRepository=createPrivateSessionRepository({cipher:{encrypt:()=>({}),decrypt:()=>''},rpc:(name,args)=>{
      if(name==='plannix_auth_reset_orphan_generation') rollbackMutations++;
      return rollback.rpc(name,args);
    }});
    app.use('/rollback',createServerSessionRouter({repository:rollbackRepository,identity:{login:async()=>{}},origin,csrfKey:key,
      limiter:{check:async()=>{}},providerDeadlineMs:3000}));
    const g=orphan(),h=cookie(g),proof=await offer(h);
    await noDelete(await fetch(origin+'/rollback/browser-reset',{method:'POST',headers:{cookie:h,origin,'content-type':'application/json'},body:JSON.stringify({proof})}),503);
    assert.equal(count(g),'0','rollback gateway persisted no retirement');
    const proofHash=createBrowserResetProofs({key,origin}).verify(proof,orphanContext(h)).hash;
    assert.equal(sql(`select count(*) from private.plannix_auth_used_reset_proofs where proof_hash='${proofHash}';`),'0','rollback gateway persisted no proof consumption');
    assert.equal(rollbackMutations,1);
    // Exercise preflight with actual --dump-config output, never print it.
    for(const [container,accepted] of [[restContainer,true],[rollbackContainer,false]]) {
      const config=spawnSync('docker',[...target.prefix,'exec',container,'postgrest','--dump-config'],{env:target.env,encoding:'utf8'});
      assert.equal(config.status,0,'local gateway config unavailable');
      const check=spawnSync(process.execPath,['scripts/check-browser-reset-preflight.js','--local-disposable','--gateway-config','-'],
        {env:{...target.env,SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:serviceKey},input:config.stdout,encoding:'utf8'});
      assert.equal(check.status,accepted?0:1,'preflight gateway mode gate');
      assert.equal(JSON.parse(check.stdout).gatewayAlwaysCommits,accepted);
    }
    console.log('Real rollback-mode gateway: no persisted records, no Set-Cookie; executable gateway/database preflight passes commit and rejects rollback.');
  } finally {
    assert.equal(spawnSync('docker',[...target.prefix,'rm','-f',rollbackContainer],{env:target.env,encoding:'utf8'}).status,0);
  }

} finally {
  for(const child of children)if(child.exitCode===null)child.stdin.end('rollback;\n\\q\n');
  const closed=new Promise(r=>server.close(r));
  server.closeAllConnections();
  await closed;
  // Remove only synthetic bindings created by this run; retirement history stays.
  assert.ok(initialBindings.every(x=>/^[0-9a-f-]{36}$/.test(x)));
  sql(`delete from auth.users where id='${owner}';`);
  sql(`delete from private.plannix_auth_browser_bindings where not (id=any(array[${initialBindings.map(x=>`'${x}'::uuid`).join(',')}]::uuid[]));`);
}
