// Disposable-database HTTP proof: real repository, RPC and production guard.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import express from 'express';
import { createPrivateSessionRepository } from '../server/auth/privateSessionRepository.js';
import { createRequireServerSession } from '../server/auth/requireServerSession.js';
import { createSessionRequestSecurity } from '../server/auth/sessionRequestSecurity.js';
import { createSessionTokenCipher } from '../server/auth/sessionTokenCrypto.js';

const database = process.argv[2];
if (!/^auth_combined_[a-z0-9_]+$/.test(database || '')) throw Error('Disposable database required.');
for (const name of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG'])
  if (process.env[name]) throw Error('Docker connection overrides are forbidden.');
const run = promisify(execFile);
const container = 'supabase_db_Plannix';
const docker = async args => (await run('docker', args, { timeout: 9000, maxBuffer: 65536 })).stdout.trim();
if (await docker(['context', 'show']) !== 'desktop-linux'
  || await docker(['inspect', '--format', '{{.Name}} {{.State.Running}}', container])
    !== `/${container} true`) throw Error('Verified local Supabase container required.');
const query = sql => docker(['exec', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
  '-U', 'postgres', '-d', database, '-c', sql]);
if (await query('select count(*) from auth.users') !== '0') throw Error('Database must be empty.');
const literal = value => value == null ? 'NULL' : `'${String(typeof value === 'object'
  ? JSON.stringify(value) : value).replaceAll("'", "''")}'`;
const signatures = {
  plannix_auth_issue_binding: [['target_hash', 'text']],
  plannix_auth_begin: [['marker_name', 'text'], ['provided_marker_hash', 'text'],
    ['target_kind', 'text'], ['session_name', 'text'], ['provided_session_hash', 'text']],
  plannix_auth_settle: [['target_intent', 'uuid'], ['outcome', 'text'],
    ['confirmed_owner', 'uuid'], ['target_hash', 'text'], ['access_cipher', 'jsonb'],
    ['refresh_cipher', 'jsonb']],
  plannix_auth_select_application: [['candidates', 'jsonb']],
};
const calls = [];
const rpc = async (name, args) => {
  const fields = signatures[name];
  if (!fields || Object.keys(args).length !== fields.length) throw Error('Unexpected RPC.');
  calls.push(name);
  const inputs = fields.map(([key, type]) => `${key}=>${literal(args[key])}::${type}`).join(',');
  const output = await query(`begin;set local role service_role;
    select public.${name}(${inputs})::text;commit;`);
  return { data: JSON.parse(output) };
};
const cipher = createSessionTokenCipher({ activeKeyId: 'synthetic',
  keys: { synthetic: Buffer.alloc(32, 7) } });
const secrets = [Buffer.alloc(32, 1).toString('base64url'),
  Buffer.alloc(32, 2).toString('base64url'), Buffer.alloc(32, 3).toString('base64url')];
const repository = createPrivateSessionRepository({ rpc, cipher,
  generateSecret: () => secrets.shift() });
const owner = 'dd000000-0000-4000-8000-000000000115';
const originKey = Buffer.alloc(32, 9);
let markerHash;
let listener;
try {
  await query(`insert into auth.users(id,email,email_confirmed_at)
    values ('${owner}','combined-http@example.test',pg_catalog.now())`);
  const binding = await repository.issueBinding();
  assert.equal(binding.state, 'issued');
  const markerCookie = binding.setCookie.split(';')[0];
  const markerName = markerCookie.split('=')[0];
  markerHash = await query(`select marker_hash from private.plannix_auth_browser_bindings
    where generation=pg_catalog.substring('${markerName}','[0-9]+$')::bigint`);
  const started = await repository.begin(markerCookie);
  assert.equal(started.state, 'started');
  const settled = await repository.settle(started.intentId, 'created', {
    confirmedOwnerId: owner, accessToken: 'synthetic-access',
    refreshToken: 'synthetic-refresh',
  });
  assert.equal(settled.state, 'created');
  const sessionCookie = settled.setCookie.split(';')[0];
  const sessionName = sessionCookie.split('=')[0];
  const cookie = `${markerCookie}; ${sessionCookie}`;
  let validations = 0; let writes = 0;
  const app = express();
  listener = app.listen(0, '127.0.0.1');
  await new Promise(resolve => listener.once('listening', resolve));
  const origin = `http://127.0.0.1:${listener.address().port}`;
  app.post('/protected', createRequireServerSession({ repository,
    identity: { async validateAccess({ accessToken, expectedUserId }) {
      validations++;
      assert.equal(accessToken, 'synthetic-access');
      assert.equal(expectedUserId, owner);
    } }, origin, csrfKey: originKey }), (req, res) => {
    writes++;
    assert.equal(req.serverSession.userId, owner);
    res.json({ ok: true });
  });
  const security = createSessionRequestSecurity({ origin, csrfKey: originKey });
  const headers = { Cookie: cookie, Origin: origin, 'x-plannix-csrf': security.csrfFor(cookie),
    'x-plannix-expected-session': sessionName };
  const before = calls.length;
  assert.equal((await fetch(`${origin}/protected`, { method: 'POST', headers })).status, 200);
  assert.deepEqual(calls.slice(before), ['plannix_auth_select_application']);
  assert.equal(writes, 1); assert.equal(validations, 1);
  for (const changed of [
    { 'x-plannix-expected-session': '__Host-plannix-s-999' },
    { 'x-plannix-csrf': 'forged' },
    { Cookie: `${cookie}; ${markerCookie}` },
    { Cookie: `${markerName}=${Buffer.alloc(32, 8).toString('base64url')}; ${sessionCookie}` },
  ]) {
    const response = await fetch(`${origin}/protected`, { method: 'POST',
      headers: { ...headers, ...changed } });
    assert.ok([401, 403, 409].includes(response.status));
    assert.equal(writes, 1);
  }
  assert.equal(validations, 1);
  console.log('Combined HTTP/database guard: one RPC on valid request; rejected writes had no route effect.');
} finally {
  if (listener) await new Promise(resolve => listener.close(resolve));
  if (markerHash) await query(`delete from private.plannix_auth_browser_bindings
    where marker_hash='${markerHash}'`);
  await query(`delete from auth.users where id='${owner}'`);
}
