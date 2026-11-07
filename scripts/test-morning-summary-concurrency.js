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
await query(`insert into private.plannix_auth_browser_bindings(id,marker_hash,expires_at,current_session_id)
values ('cb000000-0000-4000-8000-000000000075',repeat('1',64),now()+interval '1 day',
  'cb000000-0000-4000-8000-000000000076'),
  ('cb000000-0000-4000-8000-000000000085',repeat('2',64),now()+interval '1 day',
  'cb000000-0000-4000-8000-000000000086');
insert into private.plannix_auth_sessions(id,binding_id,generation,owner_id,kind,secret_hash,
  access_envelope,refresh_envelope,expires_at)
values ('cb000000-0000-4000-8000-000000000076','cb000000-0000-4000-8000-000000000075',
  nextval('private.plannix_auth_generation_seq'),'${user}','ordinary',repeat('3',64),'{}','{}',now()+interval '1 day'),
  ('cb000000-0000-4000-8000-000000000086','cb000000-0000-4000-8000-000000000085',
  nextval('private.plannix_auth_generation_seq'),'${otherUser}','ordinary',repeat('4',64),'{}','{}',now()+interval '1 day');
insert into private.plannix_push_subscriptions(endpoint_hash,user_id,endpoint,p256dh,auth_key,bound_session_id)
values (repeat('a',64),'${user}','https://fcm.googleapis.com/fcm/send/synthetic-summary-race',
  repeat('x',88),repeat('y',22),'cb000000-0000-4000-8000-000000000076');
select public.plannix_save_morning_summary_preferences('${otherUser}',0,true,'07:15','${otherYear}');
insert into private.plannix_push_subscriptions(endpoint_hash,user_id,endpoint,p256dh,auth_key,bound_session_id)
values (repeat('b',64),'${otherUser}','https://fcm.googleapis.com/fcm/send/synthetic-other-race',
  repeat('x',88),repeat('y',22),'cb000000-0000-4000-8000-000000000086')`);
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

// Registration takes B's binding and then the endpoint. A dispatch takes its
// own browser binding before the job, preference and endpoint. A committed
// reassignment must make the waiting dispatch return no allowance.
const installationVersion = await query(`select installation_version from private.plannix_push_subscriptions
  where endpoint_hash=repeat('a',64)`);
const reassignmentAName = `summary_reassign_a_${process.pid}`;
const reassignmentBName = `summary_reassign_b_${process.pid}`;
const reassignmentA = session(reassignmentAName); const reassignmentB = session(reassignmentBName);
try {
  reassignmentA.send(`begin; set local application_name='${reassignmentAName}'; set local statement_timeout='12s';
set local role service_role;
select public.plannix_push_register_installation('cb000000-0000-4000-8000-000000000086',
  repeat('a',64),'https://fcm.googleapis.com/fcm/send/synthetic-summary-race',repeat('x',88),repeat('y',22),
  '${installationVersion}');
\\echo REASSIGN_HELD
`);
  await reassignmentA.waitFor('REASSIGN_HELD');
  reassignmentB.send(`begin; set local application_name='${reassignmentBName}'; set local statement_timeout='12s';
select coalesce(private.plannix_morning_summary_dispatch_seconds_at(
  '${user}','2026-10-05','${jobToken}',repeat('a',64),'${deviceVersion}',2,'${year}',
  '2026-10-05 06:20:00+00')::text,'REASSIGN_SKIP');
\\echo DISPATCH_DONE
`);
  let blocked = '';
  const end = Date.now() + 7000;
  while (Date.now() < end) {
    blocked = await query(`select wait_event_type || ':' || wait_event from pg_stat_activity
      where application_name='${reassignmentBName}' and wait_event_type='Lock'`);
    if (blocked) break;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  assert.match(blocked, /^Lock:/, 'dispatch did not wait for the registration endpoint lock');
  reassignmentA.send('commit;\n\\echo REASSIGN_COMMITTED\n');
  await reassignmentA.waitFor('REASSIGN_COMMITTED'); reassignmentA.send('\\q\n');
  assert.equal(await reassignmentA.finished, 0);
  await reassignmentB.waitFor('DISPATCH_DONE'); reassignmentB.send('commit;\n\\q\n');
  assert.equal(await reassignmentB.finished, 0);
  assert.match(reassignmentB.result().output, /REASSIGN_SKIP/, 'reassignment did not stop stale dispatch');
  assert.equal(await query(`select user_id from private.plannix_push_subscriptions where endpoint_hash=repeat('a',64)`),
    otherUser, 'B must retain the endpoint');
  console.log(`registration versus dispatch: observed ${blocked}; committed B ownership skipped A.`);
} finally { reassignmentA.stop(); reassignmentB.stop(); }

// A job candidate can pass the initial binding test, then wait for a unique
// job key while logout commits. The post-insert check must roll back the new
// job rather than prepare a snapshot from stale eligibility.
const staleClaimHolderName = `summary_stale_claim_holder_${process.pid}`;
const staleClaimWorkerName = `summary_stale_claim_worker_${process.pid}`;
const staleClaimHolder = session(staleClaimHolderName);
const staleClaimWorker = session(staleClaimWorkerName);
try {
  staleClaimHolder.send(`begin; set local application_name='${staleClaimHolderName}'; set local statement_timeout='12s';
insert into private.plannix_morning_summary_jobs
  (user_id,london_date,preference_revision,academic_year_id,lease_claim_id,lease_until)
values ('${otherUser}','2026-10-06',1,'${otherYear}',pg_catalog.gen_random_uuid(),
  pg_catalog.clock_timestamp()+interval '90 seconds');
\\echo JOB_HELD
`);
  await staleClaimHolder.waitFor('JOB_HELD');
  staleClaimWorker.send(`begin; set local application_name='${staleClaimWorkerName}'; set local statement_timeout='12s';
select private.plannix_claim_morning_summary_pilot_jobs_at('2026-10-06 06:15:00+00',1,'${otherUser}');
\\echo CLAIM_DONE
`);
  let blocked = '';
  const end = Date.now() + 7000;
  while (Date.now() < end) {
    blocked = await query(`select wait_event_type || ':' || wait_event from pg_stat_activity
      where application_name='${staleClaimWorkerName}' and wait_event_type='Lock'`);
    if (blocked) break;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  assert.match(blocked, /^Lock:/, 'claim did not wait on the held job key');
  await query(`select public.plannix_auth_logout(
    (select '__Host-plannix-b-'||generation from private.plannix_auth_browser_bindings
      where id='cb000000-0000-4000-8000-000000000085'),repeat('2',64),
    (select '__Host-plannix-s-'||generation from private.plannix_auth_sessions
      where id='cb000000-0000-4000-8000-000000000086'),repeat('4',64))`);
  staleClaimHolder.send('rollback;\n\\echo JOB_RELEASED\n');
  await staleClaimHolder.waitFor('JOB_RELEASED'); staleClaimHolder.send('\\q\n');
  assert.equal(await staleClaimHolder.finished, 0);
  assert.notEqual(await staleClaimWorker.finished, 0, 'stale claim unexpectedly succeeded');
  assert.match(staleClaimWorker.result().errors, /Morning summary binding changed\./);
  assert.equal(await query(`select count(*) from private.plannix_morning_summary_jobs
    where user_id='${otherUser}' and london_date='2026-10-06'`), '0',
  'stale claim must leave no job after the lock wait');
  console.log(`claim versus logout: observed ${blocked}; stale post-lock claim rolled back.`);
} finally { staleClaimHolder.stop(); staleClaimWorker.stop(); }

await query(`insert into private.plannix_push_subscriptions(endpoint_hash,user_id,endpoint,p256dh,auth_key,bound_session_id)
values (repeat('c',64),'${user}','https://fcm.googleapis.com/fcm/send/synthetic-logout-race',
  repeat('x',88),repeat('y',22),'cb000000-0000-4000-8000-000000000076');
insert into private.plannix_morning_summary_deliveries
  (user_id,london_date,endpoint_hash,subscription_version,state)
select '${user}','2026-10-05',endpoint_hash,subscription_version,'in_flight'
from private.plannix_push_subscriptions where endpoint_hash=repeat('c',64)`);
const logoutVersion = await query(`select subscription_version from private.plannix_push_subscriptions
  where endpoint_hash=repeat('c',64)`);
const logoutAName = `summary_logout_a_${process.pid}`;
const logoutBName = `summary_logout_b_${process.pid}`;
const logoutA = session(logoutAName); const logoutB = session(logoutBName);
try {
  logoutA.send(`begin; set local application_name='${logoutAName}'; set local statement_timeout='12s';
select public.plannix_auth_logout(
  (select '__Host-plannix-b-'||generation from private.plannix_auth_browser_bindings
    where id='cb000000-0000-4000-8000-000000000075'),repeat('1',64),
  (select '__Host-plannix-s-'||generation from private.plannix_auth_sessions
    where id='cb000000-0000-4000-8000-000000000076'),repeat('3',64));
\\echo LOGOUT_HELD
`);
  await logoutA.waitFor('LOGOUT_HELD');
  logoutB.send(`begin; set local application_name='${logoutBName}'; set local statement_timeout='12s';
select coalesce(private.plannix_morning_summary_dispatch_seconds_at(
  '${user}','2026-10-05','${jobToken}',repeat('c',64),'${logoutVersion}',2,'${year}',
  '2026-10-05 06:20:00+00')::text,'LOGOUT_SKIP');
\\echo DISPATCH_DONE
`);
  let blocked = '';
  const end = Date.now() + 7000;
  while (Date.now() < end) {
    blocked = await query(`select wait_event_type || ':' || wait_event from pg_stat_activity
      where application_name='${logoutBName}' and wait_event_type='Lock'`);
    if (blocked) break;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  assert.match(blocked, /^Lock:/, 'dispatch did not wait for the auth binding lock');
  logoutA.send('commit;\n\\echo LOGOUT_COMMITTED\n');
  await logoutA.waitFor('LOGOUT_COMMITTED'); logoutA.send('\\q\n');
  assert.equal(await logoutA.finished, 0);
  await logoutB.waitFor('DISPATCH_DONE'); logoutB.send('commit;\n\\q\n');
  assert.equal(await logoutB.finished, 0);
  assert.match(logoutB.result().output, /LOGOUT_SKIP/, 'logout did not stop stale dispatch');
  assert.equal(await query(`select revoked::text from private.plannix_auth_sessions
    where id='cb000000-0000-4000-8000-000000000076'`), 'true');
  console.log(`logout versus dispatch: observed ${blocked}; committed revocation skipped device.`);
} finally { logoutA.stop(); logoutB.stop(); }

await query(`delete from public.plannix_organisations where id in ('${organisation}','${otherOrganisation}');
  delete from auth.users where id in ('${user}','${otherUser}');
  delete from private.plannix_auth_browser_bindings where id in
    ('cb000000-0000-4000-8000-000000000075','cb000000-0000-4000-8000-000000000085')`);
