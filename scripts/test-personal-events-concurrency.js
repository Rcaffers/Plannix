// Synthetic local-Supabase concurrency regression. No remote destination accepted.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { verifyLocalDocker } from './test-academic-year-migration.js';
import { runContendedPair } from './personal-events-race-core.js';

const workdir = fileURLToPath(new URL('..', import.meta.url));
const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');
const projects = [...config.matchAll(/^project_id\s*=\s*"([A-Za-z0-9_-]+)"\s*$/gm)];
if (projects.length !== 1) throw new Error('Local Supabase project is unavailable.');
const verified = verifyLocalDocker({ project: projects[0][1], workdir });
const psqlArgs = ['--host', verified.prefix[1], 'exec', '-i', verified.containerId,
  'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1',
  '-v', 'VERBOSITY=sqlstate', '-qAt'];
const runId = randomUUID().replaceAll('-', '');
const user = randomUUID(), org = randomUUID(), membership = randomUUID();
const [capYear, duplicateYear, revisionYear, insertFirstYear, boundaryFirstYear] =
  Array.from({ length: 5 }, () => randomUUID());
const existing = randomUUID();
const holidayA = randomUUID(), holidayB = randomUUID();
const quote = value => "'" + value + "'";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function bounded(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Synthetic database process timed out.')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function psql(sql, timeout = 10000) {
  const result = spawnSync('docker', psqlArgs, {
    input: "set statement_timeout='8s'; set lock_timeout='5s';\n" + sql,
    encoding: 'utf8', env: verified.env, timeout, maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error('Local synthetic SQL check failed.');
  return result.stdout.trim();
}

function session(name, operation, { first = false } = {}) {
  const child = spawn('docker', psqlArgs, { env: verified.env, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '', exit = null;
  const lifetime = setTimeout(() => child.kill('SIGKILL'), 25000);
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    out += chunk;
    if (out.length > 100000) child.kill('SIGKILL');
  });
  child.stderr.on('data', chunk => {
    err += chunk;
    if (err.length > 100000) child.kill('SIGKILL');
  });
  const closed = new Promise(resolve => {
    child.on('error', error => { exit = { code: -1, error }; clearTimeout(lifetime); resolve(exit); });
    child.on('close', code => { exit = { code, err }; clearTimeout(lifetime); resolve(exit); });
  });
  child.stdin.on('error', () => {});
  child.stdin.write("set application_name=" + quote(name) + ";\n"
    + "set statement_timeout='18s'; set lock_timeout='12s'; begin;\n"
    + "select 'READY';\n");
  return {
    name,
    send(command) {
      if (exit) throw new Error('Synthetic database session exited before coordination.');
      if (command === 'OPERATE') child.stdin.write(operation + ";\n"
        + (first ? "select 'OPERATED';\n" : "commit;\n\\q\n"));
      else if (command === 'COMMIT') child.stdin.end("commit;\n\\q\n");
      else throw new Error('Unknown coordination command.');
    },
    async waitFor(marker) {
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) {
        if (out.split(/\r?\n/).includes(marker)) return;
        if (exit) throw new Error('Synthetic database session failed before barrier.');
        await delay(20);
      }
      throw new Error('Synthetic database session never reached barrier.');
    },
    async waitExit() {
      await bounded(closed, 20000);
      return { ok: exit?.code === 0, err: exit?.err || '' };
    },
    stop() { if (!exit) child.kill('SIGKILL'); },
    closed,
  };
}

function observation(aName, bName) {
  return psql("select pg_catalog.json_build_object("
    + "'aPid',a.pid,'bPid',b.pid,'aName',a.application_name,'bName',b.application_name,"
    + "'bState',b.state,'waitType',b.wait_event_type,'bQuery',b.query,"
    + "'blockers',pg_catalog.pg_blocking_pids(b.pid),"
    + "'waitingLocks',(select coalesce(pg_catalog.json_agg(pg_catalog.json_build_object("
    + "'locktype',l.locktype,'granted',l.granted)),'[]'::json) "
    + "from pg_catalog.pg_locks l where l.pid=b.pid and not l.granted)) "
    + "from pg_catalog.pg_stat_activity a cross join pg_catalog.pg_stat_activity b "
    + "where a.application_name=" + quote(aName) + " and b.application_name=" + quote(bName));
}

const setup = [
  'begin',
  "insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) "
    + "values('00000000-0000-0000-0000-000000000000'," + quote(user)
    + ",'authenticated','authenticated'," + quote('fixture-' + user + '@example.test')
    + ",'',now(),'{\"provider\":\"email\",\"providers\":[\"email\"]}'::jsonb,"
    + "'{\"first_name\":\"Event\",\"last_name\":\"Fixture\"}'::jsonb,now(),now())",
  "insert into public.plannix_organisations(id,name,organisation_type) values("
    + quote(org) + ",'Concurrency fixture','personal')",
  "insert into private.plannix_personal_organisations(user_id,organisation_id) values("
    + quote(user) + ',' + quote(org) + ')',
  "insert into public.plannix_organisation_users(id,user_id,organisation_id) values("
    + quote(membership) + ',' + quote(user) + ',' + quote(org) + ')',
  "insert into public.plannix_academic_years(id,organisation_id,name,start_date,end_date) values "
    + [capYear, duplicateYear, revisionYear, insertFirstYear, boundaryFirstYear]
      .map((id, i) => '(' + quote(id) + ',' + quote(org) + ','
        + quote('Race fixture ' + i) + ",'2026-09-01','2027-08-31')").join(','),
  "insert into public.plannix_holidays(id,academic_year_id,name,start_date,end_date) values "
    + '(' + quote(holidayA) + ',' + quote(insertFirstYear) + ",'Fixture holiday','2026-12-25','2026-12-25'),"
    + '(' + quote(holidayB) + ',' + quote(boundaryFirstYear) + ",'Fixture holiday','2026-12-25','2026-12-25')",
  "insert into private.plannix_personal_events(organisation_id,academic_year_id,owner_organisation_user_id,event_date,title) "
    + 'select ' + quote(org) + ',' + quote(capYear) + ',' + quote(membership)
    + ",'2026-10-01','Bulk '||i from pg_catalog.generate_series(1,499) i",
  "insert into private.plannix_personal_events(id,organisation_id,academic_year_id,owner_organisation_user_id,event_date,title) "
    + 'values(' + quote(existing) + ',' + quote(org) + ',' + quote(revisionYear)
    + ',' + quote(membership) + ",'2026-10-01','Before')",
  'commit',
].join(';\n') + ';\n';

function asUser(sql) {
  return 'set local role authenticated; '
    + "select pg_catalog.set_config('request.jwt.claim.sub'," + quote(user) + ',true); '
    + sql;
}
function create(year, title) {
  return asUser('select public.plannix_create_personal_event(' + quote(year)
    + ",'2026-10-03'," + quote(title) + ',null,null,null,null)');
}
function update(title) {
  return asUser('select public.plannix_update_personal_event(' + quote(existing)
    + ",1,'2026-10-01'," + quote(title) + ',null,null,null,null)');
}
function boundary(year) {
  return 'update public.plannix_academic_years set start_date='
    + quote('2026-10-05') + ' where id=' + quote(year);
}
function summary(year) {
  return JSON.parse(psql('select pg_catalog.json_build_object('
    + "'start',(select start_date from public.plannix_academic_years where id=" + quote(year) + "),"
    + "'end',(select end_date from public.plannix_academic_years where id=" + quote(year) + "),"
    + "'name',(select name from public.plannix_academic_years where id=" + quote(year) + "),"
    + "'events',(select pg_catalog.count(*) from private.plannix_personal_events where academic_year_id=" + quote(year) + "),"
    + "'stranded',(select pg_catalog.count(*) from private.plannix_personal_events e "
    + "join public.plannix_academic_years y on y.id=e.academic_year_id where y.id=" + quote(year)
    + ' and e.event_date not between y.start_date and y.end_date),'
    + "'holidays',(select pg_catalog.count(*) from public.plannix_holidays where academic_year_id=" + quote(year) + '))'));
}
function intactHoliday(year, id) {
  return psql('select count(*) from public.plannix_holidays where id=' + quote(id)
    + ' and academic_year_id=' + quote(year)
    + " and name='Fixture holiday' and start_date='2026-12-25' and end_date='2026-12-25'"
    + " and holiday_type='school'") === '1';
}
async function race(label, aOperation, bOperation, expectedQuery, check) {
  const a = session('plannix_event_' + runId + '_' + label + '_a', aOperation, { first: true });
  const b = session('plannix_event_' + runId + '_' + label + '_b', bOperation);
  return runContendedPair({
    first: a, second: b, observe: () => observation(a.name, b.name), expectedQuery,
    inspect: async (aResult, bResult, block) => {
      assert.deepEqual(block.lockTypes, ['transactionid'], label + ' waits on the held row transaction');
      await check(aResult, bResult);
    },
    cleanup: async () => {
      // Exact, random application names constrain termination to this runner's two sessions.
      try {
        psql('select pg_catalog.pg_terminate_backend(pid) from pg_catalog.pg_stat_activity '
          + 'where application_name in (' + quote(a.name) + ',' + quote(b.name) + ') '
          + 'and pid <> pg_catalog.pg_backend_pid()');
      } finally {
        a.stop(); b.stop();
        await bounded(Promise.all([a.closed, b.closed]), 4000);
      }
    },
  });
}

let created = false;
try {
  created = true;
  psql(setup, 30000);
  const blocks = [];
  blocks.push(['cap', await race('cap', create(capYear, 'One'), create(capYear, 'Two'),
    'plannix_create_personal_event', async (a, b) => {
      assert.equal(a.ok, true); assert.equal(b.ok, false);
      assert.match(b.err, /P1001/);
      assert.equal(summary(capYear).events, 500);
    })]);
  blocks.push(['duplicate', await race('duplicate', create(duplicateYear, 'Same'),
    create(duplicateYear, 'same'), 'plannix_create_personal_event', async (a, b) => {
      assert.equal(a.ok, true); assert.equal(b.ok, false);
      assert.match(b.err, /23505/);
      assert.equal(summary(duplicateYear).events, 1);
    })]);
  blocks.push(['revision', await race('revision', update('First'), update('Second'),
    'plannix_update_personal_event', async (a, b) => {
      assert.equal(a.ok, true); assert.equal(b.ok, false);
      assert.match(b.err, /40001/);
      assert.equal(psql('select revision from private.plannix_personal_events where id='
        + quote(existing)), '2');
      assert.equal(psql('select title from private.plannix_personal_events where id='
        + quote(existing)), 'First');
    })]);
  blocks.push(['insert-first', await race('insert_first', create(insertFirstYear, 'Boundary'),
    boundary(insertFirstYear), 'update public.plannix_academic_years', async (a, b) => {
      assert.equal(a.ok, true); assert.equal(b.ok, false);
      assert.match(b.err, /P1002/);
      assert.deepEqual(summary(insertFirstYear), {
        start: '2026-09-01', end: '2027-08-31', name: 'Race fixture 3',
        events: 1, stranded: 0, holidays: 1,
      });
      assert.equal(intactHoliday(insertFirstYear, holidayA), true);
      assert.equal(psql('select count(*) from private.plannix_personal_events where academic_year_id='
        + quote(insertFirstYear) + " and event_date='2026-10-03' and title='Boundary'"), '1');
    })]);
  blocks.push(['boundary-first', await race('boundary_first', boundary(boundaryFirstYear),
    create(boundaryFirstYear, 'Boundary'), 'plannix_create_personal_event', async (a, b) => {
      assert.equal(a.ok, true); assert.equal(b.ok, false);
      assert.match(b.err, /22023/);
      assert.deepEqual(summary(boundaryFirstYear), {
        start: '2026-10-05', end: '2027-08-31', name: 'Race fixture 4',
        events: 0, stranded: 0, holidays: 1,
      });
      assert.equal(intactHoliday(boundaryFirstYear, holidayB), true);
    })]);
  for (const [label, block] of blocks) {
    console.log(label + ': blocker=' + block.aPid + ', waiter=' + block.bPid
      + ', wait lock=' + block.lockTypes.join(','));
  }
  console.log('Local event races: five observed lock conflicts and final states passed.');
} finally {
  if (created) {
    psql('begin; delete from public.plannix_organisations where id='
      + quote(org) + '; delete from auth.users where id=' + quote(user) + '; commit;');
    assert.equal(psql('select (select count(*) from auth.users where id=' + quote(user)
      + ') + (select count(*) from public.plannix_organisations where id=' + quote(org)
      + ') + (select count(*) from public.plannix_academic_years where organisation_id='
      + quote(org) + ') + (select count(*) from private.plannix_personal_events where organisation_id='
      + quote(org) + ')'), '0', 'only synthetic fixtures remain absent after cleanup');
  }
}
