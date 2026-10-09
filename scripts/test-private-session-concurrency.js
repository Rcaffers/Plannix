// Synthetic, genuinely contended RPC races in a verified disposable local database.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const database = process.argv[2];
if (!/^auth_stage2_[a-z0-9_]+$/.test(database || '')) throw Error('Disposable Stage 2 database required.');
for (const variable of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG']) {
  if (process.env[variable]) throw Error('Docker connection overrides are not allowed.');
}
const container = 'supabase_db_Plannix';
const docker = async args => (await exec('docker', args, { timeout: 8000, maxBuffer: 64 * 1024 })).stdout.trim();
if (await docker(['context', 'show']) !== 'desktop-linux'
  || await docker(['inspect', '--format', '{{.Name}} {{.State.Running}}', container]) !== `/${container} true`) {
  throw Error('Verified local Supabase container required.');
}
const query = sql => docker(['exec', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
  '-U', 'postgres', '-d', database, '-c', sql]);
if (await query('select count(*) from auth.users') !== '0') throw Error('Disposable database must contain no users.');

const userA = 'dd000000-0000-4000-8000-000000000011';
const userB = 'dd000000-0000-4000-8000-000000000012';
const activeSessions = new Set();
try {
await query(`insert into auth.users(id,email,email_confirmed_at) values
  ('${userA}','stage2-a@example.test',pg_catalog.now()),
  ('${userB}','stage2-b@example.test',pg_catalog.now())`);
const marker = await query(`select public.plannix_auth_issue_binding(repeat('a',64))->>'name'`);
assert.match(marker, /^__Host-plannix-b-[1-9][0-9]*$/);

function openSession(name) {
  const child = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', database], { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = ''; let errors = ''; let closed = false;
  const deadline = setTimeout(() => child.kill('SIGKILL'), 16000);
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { errors += chunk; });
  const finished = new Promise(resolve => child.once('close', code => {
    closed = true; clearTimeout(deadline); resolve(code);
  }));
  const send = sql => child.stdin.write(sql);
  const wait = async token => {
    const end = Date.now() + 7000;
    while (!output.includes(token) && !closed && Date.now() < end) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.ok(output.includes(token), `${name} did not reach its barrier`);
  };
  const session = { send, wait, finished, output: () => output, errors: () => errors,
    stop: () => { if (!closed) child.kill('SIGKILL'); child.stdin.end(); } };
  activeSessions.add(session);
  finished.finally(() => activeSessions.delete(session));
  return session;
}

async function observeBlock(name) {
  const end = Date.now() + 7000;
  let evidence = '';
  while (Date.now() < end) {
    evidence = await query(`select wait_event_type || ':' || wait_event || ':' ||
      array_length(pg_catalog.pg_blocking_pids(pid),1)::text from pg_stat_activity
      where application_name='${name}' and wait_event_type='Lock'`);
    if (/^Lock:[^:]+:[1-9][0-9]*$/.test(evidence)) return evidence;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw Error('Competing transaction never blocked on the production lock.');
}

async function race(label, firstSql, secondSql, after) {
  const aName = `auth_stage2_${label}_a_${process.pid}`;
  const bName = `auth_stage2_${label}_b_${process.pid}`;
  const a = openSession(aName); const b = openSession(bName);
  try {
    a.send(`begin; set local application_name='${aName}'; set local role service_role;
      set local statement_timeout='12s'; set local lock_timeout='10s';
      ${firstSql}\n\\echo A_HOLD\n`);
    await a.wait('A_HOLD');
    b.send(`begin; set local application_name='${bName}'; set local role service_role;
      set local statement_timeout='12s'; set local lock_timeout='10s';
      ${secondSql}\n\\echo B_DONE\n`);
    const evidence = await observeBlock(bName);
    a.send('commit;\n\\echo A_COMMITTED\n');
    await a.wait('A_COMMITTED');
    b.send('commit;\n\\echo B_COMMITTED\n');
    await b.wait('B_COMMITTED');
    a.send('\\q\n'); b.send('\\q\n');
    assert.equal(await a.finished, 0, `${label} first transaction failed: ${a.errors()}`);
    assert.equal(await b.finished, 0, `${label} second transaction failed: ${b.errors()}`);
    await after(a.output(), b.output());
    console.log(`${label}: ${evidence}; final state verified.`);
  } finally { a.stop(); b.stop(); }
}

const begin = () => `select public.plannix_auth_begin('${marker}',repeat('a',64),'ordinary');`;
await race('begin', begin(), begin(), async () => {
  assert.equal(await query(`select count(*) from private.plannix_auth_transitions
    where state='pending'`), '1');
  assert.equal(await query(`select count(*) from private.plannix_auth_transitions
    where state='superseded'`), '1');
});

const currentIntent = await query(`select latest_transition_id from private.plannix_auth_browser_bindings
  where marker_hash=repeat('a',64)`);
assert.equal((await query(`select public.plannix_auth_settle('${currentIntent}','created','${userA}',
  repeat('b',64),'{}','{}')->>'state'`)), 'created');
const oldName = await query(`select '__Host-plannix-s-' || generation from private.plannix_auth_sessions
  where secret_hash=repeat('b',64)`);
const replacementIntent = await query(`select public.plannix_auth_begin('${marker}',repeat('a',64),'ordinary')->>'intentId'`);
await race('finish_logout', `select public.plannix_auth_settle('${replacementIntent}','created','${userB}',
  repeat('c',64),'{}','{}');`,
`select public.plannix_auth_logout('${marker}',repeat('a',64),'${oldName}',repeat('b',64));`,
  async (_, second) => {
    assert.match(second, /"state": "absent"/);
    assert.equal(await query(`select owner_id from private.plannix_auth_sessions as s
      join private.plannix_auth_browser_bindings as b on b.current_session_id=s.id
      where b.marker_hash=repeat('a',64)`), userB);
  });

const currentName = await query(`select '__Host-plannix-s-' || generation from private.plannix_auth_sessions
  where secret_hash=repeat('c',64)`);
const refresh = envelope => `select public.plannix_auth_refresh('${marker}',repeat('a',64),
  '${currentName}',repeat('c',64),'${userB}',1,'{"v":"${envelope}"}','{"v":"${envelope}"}');`;
await race('refresh', refresh('first'), refresh('second'), async (_, second) => {
  assert.match(second, /"state": "conflict"/);
  assert.equal(await query(`select token_version || ':' || (access_envelope->>'v')
    from private.plannix_auth_sessions where secret_hash=repeat('c',64)`), '2:first');
});
console.log('Three genuinely contended private-session races passed.');
} finally {
  for (const session of activeSessions) session.stop();
  await Promise.allSettled([...activeSessions].map(session => session.finished));
  await query(`delete from private.plannix_auth_browser_bindings where marker_hash=repeat('a',64);
    delete from auth.users where id in ('${userA}','${userB}')`);
}
