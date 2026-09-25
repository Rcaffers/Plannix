import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiConnectionApi, connectionMetadata } from './aiConnectionApi.js';
import { AI_PROVIDERS } from '../../shared/aiProviders.js';
const key = 'fixture-personal-key-1234';
const reference = '8e6ddc18-d0d9-4fbc-a036-b02028e9f421';
for (const provider of AI_PROVIDERS) {
  test(`${provider.label}: fixed personal endpoint, methods and safe metadata`, async () => {
    const calls = [];
    const api = createAiConnectionApi({ getSession: async () => ({ access_token: 'fixture-token' }), fetchImpl: async (url, init) => {
      calls.push({ url, ...init });
      return { ok: true, headers: new Headers(), json: async () => ({ connection: init.method === 'DELETE' ? null : { provider: provider.id, providerLabel: key, lastFour: '1234', active: true } }) };
    } });
    assert.equal((await api.load()).providerLabel, provider.label);
    await api.connect({ provider: provider.id, apiKey: ` ${key} ` });
    await api.replace({ provider: provider.id, apiKey: key }); await api.disconnect();
    assert.deepEqual(calls.map(c => c.method), ['GET','POST','PUT','DELETE']);
    for (const call of calls) {
      assert.ok(call.url.endsWith('/api/ai/connection')); assert.ok(!call.url.includes(key));
      assert.equal(call.credentials, 'omit'); assert.equal(call.cache, 'no-store');
      assert.equal(call.headers.Authorization, 'Bearer fixture-token');
    }
    assert.deepEqual(JSON.parse(calls[1].body), { provider: provider.id, apiKey: key });
  });
}
test('untrusted error text is never returned; canonical reference is retained', async () => {
  const api = createAiConnectionApi({ getSession: async () => ({ access_token: 'fixture-token' }), fetchImpl: async () => ({ ok: false, status: 500,
    headers: new Headers({ 'x-request-id': reference }), json: async () => ({ message: key, vault_secret_id: key }) }) });
  await assert.rejects(api.connect({ provider: 'openai', apiKey: key }), error => error.requestId === reference && !error.message.includes(key));
  assert.throws(() => connectionMetadata({ provider: 'openai', lastFour: '1234', active: true, apiKey: key }));
  assert.throws(() => connectionMetadata({ provider: 'anything', lastFour: '1234', active: true }));
});
test('invalid keys/provider fail before network; failures do not echo input', async () => {
  const api = createAiConnectionApi({ fetchImpl: () => assert.fail('Unexpected network call') });
  for (const value of ['',null,42,'x'.repeat(4097)]) await assert.rejects(api.connect({ provider: 'openai', apiKey: value }));
  await assert.rejects(api.connect({ provider: 'other', apiKey: key }));
});
