// Synthetic, disposable-only database tests. No HTTP/cookie integration yet.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {verifyLocalDocker} from './test-academic-year-migration.js';
const [project,workdir]=process.argv.slice(2);
assert.match(project||'',/^plannix-reset-guard-[a-z0-9_-]+$/);
assert.ok(workdir && path.basename(workdir)===project);
assert.equal(existsSync(path.join(workdir,'supabase/.temp/project-ref')),false);
const target=verifyLocalDocker({project,workdir});
const args=[...target.prefix,'exec','-i',target.containerId,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'];
function query(sql){const r=spawnSync('docker',args,{input:sql,encoding:'utf8',env:target.env,timeout:10000});assert.equal(r.status,0,'disposable SQL failed');return r.stdout.trim();}
assert.equal(query('select count(*) from auth.users;'),'0');
assert.equal(query('select count(*) from private.plannix_auth_browser_bindings;'),'0');
assert.equal(query('select count(*) from private.plannix_auth_retired_generations;'),'0');
const children=new Set();
function connection(){
 const child=spawn('docker',args,{env:target.env,stdio:['pipe','pipe','pipe']});children.add(child);
 let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 const timer=setTimeout(()=>child.kill('SIGKILL'),15000);
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);children.delete(child);resolve({code,stdout,stderr});});});
 return {send:sql=>child.stdin.write(sql+'\n'),output:()=>stdout,done};
}
async function until(test,label){const deadline=Date.now()+7000;while(Date.now()<deadline){if(test())return;await new Promise(r=>setTimeout(r,20));}throw Error('Missing barrier: '+label);}
const owner='dd000000-0000-4000-8000-000000000096';
const candidate=g=>`jsonb_build_object('markers','[]'::jsonb,'sessions',jsonb_build_array(jsonb_build_object('name','__Host-plannix-s-${g}','hash',repeat('a',64))))`;
const guard=g=>`public.plannix_auth_retire_orphan_generation(${candidate(g)})`;
const state=g=>JSON.parse(query(`select ${guard(g)};`)).state;
function marker(char){return JSON.parse(query(`select public.plannix_auth_issue_binding(repeat('${char}',64));`));}
function begin(m,char){return `public.plannix_auth_begin('${m.name}',repeat('${char}',64),'ordinary')`;}
function settle(id,char){return `public.plannix_auth_settle('${id}','created','${owner}',repeat('${char}',64),'{}','{}')`;}
function result(c){const lines=c.stdout.split('\n').filter(l=>l.startsWith('{'));assert.equal(lines.length,1);return JSON.parse(lines[0]);}
try{
 query(`insert into auth.users(id,email,email_confirmed_at) values('${owner}','retirement-race@example.test',now());`);
 // Login reserves first, but its transaction is deliberately uncommitted.
 const a=marker('a'), holder=connection();
 holder.send(`begin;set local application_name='retirement_login_first';select ${begin(a,'a')};\n\\echo RESERVED`);
 await until(()=>holder.output().includes('RESERVED'),'uncommitted reservation acknowledgement');
 const intent=JSON.parse(holder.output().split('\n').find(l=>l.startsWith('{')));
 assert.equal(query(`select count(*) from private.plannix_auth_transitions where id='${intent.intentId}';`),'0','uncommitted reservation is invisible');
 assert.equal(query("select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='retirement_login_first' and l.relation='private.plannix_auth_transitions'::regclass and l.mode='RowExclusiveLock' and l.granted);"),'t','actual insert lock observed');
 assert.equal(state(intent.generation),'unavailable','guard does not mistake invisible reservation for absence');
 assert.equal(query('select count(*) from private.plannix_auth_retired_generations;'),'0');
 holder.send('commit;\n\\q');assert.equal((await holder.done).code,0);
 assert.equal(state(intent.generation),'ineligible','committed reservation remains protected');
 assert.equal(JSON.parse(query(`select ${settle(intent.intentId,'b')};`)).state,'created');
 assert.equal(state(intent.generation),'ineligible','created session remains protected');
 console.log('Login reserves before reset: uncommitted lock, committed reservation and session protected.');
 // A legitimate old session is pruned. A different binding starts the next login.
 query(`delete from private.plannix_auth_sessions where id='${intent.intentId}';delete from private.plannix_auth_transitions where id='${intent.intentId}';`);
 const staleSnapshot=connection();staleSnapshot.send("begin isolation level repeatable read;select count(*) from private.plannix_auth_retired_generations;\n\\echo SNAPSHOT_HELD");
 await until(()=>staleSnapshot.output().includes('SNAPSHOT_HELD'),'pre-retirement repeatable-read snapshot');
 const b=marker('c'), reset=connection();
 reset.send(`begin;set local application_name='retirement_reset_first';select ${guard(intent.generation)};\n\\echo RETIRED_HELD`);
 await until(()=>reset.output().includes('RETIRED_HELD'),'retirement transaction acknowledgement');
 assert.equal(JSON.parse(reset.output().split('\n').find(l=>l.startsWith('{'))).state,'retired');
 const login=connection();login.send(`set application_name='retirement_login_waiter';select ${begin(b,'c')};\n\\q`);
 await until(()=>query("select exists(select 1 from pg_stat_activity where application_name='retirement_login_waiter' and cardinality(pg_blocking_pids(pid))>0);")==='t','login blocked on real retirement table lock');
 const sameName=connection();sameName.send(`set application_name='retirement_same_name_waiter';insert into private.plannix_auth_transitions(binding_id,generation,kind,expires_at) select id,${intent.generation},'ordinary',now()+interval '2 minutes' from private.plannix_auth_browser_bindings where generation=${b.generation};\n\\q`);
 await until(()=>query("select exists(select 1 from pg_stat_activity where application_name='retirement_same_name_waiter' and cardinality(pg_blocking_pids(pid))>0);")==='t','same-name writer blocked behind retirement');
 reset.send('commit;\n\\q');assert.equal((await reset.done).code,0);
 const sameNameDone=await sameName.done;assert.notEqual(sameNameDone.code,0);assert.match(sameNameDone.stderr,/P2010/,'blocked writer must see committed retirement, not its pre-lock snapshot');
 const loginDone=await login.done;assert.equal(loginDone.code,0);const next=result(loginDone);assert.equal(next.state,'started');assert.ok(BigInt(next.generation)>BigInt(intent.generation));
 assert.equal(JSON.parse(query(`select ${settle(next.intentId,'d')};`)).state,'created');
 assert.equal(query(`select exists(select 1 from private.plannix_auth_sessions s join private.plannix_auth_browser_bindings b on b.current_session_id=s.id where s.id='${next.intentId}' and not s.revoked and not s.expired);`),'t');
 assert.equal(query(`select count(*) from private.plannix_auth_retired_generations where generation=${intent.generation};`),'1');
 assert.equal(state(next.generation),'ineligible');
 console.log('Reset before concurrent login: lock wait observed, newer login completes with a different non-retired generation.');
 // Explicit/cached-generation insertion begun AFTER retirement must also fail.
 const late=connection();late.send(`begin;insert into private.plannix_auth_sessions(id,binding_id,generation,owner_id,kind,secret_hash,access_envelope,refresh_envelope,expires_at) select gen_random_uuid(),id,${intent.generation},'${owner}','ordinary',repeat('e',64),'{}','{}',now()+interval '1 day' from private.plannix_auth_browser_bindings where generation=${b.generation};\n\\q`);
 const lateDone=await late.done;assert.notEqual(lateDone.code,0);assert.match(lateDone.stderr,/P2010/);
 assert.equal(query(`select count(*) from private.plannix_auth_sessions where generation=${intent.generation};`),'0');
 staleSnapshot.send(`insert into private.plannix_auth_transitions(binding_id,generation,kind,expires_at) select id,${intent.generation},'ordinary',now()+interval '2 minutes' from private.plannix_auth_browser_bindings where generation=${a.generation};\n\\q`);
 const staleDone=await staleSnapshot.done;assert.notEqual(staleDone.code,0);assert.match(staleDone.stderr,/P2011/,'pre-retirement snapshot must not bypass permanent fence');
 console.log('Late same-name issuance rejected by permanent database fence; newer current session unchanged.');
 // Rollback cannot produce a durable eligibility result; caller must await commit.
 const abandoned=JSON.parse(query(`select ${begin(b,'c')};`));const g=abandoned.generation;
 query(`delete from private.plannix_auth_transitions where id='${abandoned.intentId}';`);
 assert.equal(JSON.parse(query(`begin;select ${guard(g)};rollback;`)).state,'retired');
 assert.equal(query(`select count(*) from private.plannix_auth_retired_generations where generation=${g};`),'0');
 assert.equal(state(g),'retired');
 const snapshot=JSON.parse(query(`begin isolation level repeatable read;select ${guard(g)};rollback;`));assert.equal(snapshot.state,'ineligible');
 console.log('Retirement rollback and non-current transaction snapshots fail closed.');
 // A held settlement must not be retired, even though its session is invisible.
 const c=marker('f'), pending=JSON.parse(query(`select ${begin(c,'f')};`));const settling=connection();
 settling.send(`begin;set local application_name='retirement_settlement';select ${settle(pending.intentId,'1')};\n\\echo SETTLED_HELD`);
 await until(()=>settling.output().includes('SETTLED_HELD'),'uncommitted settlement acknowledgement');
 assert.equal(query(`select count(*) from private.plannix_auth_sessions where id='${pending.intentId}';`),'0');assert.equal(state(pending.generation),'unavailable');
 settling.send('commit;\n\\q');assert.equal((await settling.done).code,0);assert.equal(state(pending.generation),'ineligible');
 assert.equal(query(`select count(*) from private.plannix_auth_retired_generations where generation=${pending.generation};`),'0');
 assert.equal(query('select count(*) from private.plannix_auth_sessions s join private.plannix_auth_retired_generations r using(generation);'),'0');
 console.log('Held settlement remains protected and reaches a verified terminal commit.');
 // NOWAIT failures must release earlier table locks, even in an open transaction.
 const locked=connection();locked.send("begin;lock table private.plannix_auth_sessions in row exclusive mode;\n\\echo SESSION_LOCKED");await until(()=>locked.output().includes('SESSION_LOCKED'),'session lock');
 const failed=connection();failed.send(`begin;set local application_name='retirement_unavailable';select ${guard(intent.generation)};\n\\echo FAILED_HELD`);await until(()=>failed.output().includes('FAILED_HELD'),'unavailable acknowledgement');
 assert.equal(JSON.parse(failed.output().split('\n').find(l=>l.startsWith('{'))).state,'unavailable');
 assert.equal(query("select count(*) from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='retirement_unavailable' and l.mode='ShareLock' and l.relation in('private.plannix_auth_browser_bindings'::regclass,'private.plannix_auth_transitions'::regclass,'private.plannix_auth_sessions'::regclass);"),'0');
 failed.send('rollback;\n\\q');locked.send('rollback;\n\\q');assert.equal((await failed.done).code,0);assert.equal((await locked.done).code,0);
 console.log('Contention releases all previously acquired guard table locks.');
}finally{
 for(const child of children)child.kill('SIGKILL');
 // Only synthetic fixtures created above; permanent retirement rows deliberately
 // remain until the entire disposable stack is destroyed (never pruned).
 query(`delete from private.plannix_auth_browser_bindings;delete from auth.users where id='${owner}';`);
}
