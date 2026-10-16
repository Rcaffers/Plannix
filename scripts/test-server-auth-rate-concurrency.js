// Run only against an explicitly marked, disposable local PostgreSQL cluster.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createDistributedAuthLimiter } from '../server/auth/distributedAuthLimiter.js';
import { runObservedContention } from './authRateContentionHarness.js';

const socket = process.env.PLANNIX_AUTH_RATE_TEST_SOCKET;
const port = process.env.PLANNIX_AUTH_RATE_TEST_PORT;
const database = process.env.PLANNIX_AUTH_RATE_TEST_DB;
const psql = process.env.PLANNIX_AUTH_RATE_TEST_PSQL || 'psql';
const container = process.env.PLANNIX_AUTH_RATE_TEST_DOCKER_CONTAINER;
const directory = process.env.PLANNIX_AUTH_RATE_TEST_DIRECTORY;
const dockerMode = Boolean(container);
if (dockerMode ? (!/^supabase_db_plannix-rate-stage\.[A-Za-z0-9]+$/.test(container)
  || !directory?.startsWith('/tmp/plannix-rate-stage.')
  || (await readFile(path.join(directory,'disposable-marker'),'utf8').catch(()=>''))
    !== 'plannix-auth-rate-disposable\n')
  : (!socket?.startsWith('/tmp/plannix-rate.') || !/^\d{4,5}$/.test(port || '')
  || !/^limiter_[a-z0-9_]{1,32}$/.test(database || '')
  || (await readFile(path.join(socket,'disposable-marker'),'utf8').catch(()=>''))
    !== 'plannix-auth-rate-disposable\n')) {
  throw new Error('A marked disposable PostgreSQL cluster is required.');
}
function psqlProcess() {
  return dockerMode
    ? spawn('docker',['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1',
      '-U','postgres','-d','postgres','-f','-'],{stdio:['pipe','pipe','pipe']})
    : spawn(psql,['-X','-qAt','-v','ON_ERROR_STOP=1','-h',socket,
      '-p',port,'-d',database,'-f','-'],{stdio:['pipe','pipe','pipe']});
}

function query(sql) {
  return new Promise((resolve,reject)=>{
    const child=psqlProcess();
    let output=''; let error='';
    const timer=setTimeout(()=>child.kill('SIGKILL'),8000);
    child.stdout.on('data',part=>{output+=part;});
    child.stderr.on('data',part=>{error+=part;});
    child.once('error',reject);
    child.once('close',code=>{
      clearTimeout(timer);
      if (code) reject(new Error(`Disposable query failed (${code}): ${error.slice(0,300)}`));
      else resolve(output.trim());
    });
    child.stdin.end(sql);
  });
}

function holdTransaction(sql, marker) {
  const child=psqlProcess();
  let output='';
  let released=false;
  const ready=new Promise((resolve,reject)=>{
    child.stdout.on('data',part=>{output+=part;if(output.includes(marker))resolve();});
    child.once('error',reject);
    child.once('close',code=>{if(!output.includes(marker))reject(new Error(`Holder ended before ${marker} (${code}).`));});
  });
  const done=new Promise((resolve,reject)=>child.once('close',code=>
    code===0?resolve():reject(new Error('Held transaction failed.'))));
  child.stdin.write(sql);
  return { child, ready, done,
    release(command) {
      if (released || child.exitCode!==null || child.stdin.destroyed) return;
      released=true;
      child.stdin.end(`${command};\n`);
    },
    kill() { if (child.exitCode===null) child.kill('SIGKILL'); },
  };
}

async function observeLock(queryPattern, event, minimum=1) {
  // Poll the database's own wait state. The deadline only bounds a broken test;
  // elapsed wall time is not evidence that a lock was acquired.
  const deadline=Date.now()+5000;
  while (Date.now()<deadline) {
    const count=Number(await query(`select count(*) from pg_stat_activity
      where datname=current_database() and pid<>pg_backend_pid()
        and wait_event_type='Lock' and wait_event='${event}'
        and query like '%${queryPattern}%';`));
    if (count>=minimum) return;
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  throw new Error(`Database did not report ${minimum} ${event} lock wait(s).`);
}

const key='b'.repeat(64);
const args=`'[{"key":"${key}","maximum":1}]'::jsonb`;
const limiterKey=Buffer.alloc(32,11);
const keyTag=createHmac('sha256',limiterKey).update('plannix-auth-rate-key-v1').digest('hex');
await query(`select private.plannix_auth_rate_prepare_epoch('${keyTag}');
  update private.plannix_auth_rate_control set paused_at=clock_timestamp()-interval '61 seconds';
  select private.plannix_auth_rate_resume(1);`);
await query(`delete from private.plannix_auth_rate_counters where key_hash='${key}';`);
const sql=`set role service_role;
  select public.plannix_auth_rate_attempt(${args},1,'${keyTag}')->>'allowed';`;
const holder=holdTransaction(`begin; select pg_advisory_xact_lock(hashtextextended('${key}',0));
  select 'held-advisory';\n`,'held-advisory');
await runObservedContention({holder,
  startPending:()=>[query(sql),query(sql)],
  observe:()=>observeLock('plannix_auth_rate_attempt','advisory',2),
  validate:results=>assert.deepEqual(results.sort(),['false','true'],
    'independent database connections must share one atomic limit'),
});
assert.equal(await query(`select attempts from private.plannix_auth_rate_counters
  where key_hash='${key}' order by window_number desc limit 1;`),'2');
const denied=await query(sql);
assert.equal(denied,'false');
const nextKey='c'.repeat(64);
await query(`delete from private.plannix_auth_rate_counters where key_hash='${nextKey}';`);
await query(`insert into private.plannix_auth_rate_counters
  (key_hash,window_number,attempts,expires_at)
  values ('${nextKey}',floor(extract(epoch from clock_timestamp())/60)::bigint-1,
    100,clock_timestamp()+interval '1 minute')
  on conflict (key_hash,window_number) do update set attempts=100;`);
assert.equal(await query(`set role service_role;
  select public.plannix_auth_rate_attempt('[{"key":"${nextKey}","maximum":1}]'::jsonb,1,'${keyTag}')->>'allowed';`),
  'true','an earlier fixed window does not block the current one');
const window=await query(`select max(window_number) from private.plannix_auth_rate_counters
  where key_hash='${key}';`);
assert.ok(/^\d+$/.test(window));
await query(`update private.plannix_auth_rate_counters set expires_at=clock_timestamp()-interval '1 second'
  where key_hash='${key}'; select public.plannix_auth_rate_cleanup(1000);`);
assert.equal(await query(`select count(*) from private.plannix_auth_rate_counters
  where key_hash='${key}';`),'0');

// Construct two independent application limiters. Each RPC opens its own
// database connection; neither instance shares JavaScript counter state.
const createRpc=()=>async(_name,{attempts,expected_epoch,expected_key_tag})=>{
  assert.ok(attempts.every(item=>/^[0-9a-f]{64}$/.test(item.key)
    && Number.isInteger(item.maximum) && item.maximum>=1 && item.maximum<=300));
  const data=await query(`set role service_role;
    select public.plannix_auth_rate_attempt('${JSON.stringify(attempts)}'::jsonb,
      ${expected_epoch},'${expected_key_tag}');`);
  return {data:JSON.parse(data)};
};
const limiters=[0,1].map(()=>createDistributedAuthLimiter({
  rpc:createRpc(),key:limiterKey,epoch:1,
}));
assert.notStrictEqual(limiters[0],limiters[1]);
const seconds=Number(await query('select extract(second from clock_timestamp());'));
if (seconds>=50) await new Promise(resolve=>setTimeout(resolve,(61-seconds)*1000));
const request={socket:{remoteAddress:'127.0.0.1'},headers:{}};
const results=await Promise.allSettled(Array.from({length:7},(_,index)=>
  limiters[index%2].check(request,'deletion')));
assert.equal(results.filter(result=>result.status==='fulfilled').length,6);
assert.equal(results.filter(result=>result.status==='rejected'
  && result.reason?.status===429).length,1);
const networkKey=createHmac('sha256',limiterKey)
  .update(['deletion','network','127.0.0.1'].join('\0')).digest('hex');
assert.equal(await query(`select attempts from private.plannix_auth_rate_counters
  where key_hash='${networkKey}' order by window_number desc limit 1;`),'7');
// A held claim transaction prevents pause from completing. After pause,
// queued claims and old replicas cannot advance any counter.
const heldClaim=holdTransaction(`begin; set local role service_role;
  select public.plannix_auth_rate_attempt('[{"key":"${'d'.repeat(64)}","maximum":1}]'::jsonb,1,'${keyTag}')->>'allowed';
  select 'claim-held';\n`,'claim-held');
await runObservedContention({holder:heldClaim,
  startPending:()=>[query(`select private.plannix_auth_rate_pause() is not null;`)],
  observe:()=>observeLock('plannix_auth_rate_pause','transactionid'),
  validate:([paused])=>assert.equal(paused,'t'),
});
await assert.rejects(limiters[0].check(request,'login'),error=>error.status===503);
const nextLimiterKey=Buffer.alloc(32,12);
const nextTag=createHmac('sha256',nextLimiterKey)
  .update('plannix-auth-rate-key-v1').digest('hex');
assert.equal(await query(`select private.plannix_auth_rate_prepare_epoch('${nextTag}');`),'2');
await query(`update private.plannix_auth_rate_control
  set paused_at=clock_timestamp()-interval '61 seconds';
  select private.plannix_auth_rate_resume(2);`);
await assert.rejects(limiters[1].check(request,'login'),error=>error.status===503);
const nextLimiter=createDistributedAuthLimiter({rpc:createRpc(),key:nextLimiterKey,epoch:2});
await nextLimiter.check(request,'login');
const wronglyUpdatedEpoch=createDistributedAuthLimiter({rpc:createRpc(),key:limiterKey,epoch:2});
await assert.rejects(wronglyUpdatedEpoch.check(request,'login'),error=>error.status===503);
process.stdout.write('Independent limiters and PostgreSQL connections shared the atomic limit; cleanup passed.\n');
