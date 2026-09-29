import test from 'node:test';
import assert from 'node:assert/strict';
import { setupGitHooks } from './setup-git-hooks.js';

for (const env of [{ NODE_ENV: 'production' }, { npm_config_omit: 'dev' },
  { npm_config_omit: 'optional dev' }, { npm_config_production: 'true' }]) {
  test(`production/omitted development setup skips ${Object.keys(env)[0]}`, async () => {
    assert.equal(await setupGitHooks({ env, load: () => { assert.fail('must not load or download a package'); } }), 'skipped');
  });
}
test('development installs hooks using the supported API, without subprocess/download', async () => {
  let calls = 0;
  assert.equal(await setupGitHooks({ env: {}, cwd: '/synthetic/project', load: async () => ({
    setHooksFromConfig: async (cwd, args) => { calls++; assert.equal(cwd, '/synthetic/project'); assert.deepEqual(args, []); },
  }) }), 'installed');
  assert.equal(calls, 1);
});
for (const [name, load] of [
  ['missing package', async () => { throw new Error('synthetic private upstream detail'); }],
  ['hook installation failure', async () => ({ setHooksFromConfig: async () => { throw new Error('synthetic private upstream detail'); } })],
  ['invalid module', async () => ({})],
]) test(`development ${name} fails visibly and safely`, async () => {
  await assert.rejects(setupGitHooks({ env: {}, load }), error => {
    assert.match(error.message, /Git-hook setup failed/);
    assert.doesNotMatch(error.message, /private upstream/); assert.equal(error.cause, undefined); return true;
  });
});
test('development missing Git root fails instead of silently skipping protection', async () => {
  await assert.rejects(setupGitHooks({ env: {}, load: async () => ({ getGitProjectRoot: () => undefined,
    setHooksFromConfig: () => assert.fail('must not install outside a repository') }) }), /Git-hook setup failed/);
});
