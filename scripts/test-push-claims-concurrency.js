// Run only against a newly created, empty disposable local push_review_* database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { verifyLocalDocker } from './test-academic-year-migration.js';
import { runContendedPair } from './personal-events-race-core.js';

const database = process.env.PUSH_TEST_DATABASE;
if (!/^push_review_[a-z0-9_]+$/.test(database || '')) throw Error('Disposable push test database required.');
const workdir = fileURLToPath(new URL('..', import.meta.url));
const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');
const project = [...config.matchAll(/^project_id\s*=\s*"([A-Za-z0-9_-]+)"\s*$/gm)];
if (project.length !== 1) throw Error('Verified local Supabase project required.');
const verified = verifyLocalDocker({ project: project[0][1], workdir });
const args = [...verified.prefix, 'exec', '-i', verified.containerId,
  'psql', '-X', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt'];
const quote = value => "'" + value + "'";
const runId = randomUUID().replaceAll('-', '');
const users = [randomUUID(), randomUUID()];
const hashes = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function sql(query) {
  const result = spawnSync('docker', args, { input: "set statement_timeout='6s';set lock_timeout='4s';\n" + query,
    encoding: 'utf8', env: verified.env, timeout: 9000, maxBuffer: 100000 });
  if (result.error || result.status !== 0) throw Error('Disposable push database operation failed.');
  return result.stdout.trim();
}
if (sql('select count(*) from auth.users') !== '0') throw Error('Disposable push database must be empty.');

function session(name, operation, first) {
  const child = spawn('docker', args, { env: verified.env, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', exit;
  const deadline = setTimeout(() => child.kill('SIGKILL'), 16000);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => { output += chunk; if (output.length > 10000) child.kill('SIGKILL'); });
  child.stderr.on('data', chunk => { if (chunk.length > 10000) child.kill('SIGKILL'); });
  const closed = new Promise(resolve => {
    child.on('error', () => { exit = { ok: false, output }; clearTimeout(deadline); resolve(); });
    child.on('close', code => { exit = { ok: code === 0, output }; clearTimeout(deadline); resolve(); });
  });
  child.stdin.on('error', () => {});
  child.stdin.write("set application_name=" + quote(name)
    + ";set statement_timeout='12s';set lock_timeout='9s';begin;set local role service_role;select 'READY';\n");
  return {
    name, closed,
    send(command) {
      if (exit) throw Error('Database session exited before coordination.');
      if (command === 'OPERATE') child.stdin.write(operation + ";\n" + (first ? "select 'OPERATED';\n" : 'commit;\n\\q\n'));
      else if (command === 'COMMIT') child.stdin.end('commit;\n\\q\n');
      else throw Error('Unexpected barrier command.');
    },
    async waitFor(marker) {
      const until = Date.now() + 6000;
      while (Date.now() < until) {
        if (output.split(/\r?\n/).includes(marker)) return;
        if (exit) throw Error('Database session failed before barrier.');
        await pause(20);
      }
      throw Error('Database barrier timed out.');
    },
    async waitExit() {
      await Promise.race([closed, pause(13000).then(() => { throw Error('Database child timed out.'); })]);
      return exit;
    },
    stop() { if (!exit) child.kill('SIGKILL'); },
  };
}

function observation(a, b) {
  return sql("select json_build_object('aPid',a.pid,'bPid',b.pid,'aName',a.application_name,"
    + "'bName',b.application_name,'bState',b.state,'waitType',b.wait_event_type,'bQuery',b.query,"
    + "'blockers',pg_blocking_pids(b.pid),'waitingLocks',(select coalesce(json_agg(json_build_object("
    + "'locktype',l.locktype,'granted',l.granted)),'[]'::json) from pg_locks l where l.pid=b.pid and not l.granted)) "
    + 'from pg_stat_activity a cross join pg_stat_activity b where a.application_name='
    + quote(a) + ' and b.application_name=' + quote(b));
}
function claim(user, hash) {
  return "select case when (public.plannix_push_claim_test(" + quote(user) + ',' + quote(hash)
    + ")->>'rateLimited')='true' then 'limited' else 'claimed' end";
}
async function race(label, user, firstHash, secondHash) {
  const a = session('push_' + runId + '_' + label + '_a', claim(user, firstHash), true);
  const b = session('push_' + runId + '_' + label + '_b', claim(user, secondHash), false);
  return runContendedPair({ first: a, second: b, observe: () => observation(a.name, b.name),
    expectedQuery: 'plannix_push_claim_test',
    inspect: async (aResult, bResult, block) => {
      assert.deepEqual(block.lockTypes, ['transactionid']);
      assert.equal(aResult.ok, true); assert.equal(bResult.ok, true);
      assert.match(aResult.output, /(?:^|\n)claimed(?:\n|$)/);
      assert.match(bResult.output, /(?:^|\n)limited(?:\n|$)/);
      assert.equal(sql('select count(*) from private.plannix_push_subscriptions where user_id='
        + quote(user) + ' and last_test_at is not null'), '1');
    },
    cleanup: async () => {
      try { sql('select pg_terminate_backend(pid) from pg_stat_activity where application_name in ('
        + quote(a.name) + ',' + quote(b.name) + ') and pid <> pg_backend_pid()'); }
      finally { a.stop(); b.stop(); await Promise.all([a.closed, b.closed]); }
    },
  });
}

async function ordinaryRemovalRace() {
  const user = users[0], hash = hashes[0];
  const oldVersion = sql('select subscription_version from private.plannix_push_subscriptions where endpoint_hash=' + quote(hash));
  const replace = 'select public.plannix_push_register_device(' + quote(user) + ',' + quote(hash) + ','
    + quote('https://fcm.googleapis.com/fcm/send/fixture-0') + ',' + quote('r'.repeat(87))
    + ',' + quote('s'.repeat(22)) + ')';
  const remove = 'select public.plannix_push_remove_device(' + quote(user) + ',' + quote(hash)
    + ',' + quote(oldVersion) + ')';
  const a = session('push_' + runId + '_replace_a', replace, true);
  const b = session('push_' + runId + '_remove_b', remove, false);
  return runContendedPair({ first: a, second: b, observe: () => observation(a.name, b.name),
    expectedQuery: 'plannix_push_remove_device',
    inspect: async (aResult, bResult, block) => {
      assert.deepEqual(block.lockTypes, ['transactionid']);
      assert.equal(aResult.ok, true); assert.equal(bResult.ok, true);
      assert.match(bResult.output, /(?:^|\n)f(?:\n|$)/);
      assert.notEqual(sql('select subscription_version from private.plannix_push_subscriptions where endpoint_hash='
        + quote(hash)), oldVersion);
      assert.equal(sql('select p256dh from private.plannix_push_subscriptions where endpoint_hash='
        + quote(hash)), 'r'.repeat(87));
    },
    cleanup: async () => {
      try { sql('select pg_terminate_backend(pid) from pg_stat_activity where application_name in ('
        + quote(a.name) + ',' + quote(b.name) + ') and pid <> pg_backend_pid()'); }
      finally { a.stop(); b.stop(); await Promise.all([a.closed, b.closed]); }
    },
  });
}

try {
  for (const user of users) sql("insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,"
    + "raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values('00000000-0000-0000-0000-000000000000',"
    + quote(user) + ",'authenticated','authenticated'," + quote('push-race-' + user + '@example.test')
    + ",'',now(),'{}','{}',now(),now())");
  for (const [index, hash] of hashes.entries()) {
    const owner = index === 0 ? users[0] : users[1];
    sql('select public.plannix_push_register_device(' + quote(owner) + ',' + quote(hash) + ','
      + quote('https://fcm.googleapis.com/fcm/send/fixture-' + index) + ','
      + quote('p'.repeat(87)) + ',' + quote('q'.repeat(22)) + ')');
  }
  await race('same', users[0], hashes[0], hashes[0]);
  await race('devices', users[1], hashes[1], hashes[2]);
  await ordinaryRemovalRace();
  console.log('Three genuinely blocked push races passed in the disposable local database.');
} finally {
  for (const user of users) {
    try { sql('delete from auth.users where id=' + quote(user)); }
    catch { /* A failed assertion still leaves only random synthetic fixtures in this disposable database. */ }
  }
}
