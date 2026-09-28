import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyLocalDocker, runMigrationTest, validateTap } from './test-academic-year-migration.js';
const tap = Array.from({ length: 17 }, (_, i) => `ok ${i + 1} - assertion`).join('\n') + '\n1..17\n';
function fixture(patch = {}) {
  const calls = [];
  const endpoint = patch.endpoint || 'unix:///var/run/docker.sock';
  const run = (_command, args) => {
    calls.push(args);
    if (args.includes('exec')) return { status: 0, stdout: tap };
    if (args[0] === 'context') return { status: 0, stdout: JSON.stringify([{ Endpoints: { docker: { Host: endpoint } } }]) };
    const row = { Id: 'a'.repeat(64), State: { Running: true }, Config: { Labels: { 'com.supabase.cli.project': 'Plannix', 'com.docker.compose.project': 'Plannix', 'com.supabase.cli.workdir': '/repo' } } };
    if (patch.stopped) row.State.Running = false;
    if (patch.wrongProject) row.Config.Labels['com.supabase.cli.project'] = 'Other';
    if (patch.wrongWorkdir) row.Config.Labels['com.supabase.cli.workdir'] = '/other';
    return { status: 0, stdout: JSON.stringify(patch.ambiguous ? [row, row] : [row]) };
  };
  return { calls, options: { project: 'Plannix', workdir: '/repo', env: patch.env || {}, run, stat: () => { if (patch.missing) throw Error('missing'); return { isSocket: () => !patch.notSocket }; }, realpath: value => value } };
}
for (const endpoint of ['unix:///var/run/docker.sock', 'unix:///Users/test/.docker/run/docker.sock']) test(`local socket accepted: ${endpoint}`, () => {
  const f = fixture({ endpoint }); const value = verifyLocalDocker(f.options);
  assert.deepEqual(value.prefix, ['--host', endpoint]); assert.equal(value.containerId, 'a'.repeat(64));
});
for (const [name, patch] of Object.entries({
  tcpHost: { env: { DOCKER_HOST: 'tcp://remote.invalid:2375' } },
  sshContext: { endpoint: 'ssh://remote.invalid' },
  httpsContext: { endpoint: 'https://remote.invalid' },
  httpContext: { endpoint: 'http://remote.invalid' },
  remoteDespiteMatchingName: { endpoint: 'tcp://remote.invalid:2375', env: { DOCKER_HOST: 'unix:///var/run/docker.sock' } },
  missingSocket: { missing: true }, nonSocket: { notSocket: true }, wrongProject: { wrongProject: true },
  wrongWorkdir: { wrongWorkdir: true }, stopped: { stopped: true }, ambiguous: { ambiguous: true },
})) test(`guard rejects ${name} before SQL`, async () => {
  const f = fixture(patch);
  assert.throws(() => verifyLocalDocker(f.options), /Local migration/);
  await assert.rejects(runMigrationTest(f.options));
  assert.equal(f.calls.some(args => args.includes('exec')), false);
});
test('unavailable context fails before any inspection or SQL', () => {
  const f = fixture(); f.options.run = () => ({ status: 1, stdout: '' }); assert.throws(() => verifyLocalDocker(f.options));
});
test('complete 17-assertion TAP accepted', () => validateTap({ status: 0, stdout: tap }));
for (const [name, stdout] of Object.entries({
  empty: '', missingPlan: tap.replace('1..17', ''), earlyPlan: '1..17\n' + tap.replace('1..17\n', ''),
  wrongCount: tap.replace('1..17', '1..18'), duplicate: tap.replace('ok 2 -', 'ok 1 -'),
  missingNumber: tap.replace('ok 2 - assertion\n', ''), outOfRange: tap.replace('ok 17 -', 'ok 18 -'),
  failure: tap.replace('ok 4 -', 'not ok 4 -'), bail: tap + 'Bail out! failed\n',
  diagnosticOnly: '# ok 1 - misleading\n1..17\n', trailing: tap + 'ok 18 - extra\n',
  duplicatePlan: tap + '1..17\n', skip: tap.replace('ok 1 - assertion', 'ok 1 - assertion # SKIP'),
})) test(`TAP rejects ${name}`, () => assert.throws(() => validateTap({ status: 0, stdout })));
test('nonzero child exit fails even with valid TAP', () => assert.throws(() => validateTap({ status: 1, stdout: tap })));
