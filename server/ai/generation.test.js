import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { AI_PROVIDERS } from '../../shared/aiProviders.js';
import { AI_LIMITS } from './generationConfig.js';
import { logRouteError } from '../middleware/errorHandler.js';

// Install before dynamic import: the module-level default generator captures fetch.
const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
let blockedNetworkCalls = 0;
let expectedBlockedNetworkCalls = 0;
const networkDisabled = () => {
  blockedNetworkCalls++;
  throw new Error('Test network disabled: inject a mocked fetch implementation.');
};
Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: networkDisabled });
// Production sanitizes transport errors, so also fail the test after any unexpected
// attempt even if its caller catches the sanitized error.
test.afterEach(() => assert.equal(blockedNetworkCalls, expectedBlockedNetworkCalls,
  'Test network disabled: unexpected default fetch invocation.'));
test.after(() => {
  if (originalFetchDescriptor) Object.defineProperty(globalThis, 'fetch', originalFetchDescriptor);
  else delete globalThis.fetch;
});
const { createStructuredJsonGenerator } = await import('./generateStructuredJson.js');

const key = 'test-fixture-aaaa';
const systemPrompt = 'Private system fixture';
const userContent = 'Private content fixture';
const input = { userId: '91000000-0000-4000-8000-000000000001', systemPrompt, userContent,
  schemaName: 'test_result', jsonSchema: { type: 'object', properties: { count: { type: 'integer' } }, required: ['count'], additionalProperties: false } };
const expected = { count: 2 };
const contracts = {
  openai: { endpoint: 'https://api.openai.com/v1/responses', header: 'Authorization', auth: `Bearer ${key}`,
    body: { model: 'gpt-4.1-mini-2025-04-14', store: false, max_output_tokens: 4096,
      input: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
      text: { format: { type: 'json_schema', name: 'test_result', schema: input.jsonSchema, strict: true } } } },
  anthropic: { endpoint: 'https://api.anthropic.com/v1/messages', header: 'x-api-key', auth: key,
    body: { model: 'claude-haiku-4-5-20251001', max_tokens: 4096, system: systemPrompt,
      messages: [{ role: 'user', content: userContent }], output_config: { format: { type: 'json_schema', schema: input.jsonSchema } } } },
  google_gemini: { endpoint: 'https://generativelanguage.googleapis.com/v1beta/interactions', header: 'x-goog-api-key', auth: key,
    body: { model: 'gemini-3.8-flash', input: userContent, system_instruction: systemPrompt, store: false, stream: false,
      generation_config: { max_output_tokens: 4096, thinking_summaries: 'none' },
      response_format: { type: 'text', mime_type: 'application/json', schema: input.jsonSchema } } },
};
// Synthetic content inside documented REST envelopes, not SDK convenience fields.
const fixtures = Object.fromEntries(await Promise.all(Object.entries({
  openai: 'openai-response.json', anthropic: 'anthropic-message.json', google_gemini: 'gemini-interaction.json',
}).map(async ([provider, file]) => [provider, JSON.parse(await readFile(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'))])));
function envelope(provider, text = JSON.stringify(expected)) {
  const result = structuredClone(fixtures[provider]);
  if (provider === 'openai') result.output[0].content[0].text = text;
  else if (provider === 'anthropic') result.content[0].text = text;
  else result.steps[0].content[0].text = text;
  return result;
}
const jsonResponse = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
function harness(provider, fetchResponse = () => jsonResponse(envelope(provider)), extra = {}) {
  const lookups = [], requests = [];
  const run = createStructuredJsonGenerator({
    retrieveCredential: async id => { lookups.push(id); return { provider, apiKey: key }; },
    fetchImpl: async (url, options) => { requests.push({ url, options }); return fetchResponse(url, options); }, ...extra,
  });
  return { run, lookups, requests };
}
async function safeFailure(run, code, retryable, value = input) {
  const logs = []; const originals = {};
  for (const method of ['log','info','warn','error','debug']) { originals[method] = console[method]; console[method] = (...args) => logs.push(args); }
  try {
    await assert.rejects(run(value), error => {
      assert.equal(error.code, code); assert.equal(error.retryable, retryable);
      assert.equal(Object.hasOwn(error, 'cause'), false);
      assert.deepEqual(logs, []);
      logRouteError('ai_failed', error); // existing logger must receive only safe diagnostics
      const serialized = JSON.stringify({ ...error, message: error.message, stack: error.stack, logs });
      for (const sensitive of [key, systemPrompt, userContent, 'RAW_PROVIDER_FIXTURE']) assert.ok(!serialized.includes(sensitive));
      return true;
    });
  } finally { Object.assign(console, originals); }
}

for (const { id: provider } of AI_PROVIDERS) {
  test(`${provider}: fixed contract, validated output, fresh lookup/request`, async () => {
    const h = harness(provider);
    assert.deepEqual(await h.run(input), expected);
    assert.deepEqual(await h.run({ ...input, userContent: 'Second private fixture' }), expected);
    assert.deepEqual(h.lookups, [input.userId, input.userId]); assert.equal(h.requests.length, 2);
    const { url, options } = h.requests[0], contract = contracts[provider];
    assert.equal(url, contract.endpoint); assert.equal(new URL(url).search, '');
    assert.equal(options.headers[contract.header], contract.auth);
    assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store'); assert.equal(options.method, 'POST');
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(options.body), contract.body);
    assert.ok(!options.body.includes(key)); assert.ok(!url.includes(key));
    assert.ok(h.requests[1].options.body.includes('Second private fixture'));
    assert.ok(!h.requests[1].options.body.includes(userContent));
    if (provider === 'anthropic') assert.equal(options.headers['anthropic-version'], '2023-06-01');
    else assert.equal(options.headers['anthropic-version'], undefined);
  });
  const badBodies = [
    ['empty body', () => new Response('', { headers: { 'Content-Type': 'application/json' } })],
    ['malformed envelope JSON', () => new Response('RAW_PROVIDER_FIXTURE', { headers: { 'Content-Type': 'application/json' } })],
    ['missing content', () => jsonResponse({})],
    ['empty output', () => jsonResponse(envelope(provider, ''))],
    ['malformed output JSON', () => jsonResponse(envelope(provider, 'RAW_PROVIDER_FIXTURE'))],
    ['wrong output type', () => jsonResponse(envelope(provider, '[]'))],
    ['missing required field', () => jsonResponse(envelope(provider, '{}'))],
    ['no coercion', () => jsonResponse(envelope(provider, '{"count":"2"}'))],
    ['unknown field', () => jsonResponse(envelope(provider, '{"count":2,"extra":"RAW_PROVIDER_FIXTURE"}'))],
    ['wrong content type', () => new Response(JSON.stringify(envelope(provider)), { headers: { 'Content-Type': 'text/html' } })],
    ['missing content type', () => new Response(new Uint8Array([123,125]))],
    ['oversized advertised body', () => new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': String(AI_LIMITS.responseBytes + 1) } })],
    ['oversized streamed body', () => new Response('x'.repeat(AI_LIMITS.responseBytes + 1), { headers: { 'Content-Type': 'application/json' } })],
    ['redirect response', () => new Response(null, { status: 302, headers: { Location: 'https://example.invalid/' } })],
    ['followed redirect rejected', () => ({ redirected: true })],
  ];
  for (const [name, response] of badBodies) test(`${provider}: ${name}`, async () => {
    const h = harness(provider, response); await safeFailure(h.run, 'AI_INVALID_RESPONSE', false);
    assert.equal(h.requests.length, 1);
  });
  for (const [status, code, retryable] of [[401,'AI_CREDENTIAL_REJECTED',false],[403,'AI_CREDENTIAL_REJECTED',false],
    [429,'AI_RATE_LIMITED',true],[500,'AI_PROVIDER_UNAVAILABLE',true],[503,'AI_PROVIDER_UNAVAILABLE',true],[400,'AI_CONFIGURATION_ERROR',false]]) {
    test(`${provider}: safe HTTP ${status}, no retry`, async () => {
      const h = harness(provider, () => new Response(JSON.stringify({ message: key + systemPrompt + userContent + 'RAW_PROVIDER_FIXTURE' }), { status }));
      await safeFailure(h.run, code, retryable); assert.equal(h.requests.length, 1);
    });
  }
  test(`${provider}: timeout aborts fetch`, async () => {
    let signal;
    const h = harness(provider, (_, options) => { signal = options.signal; return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error(key)), { once: true })); }, { timeoutMs: 5 });
    await safeFailure(h.run, 'AI_TIMEOUT', true); assert.equal(signal.aborted, true);
  });
  test(`${provider}: deadline includes stalled response stream`, async () => {
    let cancelled = false;
    const h = harness(provider, () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'application/json' } }), { timeoutMs: 5 });
    await safeFailure(h.run, 'AI_TIMEOUT', true); assert.equal(cancelled, true);
  });
  test(`${provider}: network exceptions and upstream causes discarded`, async () => {
    await safeFailure(harness(provider, () => { throw new Error(key + userContent, { cause: new Error(systemPrompt) }); }).run, 'AI_PROVIDER_UNAVAILABLE', true);
  });
  test(`${provider}: echoed credential cannot escape in successful data`, async () => {
    const h = harness(provider, () => jsonResponse(envelope(provider, JSON.stringify({ value: key }))));
    await safeFailure(h.run, 'AI_INVALID_RESPONSE', false, { ...input, jsonSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } });
  });
  test(`${provider}: refusal/truncation rejected even when text parses`, async () => {
    const body = envelope(provider);
    if (provider === 'openai') body.status = 'incomplete';
    else if (provider === 'anthropic') body.stop_reason = 'max_tokens';
    else body.status = 'incomplete';
    await safeFailure(harness(provider, () => jsonResponse(body)).run, 'AI_INVALID_RESPONSE', false);
  });
}
for (const provider of ['other', '__proto__', 'constructor', null]) test(`unsupported stored provider ${provider}`, async () => {
  const h = harness(provider); await safeFailure(h.run, 'AI_CONFIGURATION_ERROR', false); assert.equal(h.requests.length, 0);
});
test('credential lookup failure never exposes raw errors or performs a provider request', async () => {
  const h = harness('openai', undefined, { retrieveCredential: async () => { throw Error(key + userContent); } });
  await safeFailure(h.run, 'AI_CREDENTIAL_UNAVAILABLE', false); assert.equal(h.requests.length, 0);
});
const invalidInputs = [
  ['invalid UUID', { ...input, userId: 'bad-id' }],
  ['untrusted model', { ...input, model: 'arbitrary' }],
  ['untrusted endpoint', { ...input, endpoint: 'https://example.invalid/' }],
  ['untrusted provider', { ...input, provider: 'openai' }],
  ['untrusted credential', { ...input, apiKey: key }],
  ['oversized user text', { ...input, userContent: 'x'.repeat(AI_LIMITS.userContentBytes + 1) }],
  ['UTF8 user byte limit', { ...input, userContent: 'é'.repeat(AI_LIMITS.userContentBytes) }],
  ['oversized system prompt', { ...input, systemPrompt: 'x'.repeat(AI_LIMITS.systemPromptBytes + 1) }],
  ['oversized schema', { ...input, jsonSchema: { ...input.jsonSchema, description: 'x'.repeat(AI_LIMITS.schemaBytes) } }],
  ['unknown schema keyword', { ...input, jsonSchema: { ...input.jsonSchema, unknownKeyword: true } }],
  ['remote reference', { ...input, jsonSchema: { ...input.jsonSchema, properties: { count: { $ref: 'https://example.invalid/schema' } } } }],
  ['async schema', { ...input, jsonSchema: { ...input.jsonSchema, $async: true } }],
  ['invalid schema name', { ...input, schemaName: '../bad' }],
];
for (const [label, value] of invalidInputs) test(`${label} rejected before credential lookup or fetch`, async () => {
  const h = harness('openai'); await safeFailure(h.run, 'AI_CONFIGURATION_ERROR', false, value);
  assert.equal(h.lookups.length, 0); assert.equal(h.requests.length, 0);
});
test('schemas are not cached across calls', async () => {
  const h = harness('openai'); assert.deepEqual(await h.run(input), expected);
  await safeFailure(h.run, 'AI_INVALID_RESPONSE', false, { ...input, jsonSchema: { ...input.jsonSchema, properties: { count: { type: 'string' } } } });
});
test('browser and shared sources do not import server AI code; no route imports generation', async () => {
  async function files(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    return (await Promise.all(entries.map(e => e.isDirectory() ? files(path.join(dir,e.name)) : path.join(dir,e.name)))).flat();
  }
  for (const file of [...await files('src'), ...await files('shared')].filter(file => /\.[cm]?[jt]sx?$/.test(file))) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /(?:server\/ai|ai\/(?:credential|adapters)|generateStructuredJson)/, file);
  }
  for (const file of ['server/app.js', ...await files('server/routes')].filter(file => file.endsWith('.js') && !file.endsWith('.test.js'))) {
    assert.doesNotMatch(await readFile(file,'utf8'), /(?:generateStructuredJson|ai\/credential|ai\/adapters)/, file);
  }
});

test('successive lookups can switch stored providers without retaining either credential', async () => {
  let lookups = 0; const calls = [];
  const run = createStructuredJsonGenerator({
    retrieveCredential: async () => (++lookups === 1 ? { provider: 'openai', apiKey: 'test-fixture-aaaa' } : { provider: 'anthropic', apiKey: 'test-fixture-bbbb' }),
    fetchImpl: async (url, options) => {
      calls.push({ url, headers: options.headers });
      return jsonResponse(envelope(url.includes('openai.com') ? 'openai' : 'anthropic'));
    },
  });
  assert.deepEqual(await run(input), expected); assert.deepEqual(await run(input), expected);
  assert.equal(lookups, 2); assert.equal(calls.length, 2);
  assert.equal(calls[0].headers.Authorization, 'Bearer test-fixture-aaaa');
  assert.equal(calls[1].headers['x-api-key'], 'test-fixture-bbbb');
  assert.equal(calls[1].headers.Authorization, undefined);
});
test('escaped credential echo is rejected too', async () => {
  const escapedKey = 'test-fixture-"aaaa';
  const h = harness('openai', () => jsonResponse(envelope('openai', JSON.stringify({ value: escapedKey }))), {
    retrieveCredential: async () => ({ provider: 'openai', apiKey: escapedKey }),
  });
  await safeFailure(h.run, 'AI_INVALID_RESPONSE', false, { ...input,
    jsonSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } });
});
test('schema cycles and excessive depth fail before credentials', async () => {
  const cyclic = { type: 'object' }; cyclic.properties = { child: cyclic };
  let deep = { type: 'string' };
  for (let i = 0; i < 22; i++) deep = { type: 'object', properties: { child: deep } };
  for (const jsonSchema of [cyclic, deep]) {
    const h = harness('openai'); await safeFailure(h.run, 'AI_CONFIGURATION_ERROR', false, { ...input, jsonSchema });
    assert.equal(h.lookups.length, 0); assert.equal(h.requests.length, 0);
  }
});

for (const { id: provider } of AI_PROVIDERS) {
  const mutations = provider === 'openai' ? [
    ['refusal content', body => { body.output[0].content = [{ type: 'refusal', refusal: 'Synthetic refusal' }]; }],
    ['incomplete details even with completed status', body => { body.incomplete_details = { reason: 'max_output_tokens' }; }],
    ['incomplete message', body => { body.output[0].status = 'incomplete'; }],
    ['missing output', body => { delete body.output; }],
    ['empty output', body => { body.output = []; }],
    ['wrong response envelope', body => { delete body.output; body.output_text = '{"count":2}'; }],
  ] : provider === 'anthropic' ? [
    ['refusal stop reason', body => { body.stop_reason = 'refusal'; }],
    ['refusal stop details with end_turn', body => { body.stop_details = { type: 'refusal', category: 'other', explanation: 'Synthetic refusal' }; }],
    ['missing content', body => { delete body.content; }],
    ['empty content', body => { body.content = []; }],
    ['wrong response envelope', body => { delete body.content; body.output_text = '{"count":2}'; }],
  ] : [
    ...['failed', 'cancelled', 'incomplete', 'in_progress', 'requires_action', 'queued', 'budget_exceeded'].map(status => [status, body => { body.status = status; }]),
    ['missing steps', body => { delete body.steps; }],
    ['empty steps', body => { body.steps = []; }],
    ['non-JSON refusal text', body => { body.steps[0].content[0].text = 'I cannot help with that request.'; }],
    ['unexpected non-text content', body => { body.steps[0].content[0] = { type: 'image', data: 'synthetic' }; }],
    ['legacy candidates envelope', body => { delete body.steps; body.candidates = [{ finishReason: 'STOP', content: { parts: [{ text: '{"count":2}' }] } }]; }],
    ['SDK output_text envelope', body => { delete body.steps; body.output_text = '{"count":2}'; }],
    ['old outputs envelope', body => { delete body.steps; body.outputs = [{ type: 'text', text: '{"count":2}' }]; }],
  ];
  for (const [label, mutate] of mutations) test(`${provider}: REST ${label} is rejected`, async () => {
    const body = envelope(provider); mutate(body);
    await safeFailure(harness(provider, () => jsonResponse(body)).run, 'AI_INVALID_RESPONSE', false);
  });
}
const unsupportedSchemas = [
  ...['minimum','maximum','exclusiveMinimum','multipleOf'].map(keyword => ({ type: 'integer', [keyword]: 1 })),
  ...['minLength','maxLength'].map(keyword => ({ type: 'string', [keyword]: 1 })),
  ...['pattern','format'].map(keyword => ({ type: 'string', [keyword]: keyword === 'format' ? 'date' : '^a$' })),
  ...['minItems','maxItems','uniqueItems','prefixItems'].map(keyword => ({ type: 'array', items: { type: 'string' }, [keyword]: keyword === 'uniqueItems' ? true : 1 })),
  { type: 'string', default: 'test' }, { type: 'string', const: 'test' },
  { type: 'object', properties: { optional: { type: 'string' } }, required: [], additionalProperties: false },
  { type: 'object', properties: {}, required: [], additionalProperties: true },
  { type: 'object', properties: {}, required: [], additionalProperties: { type: 'string' } },
  { type: 'string', anyOf: [{ type: 'string' }] }, { type: 'string', allOf: [{ type: 'string' }] },
  { type: 'string', oneOf: [{ type: 'string' }] }, { type: 'string', not: { type: 'null' } },
  { type: 'string', $ref: '#' }, { type: 'string', $defs: {} },
  { type: 'string', if: { type: 'string' }, then: { const: 'test' } },
];
for (const [index, child] of unsupportedSchemas.entries()) test(`common schema subset rejects construct ${index} before IO`, async () => {
  const h = harness('openai');
  await safeFailure(h.run, 'AI_CONFIGURATION_ERROR', false, { ...input,
    jsonSchema: { type: 'object', properties: { nested: { type: 'array', items: child } }, required: ['nested'], additionalProperties: false } });
  assert.equal(h.lookups.length, 0); assert.equal(h.requests.length, 0);
});
for (const { id: provider } of AI_PROVIDERS) test(`${provider}: common nested schema is transmitted unchanged and validated locally`, async () => {
  const jsonSchema = { type: 'object', description: 'Synthetic records', properties: {
    entries: { type: 'array', items: { type: 'object', properties: {
      label: { type: 'string', description: 'Test label' }, day: { type: ['string', 'null'] },
      kind: { type: 'string', enum: ['a','b'] }, count: { type: 'integer' }, score: { type: 'number' }, active: { type: 'boolean' }, unused: { type: 'null' },
    }, required: ['label','day','kind','count','score','active','unused'], additionalProperties: false } },
  }, required: ['entries'], additionalProperties: false };
  const value = { entries: [{ label: 'fixture', day: null, kind: 'a', count: 1, score: 1.5, active: true, unused: null }] };
  const h = harness(provider, () => jsonResponse(envelope(provider, JSON.stringify(value))));
  const before = JSON.stringify(jsonSchema);
  assert.deepEqual(await h.run({ ...input, jsonSchema }), value);
  const body = JSON.parse(h.requests[0].options.body);
  const sentSchema = provider === 'openai' ? body.text.format.schema : provider === 'anthropic' ? body.output_config.format.schema : body.response_format.schema;
  assert.deepEqual(sentSchema, jsonSchema); assert.equal(JSON.stringify(jsonSchema), before);
  value.entries[0].kind = 'invalid';
  await safeFailure(h.run, 'AI_INVALID_RESPONSE', false, { ...input, jsonSchema });
});

const closedObject = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
async function rejectedBeforeIo(jsonSchema) {
  const h = harness('openai');
  await safeFailure(h.run, 'AI_CONFIGURATION_ERROR', false, { ...input, jsonSchema });
  assert.equal(h.lookups.length, 0); assert.equal(h.requests.length, 0);
}
function enumSchema(total, shared = false) {
  const common = { type: 'string', enum: Array.from({ length: 100 }, (_, i) => String(i)) };
  return closedObject(Object.fromEntries(Array.from({ length: Math.ceil(total / 100) }, (_, i) => [
    `field${i}`, shared ? common : { type: 'string', enum: common.enum.slice(0, Math.min(100, total - i * 100)) },
  ])));
}
test('1000 aggregate enum entries accepted; 1001 rejected before IO', async () => {
  const jsonSchema = enumSchema(1000);
  const value = Object.fromEntries(Object.keys(jsonSchema.properties).map(name => [name, '0']));
  const h = harness('openai', () => jsonResponse(envelope('openai', JSON.stringify(value))));
  assert.deepEqual(await h.run({ ...input, jsonSchema }), value);
  await rejectedBeforeIo(enumSchema(1001));
});
test('nested arrays, repeated objects and unsupported definitions/composition cannot bypass enum budget', async () => {
  await rejectedBeforeIo(closedObject({ nested: { type: 'array', items: enumSchema(1001) } }));
  await rejectedBeforeIo(enumSchema(1100, true));
  const repeated = enumSchema(1000, true);
  const value = Object.fromEntries(Object.keys(repeated.properties).map(name => [name, '0']));
  assert.deepEqual(await harness('openai', () => jsonResponse(envelope('openai', JSON.stringify(value)))).run({ ...input, jsonSchema: repeated }), value);
  for (const keyword of ['$defs', 'definitions', 'anyOf', 'allOf', 'oneOf']) {
    await rejectedBeforeIo({ ...input.jsonSchema, [keyword]: keyword.endsWith('Of') ? [enumSchema(1001)] : { fixture: enumSchema(1001) } });
  }
  const cyclic = closedObject({}); cyclic.properties.child = cyclic; cyclic.required.push('child');
  await rejectedBeforeIo(cyclic);
});
for (const name of ['__proto__', 'prototype', 'constructor']) test(`dangerous property ${name} rejected recursively without prototype mutation`, async () => {
  const before = Object.getOwnPropertyDescriptors(Object.prototype);
  const dangerous = closedObject(Object.fromEntries([[name, { type: 'string' }]]));
  for (const schema of [dangerous, closedObject({ nested: { type: 'array', items: dangerous } }),
    { ...input.jsonSchema, $defs: { nested: dangerous } }, { ...input.jsonSchema, definitions: { nested: dangerous } }]) {
    await rejectedBeforeIo(schema);
  }
  assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), before);
});
test('similar ordinary property names remain accepted', async () => {
  const value = { constructorName: 'fixture', prototypeName: 'fixture', __proto__label: 'fixture' };
  const jsonSchema = closedObject(Object.fromEntries(Object.keys(value).map(name => [name, { type: 'string' }])));
  assert.deepEqual(await harness('openai', () => jsonResponse(envelope('openai', JSON.stringify(value)))).run({ ...input, jsonSchema }), value);
});
for (const { id: provider } of AI_PROVIDERS) {
  const nonResult = provider === 'openai' ? { type: 'reasoning', id: 'rs_fixture', summary: [] }
    : provider === 'anthropic' ? { type: 'thinking', thinking: 'Synthetic reasoning', signature: 'fixture' }
      : { type: 'thought', summary: [] };
  const collection = body => provider === 'openai' ? body.output : provider === 'anthropic' ? body.content : body.steps;
  for (const first of [true, false]) test(`${provider}: unique result ${first ? 'after' : 'before'} documented reasoning`, async () => {
    const body = envelope(provider); const blocks = collection(body);
    if (first) blocks.unshift(nonResult); else blocks.push(nonResult);
    assert.deepEqual(await harness(provider, () => jsonResponse(body)).run(input), expected);
  });
  for (const [label, mutate] of [
    ['zero eligible results', blocks => blocks.splice(0, blocks.length, nonResult)],
    ['two eligible results', blocks => blocks.push(structuredClone(blocks[0]))],
    ['unexpected type alongside result', blocks => blocks.push({ type: 'unknown_fixture' })],
    ['tool block not enabled by request', blocks => blocks.push({ type: 'function_call' })],
  ]) test(`${provider}: ${label} fails closed`, async () => {
    const body = envelope(provider); mutate(collection(body));
    await safeFailure(harness(provider, () => jsonResponse(body)).run, 'AI_INVALID_RESPONSE', false);
  });
  if (provider !== 'anthropic') test(`${provider}: two text blocks in one result rejected`, async () => {
    const body = envelope(provider); const content = collection(body)[0].content;
    content.push(structuredClone(content[0]));
    await safeFailure(harness(provider, () => jsonResponse(body)).run, 'AI_INVALID_RESPONSE', false);
  });
  for (const multibyte of [false, true]) test(`${provider}: accumulated ${multibyte ? 'UTF8' : 'ASCII'} chunks exceed limit and cancel`, async () => {
    let cancelled = false, pulls = 0;
    const chunk = new TextEncoder().encode('RAW_PROVIDER_FIXTURE' + key + systemPrompt + userContent + (multibyte ? 'é' : 'x').repeat(200000));
    const stream = new ReadableStream({
      pull(controller) { pulls++; controller.enqueue(chunk); },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const h = harness(provider, () => new Response(stream, { headers: { 'Content-Type': 'application/json' } }));
    await safeFailure(h.run, 'AI_INVALID_RESPONSE', false);
    assert.equal(cancelled, true);
    assert.equal(pulls, Math.floor(AI_LIMITS.responseBytes / chunk.byteLength) + 1);
    assert.equal(h.requests.length, 1);
  });
}
test('Anthropic redacted thinking is ignored without becoming output', async () => {
  const body = envelope('anthropic'); body.content.unshift({ type: 'redacted_thinking', data: 'synthetic-fixture' });
  assert.deepEqual(await harness('anthropic', () => jsonResponse(body)).run(input), expected);
});
function utf8Bytes(bytes) { return 'é'.repeat(Math.floor(bytes / 2)) + (bytes % 2 ? 'x' : ''); }
for (const [field, limit] of [['systemPrompt', AI_LIMITS.systemPromptBytes], ['userContent', AI_LIMITS.userContentBytes], ['jsonSchema', AI_LIMITS.schemaBytes]]) {
  for (const delta of [-1, 0, 1]) test(`${field}: UTF8 limit ${delta >= 0 ? '+' : ''}${delta}`, async () => {
    let value;
    if (field === 'jsonSchema') {
      value = { ...input.jsonSchema, description: '' };
      value.description = utf8Bytes(limit + delta - Buffer.byteLength(JSON.stringify(value)));
      assert.equal(Buffer.byteLength(JSON.stringify(value)), limit + delta);
    } else { value = utf8Bytes(limit + delta); assert.equal(Buffer.byteLength(value), limit + delta); }
    const h = harness('openai');
    if (delta <= 0) assert.deepEqual(await h.run({ ...input, [field]: value }), expected);
    else {
      await safeFailure(h.run, 'AI_CONFIGURATION_ERROR', false, { ...input, [field]: value });
      assert.equal(h.lookups.length, 0); assert.equal(h.requests.length, 0);
    }
  });
}

for (const { id: provider } of AI_PROVIDERS) {
  for (const failure of ['refusal', 'incomplete']) test(`${provider}: ${failure} remains rejected alongside reasoning and valid text`, async () => {
    const body = envelope(provider);
    if (provider === 'openai') {
      body.output.unshift({ type: 'reasoning', summary: [] });
      if (failure === 'refusal') body.output[1].content.push({ type: 'refusal', refusal: 'RAW_PROVIDER_FIXTURE' });
      else body.output[0].status = 'incomplete';
    } else if (provider === 'anthropic') {
      body.content.unshift({ type: 'thinking', thinking: 'fixture', signature: 'fixture' });
      if (failure === 'refusal') body.stop_details = { type: 'refusal' };
      else body.stop_reason = 'max_tokens';
    } else {
      body.steps.unshift({ type: 'thought', summary: [] });
      if (failure === 'refusal') body.steps[1].content[0].text = 'I cannot assist with that request.';
      else body.status = 'incomplete';
    }
    await safeFailure(harness(provider, () => jsonResponse(body)).run, 'AI_INVALID_RESPONSE', false);
  });
}

test('default fetch path is blocked without native fetch or network IO', async () => {
  assert.equal(globalThis.fetch, networkDisabled);
  const run = createStructuredJsonGenerator({
    retrieveCredential: async () => ({ provider: 'openai', apiKey: key }),
    // Deliberately omit fetchImpl: exercise the production default dependency.
  });
  const before = blockedNetworkCalls;
  expectedBlockedNetworkCalls++;
  await safeFailure(run, 'AI_PROVIDER_UNAVAILABLE', true);
  assert.equal(blockedNetworkCalls, before + 1);
  // The guard itself has a clear test-only diagnostic, without destinations/data.
  expectedBlockedNetworkCalls++;
  assert.throws(() => globalThis.fetch(), /Test network disabled/);
});
