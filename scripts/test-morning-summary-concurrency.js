// Run only against a newly created disposable database in the verified local Supabase container.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';

const exec = promisify(execFile);
const database = process.argv[2];
if (!/^summary_(?:review|stage2|stage3)_[a-z0-9_]+$/.test(database || '')) throw Error('Disposable summary database required.');
for (const name of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG']) {
  if (process.env[name]) throw Error('Docker connection overrides are not allowed.');
}
const container = 'supabase_db_Plannix';
const docker = async args => (await exec('docker', args, { timeout: 8000, maxBuffer: 64 * 1024 })).stdout.trim();
if (await docker(['context', 'show']) !== 'desktop-linux') throw Error('Verified local Docker context required.');
if (await docker(['inspect', '--format', '{{.Name}}', container]) !== `/${container}`) throw Error('Local Supabase database required.');
const query = sql => docker(['exec', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database, '-c', sql]);
const user = 'cb000000-0000-4000-8000-000000000071';
const organisation = 'cb000000-0000-4000-8000-000000000072';
const member = 'cb000000-0000-4000-8000-000000000073';
const year = 'cb000000-0000-4000-8000-000000000074';
const otherUser = 'cb000000-0000-4000-8000-000000000081';
const otherOrganisation = 'cb000000-0000-4000-8000-000000000082';
const otherMember = 'cb000000-0000-4000-8000-000000000083';
const otherYear = 'cb000000-0000-4000-8000-000000000084';
if (await query('select count(*) from auth.users') !== '0') throw Error('Disposable database must have no users.');
await query(`insert into auth.users(id,email,email_confirmed_at) values ('${user}','summary-race@example.test',now());
insert into public.plannix_organisations(id,name,organisation_type) values ('${organisation}','Summary race','personal');
insert into private.plannix_personal_organisations(user_id,organisation_id) values ('${user}','${organisation}');
insert into public.plannix_organisation_users(id,user_id,organisation_id) values ('${member}','${user}','${organisation}');
insert into public.plannix_academic_years(id,organisation_id,name,start_date,end_date)
values ('${year}','${organisation}','2026-27','2026-09-01','2027-08-31');
insert into auth.users(id,email,email_confirmed_at) values ('${otherUser}','summary-other@example.test',now());
insert into public.plannix_organisations(id,name,organisation_type) values ('${otherOrganisation}','Other summary race','personal');
insert into private.plannix_personal_organisations(user_id,organisation_id) values ('${otherUser}','${otherOrganisation}');
insert into public.plannix_organisation_users(id,user_id,organisation_id) values ('${otherMember}','${otherUser}','${otherOrganisation}');
insert into public.plannix_academic_years(id,organisation_id,name,start_date,end_date)
values ('${otherYear}','${otherOrganisation}','2026-27','2026-09-01','2027-08-31')`);

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
    result: () => ({ code, errors, output }) };
}

async function race(label, firstRevision, firstTime, secondTime, expectedRevision) {
  const aName = `summary_${label}_a_${process.pid}`;
  const bName = `summary_${label}_b_${process.pid}`;
  const a = session(aName); const b = session(bName);
  const save = (revision, time) => `select public.plannix_save_morning_summary_preferences('${user}',${revision},true,'${time}','${year}');\n`;
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

// A real contended unique-key insert: B reaches the production job claim's
// user/day key while A holds the uncommitted claim transaction.
await query(`insert into private.plannix_push_subscriptions(endpoint_hash,user_id,endpoint,p256dh,auth_key)
values (repeat('a',64),'${user}','https://fcm.googleapis.com/fcm/send/synthetic-summary-race',repeat('x',88),repeat('y',22));
select public.plannix_save_morning_summary_preferences('${otherUser}',0,true,'07:15','${otherYear}');
insert into private.plannix_push_subscriptions(endpoint_hash,user_id,endpoint,p256dh,auth_key)
values (repeat('b',64),'${otherUser}','https://fcm.googleapis.com/fcm/send/synthetic-other-race',repeat('x',88),repeat('y',22))`);
const aName = `summary_job_a_${process.pid}`;
const bName = `summary_job_b_${process.pid}`;
const a = session(aName); const b = session(bName);
try {
  a.send(`begin; set local application_name='${aName}'; set local statement_timeout='12s';
select private.plannix_claim_morning_summary_pilot_jobs_at('2026-10-05 06:15:00+00',1,'${user}');\n\\echo A_HOLD\n`);
  await a.waitFor('A_HOLD');
  b.send(`begin; set local application_name='${bName}'; set local statement_timeout='12s';
select private.plannix_claim_morning_summary_pilot_jobs_at('2026-10-05 06:15:01+00',1,'${user}');\n\\echo B_DONE\n`);
  let blocked = '';
  const end = Date.now() + 7000;
  while (Date.now() < end) {
    blocked = await query(`select wait_event_type || ':' || wait_event from pg_stat_activity
      where application_name='${bName}' and wait_event_type='Lock'`);
    if (blocked) break;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  assert.match(blocked, /^Lock:/, 'second worker did not contend on the job claim');
  a.send('commit;\n\\echo A_COMMITTED\n'); await a.waitFor('A_COMMITTED'); a.send('\\q\n');
  assert.equal(await a.finished, 0);
  b.send('commit;\n\\q\n');
  assert.equal(await b.finished, 0);
  assert.match(b.result().output, /\[\]/, 'second worker acquired no claim');
  assert.equal(await query(`select count(*) from private.plannix_morning_summary_jobs
    where user_id='${user}' and london_date='2026-10-05'`), '1');
  assert.equal(await query(`select count(*) from private.plannix_morning_summary_jobs
    where user_id='${otherUser}'`), '0', 'non-pilot has no reserved job during concurrent claims');
  console.log(`job claim: competing worker blocked on ${blocked}; exactly one pilot job and no other-user job.`);
} finally { a.stop(); b.stop(); }

// A production dispatch check reads the clock after acquiring the job row.
// Shift only the private test clock so a short real lock wait crosses a
// synthetic London cutoff, without waiting for an actual school-day minute.
const jobToken = await query(`select lease_claim_id from private.plannix_morning_summary_jobs
  where user_id='${user}' and london_date='2026-10-05'`);
const deviceVersion = await query(`select subscription_version from private.plannix_push_subscriptions
  where user_id='${user}' and endpoint_hash=repeat('a',64)`);
await query(`insert into private.plannix_morning_summary_deliveries
  (user_id,london_date,endpoint_hash,subscription_version,state)
  values ('${user}','2026-10-05',repeat('a',64),'${deviceVersion}','in_flight')`);
assert.equal(await query(`select private.plannix_morning_summary_dispatch_seconds_at(
  '${user}','2026-10-05','${jobToken}',repeat('a',64),'${deviceVersion}',2,'${year}',
  '2026-10-05 06:29:55+00',null)`), '5', 'fixture starts inside the five-second London window');
const cutoffAName = `summary_cutoff_a_${process.pid}`;
const cutoffBName = `summary_cutoff_b_${process.pid}`;
const cutoffA = session(cutoffAName); const cutoffB = session(cutoffBName);
try {
  cutoffA.send(`begin; set local application_name='${cutoffAName}'; set local statement_timeout='12s';
select 1 from private.plannix_morning_summary_jobs where user_id='${user}' and london_date='2026-10-05' for update;
\\echo A_HOLD\n`);
  await cutoffA.waitFor('A_HOLD');
  cutoffB.send(`begin; set local application_name='${cutoffBName}'; set local statement_timeout='12s';
select coalesce(private.plannix_morning_summary_dispatch_seconds_at(
  '${user}','2026-10-05','${jobToken}',repeat('a',64),'${deviceVersion}',2,'${year}',null,
  '2026-10-05 06:29:55+00'::timestamptz - pg_catalog.clock_timestamp())::text,'CUTOFF_SKIP');
\\echo B_DONE\n`);
  let blocked = '';
  const end = Date.now() + 7000;
  while (Date.now() < end) {
    blocked = await query(`select wait_event_type || ':' || wait_event from pg_stat_activity
      where application_name='${cutoffBName}' and wait_event_type='Lock'`);
    if (blocked) break;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  assert.match(blocked, /^Lock:/, 'dispatch check did not contend on the production job row');
  await new Promise(resolve => setTimeout(resolve, 6200));
  cutoffA.send('commit;\n\\echo A_COMMITTED\n'); await cutoffA.waitFor('A_COMMITTED'); cutoffA.send('\\q\n');
  assert.equal(await cutoffA.finished, 0, 'lock holder failed');
  cutoffB.send('commit;\n\\q\n');
  assert.equal(await cutoffB.finished, 0, 'dispatch check failed');
  assert.match(cutoffB.result().output, /CUTOFF_SKIP/, 'blocked dispatch did not recheck time after lock');
  console.log(`dispatch cutoff: competing check blocked on ${blocked}; post-lock clock skipped the attempt.`);
} finally { cutoffA.stop(); cutoffB.stop(); }

await query(`delete from public.plannix_organisations where id in ('${organisation}','${otherOrganisation}');
  delete from auth.users where id in ('${user}','${otherUser}')`);
