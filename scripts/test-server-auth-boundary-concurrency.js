// Genuine, bounded refresh-claim race on a verified disposable local database.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const run=promisify(execFile);
const database=process.argv[2];
if(!/^auth_stage3_[a-z0-9_]+$/.test(database || ''))throw Error('Disposable Stage 3 database required.');
for(const name of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_CONFIG']) {
  if(process.env[name])throw Error('Docker connection overrides are forbidden.');
}
const container='supabase_db_Plannix';
const docker=async args=>(await run('docker',args,{timeout:9000,maxBuffer:65536})).stdout.trim();
if(await docker(['context','show'])!=='desktop-linux'
  || await docker(['inspect','--format','{{.Name}} {{.State.Running}}',container])!==`/${container} true`)
  throw Error('Verified local container required.');
const query=sql=>docker(['exec',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1',
  '-U','postgres','-d',database,'-c',sql]);
if(await query('select count(*) from auth.users')!=='0')throw Error('Disposable database must have no users.');
const fixtureUser='dd000000-0000-4000-8000-000000000088';
const active=new Set();
function connection(name) {
  const child=spawn('docker',['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1',
    '-U','postgres','-d',database],{stdio:['pipe','pipe','pipe']});
  let output='';let stderr='';let closed=false;
  const timeout=setTimeout(()=>child.kill('SIGKILL'),16000);
  child.stdout.on('data',chunk=>{output+=chunk;});
  child.stderr.on('data',chunk=>{stderr+=chunk;});
  const finished=new Promise(resolve=>child.once('close',code=>{
    clearTimeout(timeout);closed=true;resolve(code);
  }));
  const wait=async token=>{
    const until=Date.now()+7000;
    while(!output.includes(token) && !closed && Date.now()<until)
      await new Promise(resolve=>setTimeout(resolve,25));
    assert.ok(output.includes(token),`${name} missed barrier`);
  };
  const session={send:sql=>child.stdin.write(sql),wait,finished,
    output:()=>output,stderr:()=>stderr,
    stop:()=>{if(!closed)child.kill('SIGKILL');child.stdin.end();}};
  active.add(session);finished.finally(()=>active.delete(session));
  return session;
}
try {
  await query(`insert into auth.users(id,email,email_confirmed_at)
    values ('${fixtureUser}','stage3-concurrency@example.test',pg_catalog.now())`);
  const marker=await query(`select public.plannix_auth_issue_binding(repeat('a',64))->>'name'`);
  assert.match(marker,/^__Host-plannix-b-[1-9][0-9]*$/);
  const intent=await query(`select public.plannix_auth_begin('${marker}',repeat('a',64),'ordinary')->>'intentId'`);
  assert.equal(await query(`select public.plannix_auth_settle('${intent}','created','${fixtureUser}',
    repeat('b',64),'{}','{}')->>'state'`),'created');
  const sessionName=await query(`select '__Host-plannix-s-' || generation
    from private.plannix_auth_sessions where secret_hash=repeat('b',64)`);
  for(const [suffix,first,second,expectedFirst,expectedSecond] of [
    ['c','cancel','claim','cancelled','invalid'],
    ['d','claim','cancel','claimed','claimed'],
  ]) {
    const stateHash=suffix.repeat(64);
    const parentIntent=await query(`select public.plannix_auth_begin('${marker}',
      repeat('a',64),'recovery','${sessionName}',repeat('b',64))->>'intentId'`);
    assert.match(parentIntent,/^[0-9a-f-]{36}$/);
    assert.equal(await query(`select public.plannix_auth_reserve_callback('${marker}',
      repeat('a',64),'${stateHash}','recovery','${parentIntent}'::uuid)->>'state'`),'reserved');
    assert.equal(await query(`select public.plannix_auth_attach_callback('${marker}',
      repeat('a',64),'${stateHash}','recovery',repeat('e',32),'{}')->>'state'`),'attached');
    assert.equal(await query(`select public.plannix_auth_ready_callback('${marker}',
      repeat('a',64),'${stateHash}','recovery')->>'state'`),'ready');
    const cancel=`select public.plannix_auth_cancel_callback('${marker}',repeat('a',64),
      '${stateHash}','recovery')->>'state';`;
    const claim=`select public.plannix_auth_claim_callback('${marker}',repeat('a',64),
      '${stateHash}',repeat('e',32),'recovery','${sessionName}',repeat('b',64))->>'state';`;
    const leftName=`auth_stage3_callback_${suffix}_a_${process.pid}`;
    const rightName=`auth_stage3_callback_${suffix}_b_${process.pid}`;
    const left=connection(leftName);const right=connection(rightName);
    try {
      left.send(`begin;set local application_name='${leftName}';set local role service_role;
        set local statement_timeout='12s';set local lock_timeout='10s';${first==='cancel'?cancel:claim}
        \\echo LEFT_HOLD\n`);
      await left.wait('LEFT_HOLD');
      right.send(`begin;set local application_name='${rightName}';set local role service_role;
        set local statement_timeout='12s';set local lock_timeout='10s';${second==='cancel'?cancel:claim}
        \\echo RIGHT_DONE\n`);
      let evidence='';const until=Date.now()+7000;
      while(Date.now()<until){
        evidence=await query(`select wait_event_type || ':' || wait_event || ':' ||
          array_length(pg_catalog.pg_blocking_pids(pid),1)::text from pg_stat_activity
          where application_name='${rightName}' and wait_event_type='Lock'`);
        if(/^Lock:[^:]+:[1-9][0-9]*$/.test(evidence))break;
        await new Promise(resolve=>setTimeout(resolve,25));
      }
      assert.match(evidence,/^Lock:[^:]+:[1-9][0-9]*$/,'callback operation truly blocked');
      left.send('commit;\n\\echo LEFT_COMMITTED\n');await left.wait('LEFT_COMMITTED');
      right.send('commit;\n\\echo RIGHT_COMMITTED\n');await right.wait('RIGHT_COMMITTED');
      left.send('\\q\n');right.send('\\q\n');
      assert.equal(await left.finished,0,left.stderr());
      assert.equal(await right.finished,0,right.stderr());
      assert.match(left.output(),new RegExp(expectedFirst));
      assert.match(right.output(),new RegExp(expectedSecond));
      const final=await query(`select (cancelled_at is not null)::text || ':' ||
        (consumed_at is not null)::text from private.plannix_auth_callbacks
        where state_hash='${stateHash}'`);
      assert.equal(final,first==='cancel'?'true:false':'false:true');
      console.log(`Stage 3 callback ${first}/${second}: ${evidence}; final ${final}.`);
    } finally {left.stop();right.stop();}
  }
  for(const [suffix,first,expectedClaim] of [
    ['6','login','invalid'],['7','claim','claimed'],
  ]) {
    const stateHash=suffix.repeat(64);
    const parent=await query(`select public.plannix_auth_begin('${marker}',repeat('a',64),
      'ordinary','${sessionName}',repeat('b',64))->>'intentId'`);
    assert.match(parent,/^[0-9a-f-]{36}$/);
    assert.equal(await query(`select public.plannix_auth_reserve_callback('${marker}',
      repeat('a',64),'${stateHash}','confirmation','${parent}'::uuid)->>'state'`),'reserved');
    assert.equal(await query(`select public.plannix_auth_attach_callback('${marker}',
      repeat('a',64),'${stateHash}','confirmation',repeat('e',32),'{}')->>'state'`),'attached');
    assert.equal(await query(`select public.plannix_auth_ready_callback('${marker}',
      repeat('a',64),'${stateHash}','confirmation')->>'state'`),'ready');
    const login=`select public.plannix_auth_begin('${marker}',repeat('a',64),
      'ordinary','${sessionName}',repeat('b',64))->>'state';`;
    const claim=`select coalesce(result->>'state','') || ':' ||
      coalesce(result->>'intentId','') from (select public.plannix_auth_claim_callback(
      '${marker}',repeat('a',64),'${stateHash}',repeat('e',32),'confirmation',
      '${sessionName}',repeat('b',64)) as result) as claim_result;`;
    const leftName=`auth_stage3_order_${suffix}_a_${process.pid}`;
    const rightName=`auth_stage3_order_${suffix}_b_${process.pid}`;
    const left=connection(leftName);const right=connection(rightName);
    try {
      left.send(`begin;set local application_name='${leftName}';set local role service_role;
        set local statement_timeout='12s';set local lock_timeout='10s';${first==='login'?login:claim}
        \\echo LEFT_HOLD\n`);
      await left.wait('LEFT_HOLD');
      right.send(`begin;set local application_name='${rightName}';set local role service_role;
        set local statement_timeout='12s';set local lock_timeout='10s';${first==='login'?claim:login}
        \\echo RIGHT_DONE\n`);
      let evidence='';const until=Date.now()+7000;
      while(Date.now()<until){
        evidence=await query(`select wait_event_type || ':' || wait_event || ':' ||
          array_length(pg_catalog.pg_blocking_pids(pid),1)::text from pg_stat_activity
          where application_name='${rightName}' and wait_event_type='Lock'`);
        if(/^Lock:[^:]+:[1-9][0-9]*$/.test(evidence))break;
        await new Promise(resolve=>setTimeout(resolve,25));
      }
      assert.match(evidence,/^Lock:[^:]+:[1-9][0-9]*$/,'new login/callback contention observed');
      left.send('commit;\n\\echo LEFT_COMMITTED\n');await left.wait('LEFT_COMMITTED');
      right.send('commit;\n\\echo RIGHT_COMMITTED\n');await right.wait('RIGHT_COMMITTED');
      left.send('\\q\n');right.send('\\q\n');
      assert.equal(await left.finished,0,left.stderr());
      assert.equal(await right.finished,0,right.stderr());
      const claimOutput=first==='login'?right.output():left.output();
      assert.match(claimOutput,new RegExp(`${expectedClaim}:`));
      if(first==='claim') {
        const child=claimOutput.match(/claimed:([0-9a-f-]{36})/)[1];
        assert.equal(await query(`select public.plannix_auth_settle('${child}'::uuid,'created',
          '${fixtureUser}',repeat('f',64),'{}','{}')->>'state'`),'superseded');
      }
      assert.equal(await query(`select count(*) from private.plannix_auth_sessions
        where binding_id=(select id from private.plannix_auth_browser_bindings
          where marker_hash=repeat('a',64))`),'1');
      console.log(`Stage 3 ${first}-first callback race: ${evidence}; ${expectedClaim}; prior session intact.`);
    } finally {left.stop();right.stop();}
  }
  const sql=`select public.plannix_auth_claim_refresh('${marker}',repeat('a',64),
    '${sessionName}',repeat('b',64),1)->>'state';`;
  const aName=`auth_stage3_claim_a_${process.pid}`;
  const bName=`auth_stage3_claim_b_${process.pid}`;
  const a=connection(aName);const b=connection(bName);
  try {
    a.send(`begin;set local application_name='${aName}';set local role service_role;
      set local statement_timeout='12s';set local lock_timeout='10s';${sql}\n\\echo A_HOLD\n`);
    await a.wait('A_HOLD');
    b.send(`begin;set local application_name='${bName}';set local role service_role;
      set local statement_timeout='12s';set local lock_timeout='10s';${sql}\n\\echo B_DONE\n`);
    let evidence='';const until=Date.now()+7000;
    while(Date.now()<until){
      evidence=await query(`select wait_event_type || ':' || wait_event || ':' ||
        array_length(pg_catalog.pg_blocking_pids(pid),1)::text from pg_stat_activity
        where application_name='${bName}' and wait_event_type='Lock'`);
      if(/^Lock:[^:]+:[1-9][0-9]*$/.test(evidence))break;
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    assert.match(evidence,/^Lock:[^:]+:[1-9][0-9]*$/,'second claim truly blocked');
    a.send('commit;\n\\echo A_COMMITTED\n');await a.wait('A_COMMITTED');
    b.send('commit;\n\\echo B_COMMITTED\n');await b.wait('B_COMMITTED');
    a.send('\\q\n');b.send('\\q\n');
    assert.equal(await a.finished,0,a.stderr());
    assert.equal(await b.finished,0,b.stderr());
    assert.match(a.output(),/claimed/);assert.match(b.output(),/busy/);
    assert.equal(await query(`select token_version from private.plannix_auth_sessions
      where secret_hash=repeat('b',64)`),'1');
    console.log(`Stage 3 refresh claim: ${evidence}; one claim, one busy; token version unchanged.`);
  } finally {a.stop();b.stop();}
  const claimId=await query(`select refresh_claim from private.plannix_auth_sessions
    where secret_hash=repeat('b',64)`);
  const sessionId=await query(`select id from private.plannix_auth_sessions
    where secret_hash=repeat('b',64)`);
  assert.match(claimId,/^[0-9a-f-]{36}$/);
  const finishSql=`select public.plannix_auth_finish_refresh('${claimId}'::uuid,
    '${sessionId}'::uuid,1,'{"v":2}'::jsonb,'{"v":2}'::jsonb)->>'state';`;
  const cName=`auth_stage3_finish_a_${process.pid}`;
  const dName=`auth_stage3_finish_b_${process.pid}`;
  const c=connection(cName);const d=connection(dName);
  try {
    c.send(`begin;set local application_name='${cName}';set local role service_role;
      set local statement_timeout='12s';set local lock_timeout='10s';${finishSql}\n\\echo C_HOLD\n`);
    await c.wait('C_HOLD');
    d.send(`begin;set local application_name='${dName}';set local role service_role;
      set local statement_timeout='12s';set local lock_timeout='10s';${finishSql}\n\\echo D_DONE\n`);
    let evidence='';const until=Date.now()+7000;
    while(Date.now()<until){
      evidence=await query(`select wait_event_type || ':' || wait_event || ':' ||
        array_length(pg_catalog.pg_blocking_pids(pid),1)::text from pg_stat_activity
        where application_name='${dName}' and wait_event_type='Lock'`);
      if(/^Lock:[^:]+:[1-9][0-9]*$/.test(evidence))break;
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    assert.match(evidence,/^Lock:[^:]+:[1-9][0-9]*$/,'second finish truly blocked');
    c.send('commit;\n\\echo C_COMMITTED\n');await c.wait('C_COMMITTED');
    d.send('commit;\n\\echo D_COMMITTED\n');await d.wait('D_COMMITTED');
    c.send('\\q\n');d.send('\\q\n');
    assert.equal(await c.finished,0,c.stderr());
    assert.equal(await d.finished,0,d.stderr());
    assert.match(c.output(),/refreshed/);assert.match(d.output(),/conflict/);
    assert.equal(await query(`select token_version from private.plannix_auth_sessions
      where secret_hash=repeat('b',64)`),'2');
    console.log(`Stage 3 refresh finish: ${evidence}; one update, one conflict; token version 2.`);
  } finally {c.stop();d.stop();}
} finally {
  for(const child of active)child.stop();
  await Promise.allSettled([...active].map(child=>child.finished));
  await query(`delete from private.plannix_auth_browser_bindings where marker_hash=repeat('a',64);
    delete from auth.users where id='${fixtureUser}'`);
}
