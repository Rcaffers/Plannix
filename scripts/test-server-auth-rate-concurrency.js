// Run only against an explicitly marked, disposable local PostgreSQL cluster.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createDistributedAuthLimiter } from '../server/auth/distributedAuthLimiter.js';

const socket = process.env.PLANNIX_AUTH_RATE_TEST_SOCKET;
const port = process.env.PLANNIX_AUTH_RATE_TEST_PORT;
const database = process.env.PLANNIX_AUTH_RATE_TEST_DB;
const psql = process.env.PLANNIX_AUTH_RATE_TEST_PSQL || 'psql';
if (!socket?.startsWith('/tmp/plannix-rate.') || !/^\d{4,5}$/.test(port || '')
  || !/^limiter_[a-z0-9_]{1,32}$/.test(database || '')
  || (await readFile(path.join(socket,'disposable-marker'),'utf8').catch(()=>''))
    !== 'plannix-auth-rate-disposable\n') {
  throw new Error('A marked disposable PostgreSQL cluster is required.');
}

function query(sql) {
  return new Promise((resolve,reject)=>{
    const child=spawn(psql,['-X','-qAt','-v','ON_ERROR_STOP=1','-h',socket,
      '-p',port,'-d',database,'-f','-'],{stdio:['pipe','pipe','pipe']});
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

const key='b'.repeat(64);
const args=`'[{"key":"${key}","maximum":1}]'::jsonb`;
await query(`delete from private.plannix_auth_rate_counters where key_hash='${key}';`);
const sql=`set role service_role;
  select public.plannix_auth_rate_attempt(${args})->>'allowed';`;
const holder=spawn(psql,['-X','-qAt','-v','ON_ERROR_STOP=1','-h',socket,
  '-p',port,'-d',database,'-f','-'],{stdio:['pipe','pipe','pipe']});
let holderOutput='';
const held=new Promise((resolve,reject)=>{
  holder.stdout.on('data',part=>{
    holderOutput+=part;
    if (holderOutput.includes('held')) resolve();
  });
  holder.once('error',reject);
  holder.once('close',code=>{if(code)reject(new Error('Lock holder failed.'));});
});
const holderDone=new Promise((resolve,reject)=>holder.once('close',code=>
  code===0?resolve():reject(new Error('Lock holder failed.'))));
holder.stdin.end(`begin; select pg_advisory_xact_lock(hashtextextended('${key}',0));
  select 'held'; select pg_sleep(0.8); commit;`);
try {
  await held;
  const started=Date.now();
  const results=await Promise.all([query(sql),query(sql)]);
  assert.ok(Date.now()-started>=500,'claims waited behind a real database lock');
  assert.deepEqual(results.sort(),['false','true'],
    'independent database connections must share one atomic limit');
  await holderDone;
} finally { if (holder.exitCode===null) holder.kill('SIGKILL'); }
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
  select public.plannix_auth_rate_attempt('[{"key":"${nextKey}","maximum":1}]'::jsonb)->>'allowed';`),
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
const limiterKey=Buffer.alloc(32,11);
const createRpc=()=>async(_name,{attempts})=>{
  assert.ok(attempts.every(item=>/^[0-9a-f]{64}$/.test(item.key)
    && Number.isInteger(item.maximum) && item.maximum>=1 && item.maximum<=300));
  const data=await query(`set role service_role;
    select public.plannix_auth_rate_attempt('${JSON.stringify(attempts)}'::jsonb);`);
  return {data:JSON.parse(data)};
};
const limiters=[0,1].map(()=>createDistributedAuthLimiter({
  rpc:createRpc(),key:limiterKey,
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
process.stdout.write('Independent limiters and PostgreSQL connections shared the atomic limit; cleanup passed.\n');
