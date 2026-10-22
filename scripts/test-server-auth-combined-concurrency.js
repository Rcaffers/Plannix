// Synthetic lock-observed races in a verified, empty disposable Supabase database.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { runCombinedContention } from './combinedContentionCleanup.js';

const exec = promisify(execFile);
const database = process.argv[2];
if (!/^auth_combined_[a-z0-9_]+$/.test(database || ''))
  throw Error('Disposable combined-auth database required.');
for (const name of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG']) {
  if (process.env[name]) throw Error('Docker connection overrides are forbidden.');
}
const container = 'supabase_db_Plannix';
const docker = async args => (await exec('docker', args, { timeout: 9000, maxBuffer: 65536 })).stdout.trim();
if (await docker(['context', 'show']) !== 'desktop-linux'
  || await docker(['inspect', '--format', '{{.Name}} {{.State.Running}}', container])
    !== `/${container} true`) throw Error('Verified local Supabase container required.');
const queryArgs = sql => ['exec', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
  '-U', 'postgres', '-d', database, '-c', sql];
const queryRaw = sql => docker(queryArgs(sql));
if (await queryRaw('select count(*) from auth.users') !== '0')
  throw Error('Disposable database must have no users.');

let workRegistry;
function query(sql) {
  // Every work-phase docker exec is admitted and published synchronously at
  // creation. Late work cannot bypass the closed registry to start a child.
  return workRegistry.acquire(publish => {
    let done = false;
    let child;
    const outcome = new Promise(resolve => {
      child = execFile('docker', queryArgs(sql), { timeout: 9000, maxBuffer: 65536 },
        (error, stdout) => { done = true; resolve({ error, output: stdout?.trim() }); });
    });
    const resource = {
      finished: outcome.then(() => undefined), outcome,
      stop() {
        if (done) return;
        child.kill('SIGTERM');
        const force = setTimeout(() => { if (!done) child.kill('SIGKILL'); }, 300);
        void outcome.then(() => clearTimeout(force));
      },
    };
    return publish(resource);
  }).then(async resource => {
    const result = await resource.outcome;
    if (result.error) throw result.error;
    return result.output;
  });
}

const user = 'dd000000-0000-4000-8000-000000000112';
function connection(name) {
  const child = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-qAt',
    '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database],
  { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = ''; let errors = ''; let closed = false;
  const deadline = setTimeout(() => child.kill('SIGKILL'), 16000);
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { errors += data; });
  const finished = new Promise(resolve => {
    child.once('error', error => { errors += error.message; });
    child.once('close', code => { closed = true; clearTimeout(deadline); resolve(code); });
  });
  const session = {
    send: sql => child.stdin.write(sql),
    async wait(token) {
      const until = Date.now() + 7000;
      while (!output.includes(token) && !closed && Date.now() < until)
        await new Promise(resolve => setTimeout(resolve, 25));
      assert.ok(output.includes(token), `${name} did not reach its barrier: ${errors}`);
    },
    finished, output: () => output, errors: () => errors,
    release(command) {
      if (!closed && !child.stdin.destroyed && !child.stdin.writableEnded)
        child.stdin.write(`${command};\n`);
    },
    stop() {
      if (closed) return;
      child.kill('SIGTERM');
      const force = setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, 300);
      void finished.then(() => clearTimeout(force));
      if (!child.stdin.destroyed) child.stdin.end();
    },
  };
  return session;
}
async function observeLock(name) {
  const until = Date.now() + 7000;
  while (Date.now() < until) {
    const observed = await query(`select wait_event_type || ':' || wait_event || ':' ||
      pg_catalog.array_length(pg_catalog.pg_blocking_pids(pid),1)::text
      from pg_catalog.pg_stat_activity where application_name='${name}'
        and wait_event_type='Lock'`);
    if (/^Lock:[^:]+:[1-9][0-9]*$/.test(observed)) return observed;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw Error('Combined read did not observe the expected database lock wait.');
}
await runCombinedContention({ work: async registry => {
  workRegistry = registry;
  await query(`insert into auth.users(id,email,email_confirmed_at)
    values ('${user}','combined-race@example.test',pg_catalog.now())`);
  const marker = await query(`select public.plannix_auth_issue_binding(repeat('a',64))->>'name'`);
  assert.match(marker, /^__Host-plannix-b-[1-9][0-9]*$/);
  const intent = await query(`select public.plannix_auth_begin('${marker}',repeat('a',64),
    'ordinary')->>'intentId'`);
  assert.equal(await query(`select public.plannix_auth_settle('${intent}'::uuid,'created',
    '${user}',repeat('b',64),'{}','{}')->>'state'`), 'created');
  const session = await query(`select '__Host-plannix-s-' || generation
    from private.plannix_auth_sessions where secret_hash=repeat('b',64)`);
  const candidates = `pg_catalog.jsonb_build_object('markers',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('name','${marker}',
      'hash',repeat('a',64))),'sessions',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('name','${session}','hash',repeat('b',64))))`;

  async function race(label, holderSql, candidateSql, expected) {
    const holder = await registry.acquire(publish =>
      publish(connection(`combined_${label}_holder_${process.pid}`)));
    const readerName = `combined_${label}_reader_${process.pid}`;
    const reader = await registry.acquire(publish => publish(connection(readerName)));
    try {
      holder.send(`begin; set local statement_timeout='12s'; ${holderSql}
        \\echo HOLDER_READY\n`);
      await holder.wait('HOLDER_READY');
      reader.send(`begin; set local application_name='${readerName}';
        set local role service_role; set local statement_timeout='12s';
        select public.plannix_auth_select_application(${candidateSql})::text;
        \\echo READER_DONE\n`);
      const wait = await observeLock(readerName);
      holder.send('commit;\n\\echo HOLDER_COMMITTED\n');
      await holder.wait('HOLDER_COMMITTED');
      reader.send('commit;\n\\echo READER_COMMITTED\n');
      await reader.wait('READER_COMMITTED');
      holder.send('\\q\n'); reader.send('\\q\n');
      assert.equal(await holder.finished, 0, holder.errors());
      assert.equal(await reader.finished, 0, reader.errors());
      assert.match(reader.output(), new RegExp(`"state": "${expected}"`));
      console.log(`${label}: observed ${wait}; combined read returned ${expected}.`);
    } finally { holder.stop(); reader.stop(); }
  }

  async function readFirstLogout(candidateSql, targetMarker, targetSession,
    targetMarkerHash, targetSessionHash) {
    const reader = await registry.acquire(publish =>
      publish(connection(`combined_read_first_${process.pid}`)));
    const logoutName = `combined_logout_after_read_${process.pid}`;
    const logout = await registry.acquire(publish => publish(connection(logoutName)));
    try {
      reader.send(`begin; set local role service_role; set local statement_timeout='12s';
        select public.plannix_auth_select_application(${candidateSql})::text;
        \\echo READER_AUTHORIZED\n`);
      await reader.wait('READER_AUTHORIZED');
      assert.match(reader.output(), /"state": "current"/);
      logout.send(`begin; set local application_name='${logoutName}';
        set local role service_role; set local statement_timeout='12s';
        select public.plannix_auth_logout('${targetMarker}',repeat('${targetMarkerHash}',64),
          '${targetSession}',repeat('${targetSessionHash}',64))->>'state';
        \\echo LOGOUT_DONE\n`);
      const wait = await observeLock(logoutName);
      reader.send('commit;\n\\echo READER_COMMITTED\n');
      await reader.wait('READER_COMMITTED');
      logout.send('commit;\n\\echo LOGOUT_COMMITTED\n');
      await logout.wait('LOGOUT_COMMITTED');
      reader.send('\\q\n'); logout.send('\\q\n');
      assert.equal(await reader.finished, 0, reader.errors());
      assert.equal(await logout.finished, 0, logout.errors());
      assert.match(logout.output(), /\brevoked\b/);
      console.log(`read-first logout: observed ${wait}; earlier authorization preceded revocation.`);
    } finally { reader.stop(); logout.stop(); }
  }

  const replacement = await query(`select public.plannix_auth_begin('${marker}',
    repeat('a',64),'ordinary','${session}',repeat('b',64))->>'intentId'`);
  await race('replacement', `select public.plannix_auth_settle('${replacement}'::uuid,
    'created','${user}',repeat('c',64),'{}','{}')->>'state';`, candidates, 'selected');
  assert.equal(await query(`select count(*) from private.plannix_auth_sessions
    where secret_hash=repeat('c',64) and not revoked`), '1');

  // A fresh current cookie is used for the deadline race, so the reader must
  // observe the binding's newly committed expiry after its lock wait.
  const current = await query(`select '__Host-plannix-s-' || generation
    from private.plannix_auth_sessions where secret_hash=repeat('c',64)`);
  const currentCandidates = `pg_catalog.jsonb_build_object('markers',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('name','${marker}',
      'hash',repeat('a',64))),'sessions',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('name','${current}','hash',repeat('c',64))))`;
  await race('refresh', `with claim as (select public.plannix_auth_claim_refresh(
    '${marker}',repeat('a',64),'${current}',repeat('c',64),1) as value)
    select public.plannix_auth_finish_refresh((value->>'claimId')::uuid,
      (value->>'sessionId')::uuid,1,'{}','{}')->>'state' from claim;`,
    currentCandidates, 'current');
  assert.equal(await query(`select token_version from private.plannix_auth_sessions
    where secret_hash=repeat('c',64)`), '2');
  await race('logout', `select public.plannix_auth_logout('${marker}',repeat('a',64),
    '${current}',repeat('c',64))->>'state';`, currentCandidates, 'selected');
  // Restore an independent signed-in fixture for the deadline race.
  const nextIntent = await query(`select public.plannix_auth_begin('${marker}',
    repeat('a',64),'ordinary')->>'intentId'`);
  assert.equal(await query(`select public.plannix_auth_settle('${nextIntent}'::uuid,
    'created','${user}',repeat('d',64),'{}','{}')->>'state'`), 'created');
  const deadlineSession = await query(`select '__Host-plannix-s-' || generation
    from private.plannix_auth_sessions where secret_hash=repeat('d',64)`);
  const deadlineCandidates = `pg_catalog.jsonb_build_object('markers',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('name','${marker}',
      'hash',repeat('a',64))),'sessions',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('name','${deadlineSession}','hash',repeat('d',64))))`;
  const holder = await registry.acquire(publish =>
    publish(connection(`combined_expiry_holder_${process.pid}`)));
  const readerName = `combined_expiry_reader_${process.pid}`;
  const reader = await registry.acquire(publish => publish(connection(readerName)));
  try {
    holder.send(`begin; set local statement_timeout='12s';
      update private.plannix_auth_browser_bindings
        set expires_at=pg_catalog.clock_timestamp()-interval '1 second'
        where marker_hash=repeat('a',64);
      \\echo HOLDER_READY\n`);
    await holder.wait('HOLDER_READY');
    reader.send(`begin; set local application_name='${readerName}';
      set local role service_role; set local statement_timeout='12s';
      select public.plannix_auth_select_application(${deadlineCandidates})::text;
      \\echo READER_DONE\n`);
    const wait = await observeLock(readerName);
    holder.send('commit;\n\\echo HOLDER_COMMITTED\n');
    await holder.wait('HOLDER_COMMITTED');
    reader.send('commit;\n\\echo READER_COMMITTED\n');
    await reader.wait('READER_COMMITTED');
    holder.send('\\q\n'); reader.send('\\q\n');
    assert.equal(await holder.finished, 0, holder.errors());
    assert.equal(await reader.finished, 0, reader.errors());
    assert.match(reader.output(), /\bexpired\b/);
  assert.equal(await query(`select expired::text from private.plannix_auth_browser_bindings
      where marker_hash=repeat('a',64)`), 'true');
    console.log(`expiry: observed ${wait}; no token envelopes returned.`);
  } finally { holder.stop(); reader.stop(); }
  const secondMarker = await query(`select public.plannix_auth_issue_binding(repeat('e',64))->>'name'`);
  const secondIntent = await query(`select public.plannix_auth_begin('${secondMarker}',
    repeat('e',64),'ordinary')->>'intentId'`);
  assert.equal(await query(`select public.plannix_auth_settle('${secondIntent}'::uuid,
    'created','${user}',repeat('f',64),'{}','{}')->>'state'`), 'created');
  const secondSession = await query(`select '__Host-plannix-s-' || generation
    from private.plannix_auth_sessions where secret_hash=repeat('f',64)`);
  const secondCandidates = `pg_catalog.jsonb_build_object('markers',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('name','${secondMarker}',
      'hash',repeat('e',64))),'sessions',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('name','${secondSession}','hash',repeat('f',64))))`;
  await readFirstLogout(secondCandidates, secondMarker, secondSession, 'e', 'f');
}, cleanup: () => queryRaw(`delete from private.plannix_auth_browser_bindings
  where marker_hash in (repeat('a',64),repeat('e',64));
  delete from auth.users where id='${user}'`) });
