// Real lock barriers on a new unlinked local Supabase stack, never production.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { verifyLocalDocker } from './test-academic-year-migration.js';
import { createPrivateSessionRepository } from '../server/auth/privateSessionRepository.js';
import { createServerSessionTestApp } from '../server/auth/serverSessionTestApp.js';

const [project,workdir] = process.argv.slice(2);
assert.match(project || '',/^plannix-bootstrap-review-[a-z0-9]+$/);
assert.ok(workdir && path.basename(workdir).startsWith('plannix-bootstrap-review-'));
assert.equal(existsSync(path.join(workdir,'supabase/.temp/project-ref')),false,'linked targets are forbidden');
const target=verifyLocalDocker({project,workdir});
const args=[...target.prefix,'exec','-i',target.containerId,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'];
function query(sql) {
  const result=spawnSync('docker',args,{input:sql,encoding:'utf8',env:target.env,timeout:10000});
  assert.equal(result.status,0,'disposable SQL query failed');
  return result.stdout.trim();
}
assert.equal(query('select count(*) from auth.users;'),'0','target must be empty');
assert.equal(query('select count(*) from private.plannix_auth_browser_bindings;'),'0','target must be empty');
const owner='dd000000-0000-4000-8000-000000000094';
const generatedBindings=new Set();
const rememberBinding=cookie=>{
  const match=cookie.split('=')[0].match(/^__Host-plannix-b-([1-9][0-9]{0,15})$/);
  assert.ok(match,'synthetic binding name is invalid');generatedBindings.add(match[1]);
};
const connections=new Set();
const waitFor=async(predicate,label)=>{
  const deadline=Date.now()+8000;
  while(Date.now()<deadline){if(await predicate())return;await new Promise(r=>setTimeout(r,20));}
  throw Error(`${label} was not observed`);
};
function connection() {
  const child=spawn('docker',args,{env:target.env,stdio:['pipe','pipe','pipe']});
  connections.add(child);
  let stdout='',stderr='';
  child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
  const timer=setTimeout(()=>child.kill('SIGKILL'),15000);
  const done=new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('exit',code=>{clearTimeout(timer);connections.delete(child);resolve({code,stdout,stderr});});
  });
  return {send:sql=>child.stdin.write(sql+'\n'),output:()=>stdout,done};
}
try {
  query(`insert into auth.users(id,email,email_confirmed_at) values ('${owner}','bootstrap-lock@example.test',now());`);
  for(const scenario of ['state-rechecked','cleanup','timeout']) {
    query(`insert into private.plannix_auth_browser_bindings(marker_hash,expires_at) values (repeat('e',64),now()-interval '1 hour');
      insert into private.plannix_auth_sessions(id,generation,binding_id,kind,owner_id,secret_hash,access_envelope,refresh_envelope,expires_at)
      select gen_random_uuid(),nextval('private.plannix_auth_generation_seq'),id,'ordinary','${owner}',repeat('f',64),'{}','{}',now()+interval '1 day'
      from private.plannix_auth_browser_bindings where marker_hash=repeat('e',64);`);
    const candidate=query(`select jsonb_build_object('markers','[]'::jsonb,'sessions',jsonb_build_array(jsonb_build_object('name','__Host-plannix-s-'||generation,'hash',secret_hash)))
      from private.plannix_auth_sessions where owner_id='${owner}';`);
    const holder=connection();
    holder.send(`begin; set local application_name='bootstrap_review_holder'; select id from private.plannix_auth_browser_bindings where marker_hash=repeat('e',64) for update;\n\\echo HELD`);
    await waitFor(()=>holder.output().includes('HELD'),'binding-lock acknowledgement');
    const waiter=connection();
    waiter.send(`set application_name='bootstrap_review_waiter'; select public.plannix_auth_select_bootstrap('${candidate.replaceAll("'","''")}'::jsonb);\n\\q`);
    await waitFor(()=>query("select exists(select 1 from pg_stat_activity where application_name='bootstrap_review_waiter' and cardinality(pg_blocking_pids(pid))>0);")==='t','real database lock wait');
    if(scenario==='timeout') {
      const result=await waiter.done;
      assert.notEqual(result.code,0);assert.match(result.stderr,/55P03/,'lock timeout must fail closed');
      holder.send('rollback;\n\\q');assert.equal((await holder.done).code,0);
      assert.equal(query("select count(*) from private.plannix_auth_browser_bindings where revoked or expired;"),'0','failed selector changes no state');
    } else {
      holder.send(scenario==='cleanup'
        ? "delete from private.plannix_auth_browser_bindings where marker_hash=repeat('e',64); commit;\n\\q"
        : "update private.plannix_auth_browser_bindings set expires_at=now()+interval '1 day' where marker_hash=repeat('e',64); commit;\n\\q");
      assert.equal((await holder.done).code,0);
      const result=await waiter.done;assert.equal(result.code,0);
      const outcome=JSON.parse(result.stdout.split('\n').find(line=>line.startsWith('{')));
      assert.equal(outcome.state,'invalid');assert.equal(outcome.cleanup,undefined,'stale result cannot issue cleanup');
      assert.equal(query(`select count(*) from private.plannix_auth_sessions where owner_id='${owner}';`),scenario==='cleanup'?'0':'1');
    }
    query("delete from private.plannix_auth_browser_bindings where marker_hash=repeat('e',64);");
    console.log(`Bootstrap lock-observed ${scenario}: passed.`);
  }
  const allowed=new Set(['plannix_auth_issue_binding','plannix_auth_select','plannix_auth_select_bootstrap',
    'plannix_auth_begin','plannix_auth_settle','plannix_auth_inspect']);
  const literal=value=>value==null?'null':typeof value==='object'
    ? `'${JSON.stringify(value).replaceAll("'","''")}'::jsonb` : `'${String(value).replaceAll("'","''")}'`;
  const repository=createPrivateSessionRepository({
    rpc:async(name,parameters)=>{
      assert.ok(allowed.has(name));
      const named=Object.entries(parameters).map(([key,value])=>{
        assert.match(key,/^[a-z_]+$/);return `${key}=>${literal(value)}`;
      }).join(',');
      return {data:JSON.parse(query(`begin;set local role service_role;select public.${name}(${named});commit;`))};
    },
    cipher:{encrypt:({token})=>({synthetic:true,token}),decrypt:({envelope})=>envelope.token},
  });
  const marker=(await repository.issueBinding()).setCookie.split(';')[0];
  rememberBinding(marker);
  const intent=await repository.begin(marker,'ordinary');
  const orphan=(await repository.settle(intent.intentId,'created',{
    confirmedOwnerId:owner,accessToken:'synthetic-access',refreshToken:'synthetic-refresh',
  })).setCookie.split(';')[0];
  query(`update private.plannix_auth_browser_bindings set expires_at=now()-interval '1 hour' where generation=${[...generatedBindings].at(-1)};`);
  const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const origin=`http://127.0.0.1:${port}`;let providerCalls=0;
  const app=createServerSessionTestApp({origin,repository,csrfKey:Buffer.alloc(32,1),identity:{
    login:async()=>{providerCalls++;return {user:{id:owner},session:{access_token:'synthetic-access',refresh_token:'synthetic-refresh'}};},
    validateAccess:async()=>({id:owner}),
  }});
  const server=app.listen(port,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const request=(route,options={})=>fetch(origin+'/__stage3/auth'+route,{...options,signal:AbortSignal.timeout(5000)});
  try {
    const terminal=await request('/bootstrap',{headers:{Cookie:orphan}});
    assert.equal(terminal.status,409);assert.equal(terminal.headers.get('X-Plannix-Bootstrap-Outcome'),'expired-context');
    assert.equal((await terminal.json()).csrfToken,undefined);
    assert.equal(terminal.headers.getSetCookie().length,1);
    assert.ok(terminal.headers.getSetCookie().every(cookie=>cookie.includes('Max-Age=0')));
    assert.equal(providerCalls,0,'terminal recovery never calls provider');
    const fresh=await request('/bootstrap');assert.equal(fresh.status,200);
    const {csrfToken}=await fresh.json();const freshCookie=fresh.headers.getSetCookie()[0].split(';')[0];
    rememberBinding(freshCookie);
    assert.equal((await repository.resolve(freshCookie)).sessionName,null,'fresh context is anonymous');
    const signedOut=await request('/status',{headers:{Cookie:freshCookie}});
    assert.equal(signedOut.status,200);assert.equal((await signedOut.json()).authenticated,false);
    const loginOptions={method:'POST',headers:{Origin:origin,Cookie:freshCookie,
      'Content-Type':'application/json','X-Plannix-CSRF':csrfToken},
      body:JSON.stringify({email:'bootstrap-lock@example.test',password:'synthetic-password'})};
    assert.equal((await request('/login',{...loginOptions,headers:{...loginOptions.headers,'X-Plannix-CSRF':'x'.repeat(43)}})).status,403);
    assert.equal(providerCalls,0);
    assert.equal((await request('/login',loginOptions)).status,200);assert.equal(providerCalls,1);
    console.log('Database-backed HTTP cleanup, anonymous bootstrap, CSRF rejection and one explicit login: passed.');
  } finally {await new Promise(resolve=>server.close(resolve));}
} finally {
  await Promise.all([...connections].map(child=>new Promise((resolve,reject)=>{
    if(child.exitCode!==null || child.signalCode!==null)return resolve();
    const timer=setTimeout(()=>reject(Error('Disposable client did not terminate')),5000);
    child.once('exit',()=>{clearTimeout(timer);resolve();});
    child.kill('SIGKILL');
  })));
  query(`delete from auth.users where id='${owner}';delete from private.plannix_auth_browser_bindings
    where marker_hash=repeat('e',64) or generation in (${[...generatedBindings].join(',') || '0'});`);
}
