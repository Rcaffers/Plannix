import test from 'node:test';
import assert from 'node:assert/strict';
import { retrieveAiCredential } from './credential.js';
import { providerRegistry } from './providers.js';
const id = '91000000-0000-4000-8000-000000000001';
const credential = 'fixture-internal-credential-1234';
const config = { supabaseUrl: 'http://localhost:54321', supabaseSecretKey: 'fixture-admin-key' };
test('invalid IDs are rejected before client creation', async () => {
  for (const value of [null, undefined, '', {}, id.toUpperCase().replace('000001','00000A'), ' '+id, 'another-user']) {
    await assert.rejects(retrieveAiCredential(value, { createClientImpl: () => assert.fail('client created') }), /^Error: AI credential unavailable\.$/);
  }
});
for (const provider of Object.keys(providerRegistry)) {
  test(`${provider}: scoped RPC, fresh retrieval and no cached secret`, async () => {
    let calls=0, clients=0;
    const options = { config, createClientImpl(url,key,settings) {
      clients++; assert.equal(url,config.supabaseUrl); assert.equal(key,config.supabaseSecretKey);
      assert.deepEqual(settings.auth,{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false});
      return { async rpc(name,args) {
        assert.equal(name,'plannix_get_server_ai_credential'); assert.deepEqual(args,{validated_user_id:id});
        calls++; return {data:{provider,apiKey:credential+calls,ignored:'private'}};
      }};
    }};
    assert.deepEqual(await retrieveAiCredential(id,options),{provider,apiKey:credential+'1'});
    assert.deepEqual(await retrieveAiCredential(id,options),{provider,apiKey:credential+'2'});
    assert.equal(calls,2); assert.equal(clients,2);
  });
}
test('missing, unsupported and failing responses are safe and never logged', async () => {
  const logs=[]; const originals={};
  for (const method of ['log','warn','error','info','debug']) { originals[method]=console[method]; console[method]=(...args)=>logs.push(args); }
  try {
    for (const result of [{data:null},{data:{provider:'other',apiKey:credential}},
      {data:{provider:'openai',apiKey:''}}, {error:{message:credential,details:credential}},
      new Error(credential)]) {
      await assert.rejects(retrieveAiCredential(id,{config,createClientImpl:()=>({rpc:async()=>{
        if(result instanceof Error) throw result; return result;
      }})}),error=>error.message==='AI credential unavailable.' && !error.cause && !String(error.stack).includes(credential));
    }
    assert.deepEqual(logs,[]);
  } finally { Object.assign(console,originals); }
});

const malformedResults = [
  ['undefined response', undefined],
  ['missing provider', { data: { apiKey: credential } }],
  ['missing credential', { data: { provider: 'openai' } }],
  ['wrong provider type', { data: { provider: { value: credential }, apiKey: credential } }],
  ['wrong credential type', { data: { provider: 'openai', apiKey: { value: credential } } }],
  ['empty credential', { data: { provider: 'openai', apiKey: '' } }],
  ['whitespace credential', { data: { provider: 'openai', apiKey: ' \t\n ' } }],
  ['oversized credential', { data: { provider: 'openai', apiKey: credential.repeat(200) } }],
];
for (const [label, malformed] of malformedResults) {
  test(`${label}: fails closed without logging or caching`, async () => {
    const logs = [], originals = {};
    let calls = 0, clients = 0;
    const options = { config, createClientImpl: () => {
      clients++;
      return { rpc: async () => {
        calls++;
        // A failure between two successes must not reuse either cached value.
        if (calls === 2) return malformed;
        return { data: { provider: 'openai', apiKey: credential + calls } };
      } };
    } };
    for (const method of ['log', 'warn', 'error', 'info', 'debug']) {
      originals[method] = console[method]; console[method] = (...args) => logs.push(args);
    }
    try {
      assert.deepEqual(await retrieveAiCredential(id, options), { provider: 'openai', apiKey: credential + '1' });
      await assert.rejects(retrieveAiCredential(id, options), error => {
        assert.equal(error.message, 'AI credential unavailable.');
        assert.equal(Object.hasOwn(error, 'cause'), false);
        assert.ok(!String(error.stack).includes('fixture-internal'));
        assert.equal(JSON.stringify(error), '{}');
        return true;
      });
      assert.deepEqual(await retrieveAiCredential(id, options), { provider: 'openai', apiKey: credential + '3' });
      assert.equal(calls, 3); assert.equal(clients, 3);
      assert.deepEqual(logs, []);
    } finally { Object.assign(console, originals); }
  });
}
