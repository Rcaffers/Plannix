// Run only against a newly created disposable database in the verified local Supabase container.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';

const exec = promisify(execFile);
const database = process.argv[2];
if (!/^summary_review_[a-z0-9_]+$/.test(database || '')) throw Error('Disposable summary database required.');
for (const name of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG']) {
  if (process.env[name]) throw Error('Docker connection overrides are not allowed.');
}
const container = 'supabase_db_Plannix';
const docker = async args => (await exec('docker', args, { timeout: 8000, maxBuffer: 64 * 1024 })).stdout.trim();
if (await docker(['context', 'show']) !== 'desktop-linux') throw Error('Verified local Docker context required.');
if (await docker(['inspect', '--format', '{{.Name}}', container]) !== `/${container}`) throw Error('Local Supabase database required.');
const query = sql => docker(['exec', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database, '-c', sql]);
const user = 'cb000000-0000-4000-8000-000000000071';
await query(`insert into auth.users(id,email,email_confirmed_at) values ('${user}','summary-race@example.test',now())`);

function session(name) {
  const child = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', database], { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = ''; let errors = ''; let closed = false; let code = null;
  const deadline = setTimeout(() => child.kill('SIGKILL'), 18000);
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { errors += chunk; });
  const finished = new Promise(resolve => child.on('close', exitCode => {
    closed = true; code = exitCode; clearTimeout(deadline); resolve(exitCode);
  }));
  const send = value => child.stdin.write(value);
  const waitFor = async marker => {
    const end = Date.now() + 7000;
    while (!output.includes(marker) && !closed && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 25));
    assert.ok(output.includes(marker), `${name} did not reach its transaction barrier`);
  };
  return { send, waitFor, finished, stop: () => { child.stdin.end(); if (!closed) child.kill('SIGKILL'); },
    result: () => ({ code, errors }) };
}

async function race(label, firstRevision, firstTime, secondTime, expectedRevision) {
  const aName = `summary_${label}_a_${process.pid}`;
  const bName = `summary_${label}_b_${process.pid}`;
  const a = session(aName); const b = session(bName);
  const save = (revision, time) => `select public.plannix_save_morning_summary_preferences('${user}',${revision},true,'${time}');\n`;
  try {
    a.send(`begin;\nset local application_name='${aName}';\nset local role service_role;\nset local statement_timeout='12s';\n${save(firstRevision, firstTime)}\\echo A_HOLD\n`);
    await a.waitFor('A_HOLD');
    b.send(`begin;\nset local application_name='${bName}';\nset local role service_role;\nset local statement_timeout='12s';\n${save(firstRevision, secondTime)}\\echo B_DONE\n`);
    let blocked = '';
    const end = Date.now() + 7000;
    while (Date.now() < end) {
      blocked = await query(`select wait_event_type || ':' || wait_event from pg_stat_activity where application_name='${bName}' and wait_event_type='Lock'`);
      if (blocked) break;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    assert.match(blocked, /^Lock:/, `${label} did not block at a database lock`);
    a.send('commit;\n\\echo A_COMMITTED\n'); await a.waitFor('A_COMMITTED');
    a.send('\\q\n');
    assert.equal(await a.finished, 0, `${label} first save failed`);
    assert.notEqual(await b.finished, 0, `${label} stale save unexpectedly succeeded`);
    assert.match(b.result().errors, /Morning summary preferences changed\./);
    const result = await query(`select revision || ':' || to_char(delivery_time,'HH24:MI') from private.plannix_morning_summary_preferences where user_id='${user}'`);
    assert.equal(result, `${expectedRevision}:${firstTime}`, `${label} final state changed by stale save`);
    console.log(`${label}: competing RPC blocked on ${blocked}; one save succeeded, stale save rejected.`);
  } finally { a.stop(); b.stop(); }
}

await race('first', 0, '06:45', '09:00', 1);
await race('update', 1, '07:15', '10:00', 2);
