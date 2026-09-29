import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { createRequireSupabaseAuth } from '../middleware/requireSupabaseAuth.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { requestId } from '../middleware/requestId.js';
import { syntheticPdf } from '../pdf/pdfFixtures.js';
const nativeFetch = globalThis.fetch;
globalThis.fetch = () => { throw Error('External network disabled in PDF route tests'); };
test.after(() => { globalThis.fetch = nativeFetch; });
const { registerAiHolidayExtractionRoutes, createHolidayExtractionRateLimit } = await import('./ai-holiday-extraction-routes.js');
const id = '91000000-0000-4000-8000-000000000001';
const dates = 'boundaryStart=2026-09-01&boundaryEnd=2027-08-31';
const input = { text: 'Synthetic calendar', academicYearStartDate: '2026-09-01', academicYearEndDate: '2027-08-31' };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
async function setup(t, overrides = {}) {
  const app = express(), calls = [], parses = [], logs = [];
  app.use(requestId);
  const requireAuth = createRequireSupabaseAuth({ getClient: () => ({ auth: { getUser: async token => token === 'invalid'
    ? { error: { status: 401 } } : { data: { user: { id: token === 'second' ? id.replace(/1$/, '2') : id, email_confirmed_at: token === 'unconfirmed' ? null : '2026-01-01' } } } } }) });
  registerAiHolidayExtractionRoutes({ app, requireAuth, rateLimit: (_q, _s, next) => next(),
    extractPdf: async ({ data, signal }) => { parses.push({ bytes: data.length, signal }); return { text: 'PRIVATE_PDF_TEXT', pageCount: 2 }; },
    generate: async (args, options) => { calls.push({ args, ...options }); return { holidays: [] }; }, ...overrides });
  app.use((error, req, res, next) => { const original = console.error; console.error = line => logs.push(line); try { errorHandler(error, req, res, next); } finally { console.error = original; } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}/api/ai/holidays/`;
  const pdf = ({ body = Buffer.from('PRIVATE_PDF_BYTES'), query = dates, token = 'confirmed', headers = {}, signal, chunked = false } = {}) => nativeFetch(`${base}extract-pdf?${query}`, {
    method: 'POST', headers: { 'Content-Type': 'application/pdf', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: chunked ? Readable.from([body.subarray(0, 13), body.subarray(13)]) : body, ...(chunked ? { duplex: 'half' } : {}), signal,
  });
  const text = (token = 'confirmed', signal) => nativeFetch(`${base}extract`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(input), signal });
  return { pdf, text, calls, parses, logs };
}
for (const [token, status] of [[null, 401], ['invalid', 401], ['unconfirmed', 403]]) test(`PDF auth ${token} precedes parser and generator`, async t => {
  const h = await setup(t); assert.equal((await h.pdf({ token })).status, status); assert.equal(h.parses.length + h.calls.length, 0);
});
test('raw success uses middleware UUID and shared signal; only suggestions/page count exposed', async t => {
  const h = await setup(t); const res = await h.pdf(); assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { holidays: [], pageCount: 2 }); assert.equal(res.headers.get('cache-control'), 'no-store'); assert.ok(res.headers.get('x-request-id'));
  assert.equal(h.calls[0].args.userId, id); assert.equal(h.calls[0].signal, h.parses[0].signal);
  assert.match(h.calls[0].args.userContent, /PRIVATE_PDF_TEXT/); assert.deepEqual(h.logs, []);
});
test('genuine isolated PDF parser composes with mocked generation, no provider network', async t => {
  const { extractTextFromHolidayPdf } = await import('../pdf/extractTextFromHolidayPdf.js');
  const h = await setup(t, { extractPdf: extractTextFromHolidayPdf }); const res = await h.pdf({ body: syntheticPdf(['Synthetic closure']) });
  assert.equal(res.status, 200); assert.deepEqual(await res.json(), { holidays: [], pageCount: 1 }); assert.match(h.calls[0].args.userContent, /Synthetic closure/);
});
for (const [options, status] of [
  [{ headers: { 'Content-Type': 'text/plain' } }, 415], [{ headers: { 'Content-Encoding': 'gzip' } }, 415], [{ body: Buffer.alloc(0) }, 400],
  ...['', `${dates}&boundaryStart=2026-09-01`, `${dates}&provider=openai`, 'boundaryStart=1800-01-01&boundaryEnd=1801-01-01', 'boundaryStart=2026-02-30&boundaryEnd=2027-01-01', 'boundaryStart=2027-01-01&boundaryEnd=2026-01-01', 'boundaryStart=2026-01-01&boundaryEnd=2029-01-01'].map(query => [{ query }, 400]),
]) test(`PDF basic rejection ${JSON.stringify(options)}`, async t => {
  const h = await setup(t); const res = await h.pdf(options); assert.equal(res.status, status); assert.equal(h.parses.length + h.calls.length, 0);
  assert.doesNotMatch(JSON.stringify([await res.json(), h.logs]), /PRIVATE_/);
});
for (const chunked of [false, true]) for (const extra of [0, 1]) test(`10 MiB ${extra ? '+1' : 'exact'} ${chunked ? 'chunked' : 'Content-Length'}`, async t => {
  const h = await setup(t); const res = await h.pdf({ body: Buffer.alloc(10 * 1024 * 1024 + extra), chunked });
  assert.equal(res.status, extra ? 413 : 200); assert.equal(h.parses.length, extra ? 0 : 1);
});
for (const [code, status] of [['PDF_INVALID', 400], ['PDF_TOO_LARGE', 413], ['PDF_ENCRYPTED', 422], ['PDF_TOO_MANY_PAGES', 422], ['PDF_NO_TEXT', 422], ['PDF_TEXT_TOO_LARGE', 413], ['PDF_TIMEOUT', 504], ['PDF_CANCELLED', 409], ['PDF_PROCESSING_FAILED', 422], ['UNKNOWN', 500]]) test(`safe PDF mapping ${code}`, async t => {
  const h = await setup(t, { extractPdf: async () => { throw Object.assign(Error('PRIVATE_PDF_BYTES PRIVATE_TEXT'), { code, cause: Error('PRIVATE_CAUSE') }); } });
  const res = await h.pdf(); assert.equal(res.status, status); assert.equal(h.calls.length, 0); assert.ok(res.headers.get('x-request-id'));
  assert.doesNotMatch(JSON.stringify([await res.json(), h.logs]), /PRIVATE_/);
});
for (const otherUser of [false, true]) test(`alternating endpoints shares ${otherUser ? 'IP' : 'user'} five-attempt budget including parser failures`, async t => {
  const h = await setup(t, { rateLimit: createHolidayExtractionRateLimit(), extractPdf: async () => { throw Object.assign(Error(), { code: 'PDF_INVALID' }); } });
  for (let i = 0; i < 5; i++) assert.equal((await (i % 2 ? h.text(otherUser ? 'second' : 'confirmed') : h.pdf())).status, i % 2 ? 200 : 400);
  const res = await h.text(); assert.equal(res.status, 429); const limited = await res.json(); assert.match(limited.message, /Too many holiday extraction attempts/); assert.equal(limited.code, 'HOLIDAY_ATTEMPT_LIMIT'); assert.ok(res.headers.get('retry-after'));
});
for (const phase of ['parser', 'provider']) for (const outcome of ['resolve', 'reject']) for (const end of ['disconnect', 'timeout']) test(`${end} during ${phase}, late ${outcome} keeps shared lock until settlement`, async t => {
  const gate = deferred(), started = deferred(); let signal, count = 0;
  const work = async args => { signal = args.signal; if (++count === 1) { started.resolve(); return gate.promise; } return phase === 'parser' ? { text: 'Synthetic', pageCount: 1 } : { holidays: [] }; };
  const h = await setup(t, { ...(end === 'timeout' ? { timeoutMs: 50 } : {}), ...(phase === 'parser' ? { extractPdf: work } : { generate: (_args, options) => work(options) }) });
  const controller = new AbortController(); const request = h.pdf({ signal: controller.signal }); const observed = request.catch(error => error);
  await started.promise;
  assert.equal((await h.text()).status, 409);
  if (end === 'disconnect') controller.abort();
  const result = await observed; if (end === 'timeout') assert.equal(result.status, 504); else assert.equal(result.name, 'AbortError');
  await tick(); assert.equal(signal.aborted, true); assert.equal((await h.text()).status, 409);
  if (outcome === 'reject') gate.reject(Error('PRIVATE_LATE_FAILURE')); else gate.resolve(phase === 'parser' ? { text: 'PRIVATE_LATE_TEXT', pageCount: 1 } : { holidays: [] });
  await tick(); assert.equal((await h.text()).status, 200); if (phase === 'parser') assert.equal(h.calls.length, 1);
  assert.doesNotMatch(JSON.stringify(h.logs), /PRIVATE_/);
});
test('text in flight blocks PDF parsing', async t => {
  const gate = deferred(), started = deferred(); const h = await setup(t, { generate: async () => { started.resolve(); return gate.promise; } });
  const request = h.text(); await started.promise; assert.equal((await h.pdf()).status, 409); assert.equal(h.parses.length, 0); gate.resolve({ holidays: [] }); await request;
});
test('cancellation after parsing while credential lookup waits prevents provider fetch', async t => {
  const { createStructuredJsonGenerator } = await import('../ai/generateStructuredJson.js');
  const gate = deferred(), started = deferred(), cancelled = deferred(); let fetches = 0;
  const generate = createStructuredJsonGenerator({ retrieveCredential: async (userId, { signal }) => { assert.equal(userId, id); signal.addEventListener('abort', () => cancelled.resolve(), { once: true }); started.resolve(); return gate.promise; }, fetchImpl: () => { fetches++; assert.fail('Provider fetch after cancellation'); } });
  const h = await setup(t, { generate }); const controller = new AbortController();
  const request = h.pdf({ signal: controller.signal }).catch(error => error); await started.promise; controller.abort(); await request; await cancelled.promise;
  gate.resolve({ provider: 'openai', apiKey: 'synthetic-credential-fixture' }); await tick(); assert.equal(fetches, 0);
});
test('invalid AI suggestions produce no partial PDF response', async t => {
  const h = await setup(t, { generate: async () => ({ holidays: [{ label: 'PRIVATE', startDate: 'bad', endDate: 'bad' }] }) });
  const res = await h.pdf(); assert.equal(res.status, 502); assert.doesNotMatch(JSON.stringify([await res.json(), h.logs]), /PRIVATE/);
});
test('basic PDF failures do not consume extraction budget; provider and local rate errors differ', async t => {
  const h = await setup(t, { rateLimit: createHolidayExtractionRateLimit() });
  for (let i = 0; i < 6; i++) assert.equal((await h.pdf({ query: '' })).status, 400);
  assert.equal((await h.pdf()).status, 200);
  const provider = await setup(t, { generate: async () => { throw Object.assign(Error('PRIVATE'), { code: 'AI_RATE_LIMITED' }); } });
  const res = await provider.pdf(); assert.equal(res.status, 429); const limited = await res.json(); assert.match(limited.message, /^AI provider rate limit/); assert.equal(limited.code, 'AI_RATE_LIMITED');
});

const { createStructuredJsonGenerator } = await import('../ai/generateStructuredJson.js');
const { retrieveAiCredential } = await import('../ai/credential.js');
const { EventEmitter, getEventListeners } = await import('node:events');
const validProviderResponse = () => new Response(JSON.stringify({ object: 'response', status: 'completed', output: [
  { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '{"holidays":[]}' }] },
] }), { headers: { 'Content-Type': 'application/json' } });
for (const phase of ['rpc', 'fetch', 'body']) for (const end of ['disconnect', 'timeout']) for (const outcome of ['resolve', 'reject']) {
  test(`actual generator ${phase}: ${end} retains both route locks until late ${outcome}`, async t => {
    const gate = deferred(), started = deferred(), aborted = deferred(), cleanup = deferred();
    let lookups = 0, fetches = 0, heldSignal, cleanupCalls = 0;
    const credential = { provider: 'openai', apiKey: 'synthetic-credential-fixture' };
    const generate = createStructuredJsonGenerator({
      retrieveCredential: (userId, options) => retrieveAiCredential(userId, { ...options,
        config: { supabaseUrl: 'http://localhost:54321', supabaseSecretKey: 'synthetic-admin-fixture' },
        createClientImpl: () => ({ rpc: () => {
          const first = ++lookups === 1;
          const rpc = first && phase === 'rpc' ? gate.promise : Promise.resolve({ data: credential });
          rpc.abortSignal = signal => {
            if (first && phase === 'rpc') { heldSignal = signal; signal.addEventListener('abort', () => aborted.resolve(), { once: true }); started.resolve(); }
            return rpc;
          };
          return rpc;
        } }),
      }),
      fetchImpl: async (_url, { signal }) => {
        const first = ++fetches === 1;
        if (first && phase !== 'rpc') {
          heldSignal = signal; signal.addEventListener('abort', () => aborted.resolve(), { once: true });
          if (phase === 'fetch') { started.resolve(); return gate.promise; }
          return { ok: true, headers: new Headers({ 'Content-Type': 'application/json' }), body: { getReader: () => ({
            read: () => { started.resolve(); return gate.promise; },
            cancel: () => { cleanupCalls++; return cleanup.promise; },
          }) } };
        }
        return validProviderResponse();
      },
    });
    const h = await setup(t, { generate, ...(end === 'timeout' ? { timeoutMs: 100 } : {}) });
    const controller = new AbortController();
    const first = (outcome === 'resolve' ? h.pdf({ signal: controller.signal }) : h.text('confirmed', controller.signal)).catch(error => error);
    await started.promise;
    if (end === 'disconnect') controller.abort();
    const response = await first;
    if (end === 'timeout') { assert.equal(response.status, 504); assert.match((await response.json()).message, /timed out/); }
    else assert.equal(response.name, 'AbortError');
    await aborted.promise;
    assert.equal((await h.text()).status, 409); assert.equal((await h.pdf()).status, 409);
    assert.equal(lookups, 1); assert.equal(fetches, phase === 'rpc' ? 0 : 1);
    assert.equal((await h.text('second')).status, 200, 'other user independent');
    if (outcome === 'reject') gate.reject(Error('PRIVATE_LATE_ERROR'));
    else gate.resolve(phase === 'rpc' ? { data: credential } : phase === 'fetch' ? validProviderResponse() : { done: true });
    await tick();
    if (phase === 'body') {
      assert.equal((await h.text()).status, 409, 'body cancellation cleanup still pending');
      cleanup.resolve(); await tick(); assert.equal(cleanupCalls, 1);
    }
    assert.equal((await h.text()).status, 200); assert.equal((await h.pdf()).status, 200);
    assert.equal(fetches, phase === 'rpc' ? 3 : 4, 'cancelled lookup never starts provider work');
    assert.equal(getEventListeners(heldSignal, 'abort').length, 0);
    assert.doesNotMatch(JSON.stringify(h.logs), /PRIVATE_|synthetic-credential/);
  });
}
test('actual PDF extractor holds lock until worker termination completes', async t => {
  const { createPdfExtractor } = await import('../pdf/extractTextFromHolidayPdf.js');
  const started = deferred(), terminating = deferred(), terminated = deferred(); let worker, lookups = 0;
  class WorkerDouble extends EventEmitter {
    constructor() { super(); worker = this; this.stdout = new EventEmitter(); this.stderr = new EventEmitter(); started.resolve(); }
    terminate() { terminating.resolve(); return terminated.promise; }
  }
  const generate = createStructuredJsonGenerator({ retrieveCredential: async () => { lookups++; return { provider: 'openai', apiKey: 'synthetic-credential-fixture' }; }, fetchImpl: async () => validProviderResponse() });
  const h = await setup(t, { extractPdf: createPdfExtractor({ WorkerClass: WorkerDouble }), generate });
  const controller = new AbortController(); const first = h.pdf({ body: syntheticPdf(), signal: controller.signal }).catch(error => error);
  await started.promise; controller.abort(); await first; await terminating.promise;
  assert.equal((await h.text()).status, 409); assert.equal((await h.pdf()).status, 409); assert.equal(lookups, 0);
  terminated.resolve(0); await tick(); assert.equal((await h.text()).status, 200); assert.equal(lookups, 1);
  assert.equal(worker.listenerCount('message') + worker.listenerCount('exit') + worker.listenerCount('error'), 0);
});
test('stale response events cannot release a newer actual-generator operation; HTTP listeners removed', async () => {
  const gates = [deferred(), deferred()]; let calls = 0;
  const generate = createStructuredJsonGenerator({ retrieveCredential: () => gates[calls++].promise, fetchImpl: () => assert.fail('Cancelled lookup reached provider') });
  let execute;
  registerAiHolidayExtractionRoutes({ app: { post(_path, ...handlers) { execute = handlers.at(-1); } }, generate, extractPdf: async () => ({ text: 'Synthetic', pageCount: 1 }) });
  const make = () => ({
    req: Object.assign(new EventEmitter(), { auth: { userId: id }, body: Buffer.from('Synthetic') }),
    res: Object.assign(new EventEmitter(), { locals: { pdfExtraction: true, holidayInput: { ...input } }, destroyed: false, json() { assert.fail('Cancelled response'); } }),
  });
  const first = make(); const firstResponse = execute(first.req, first.res, () => assert.fail('Unexpected response error'));
  await tick(); first.res.destroyed = true; first.res.emit('close'); await firstResponse;
  assert.equal(Object.hasOwn(first.req, 'body'), false);
  assert.equal(first.res.listenerCount('close') + first.req.listenerCount('aborted'), 0);
  gates[0].resolve({ provider: 'openai', apiKey: 'synthetic-credential-fixture' }); await tick();
  const second = make(); const secondResponse = execute(second.req, second.res, () => assert.fail('Unexpected response error')); await tick();
  first.res.emit('close'); first.req.emit('aborted'); gates[0].resolve(null);
  const third = make(); let conflict;
  await execute(third.req, third.res, error => { conflict = error; });
  assert.equal(conflict.statusCode, 409); assert.equal(calls, 2);
  second.res.destroyed = true; second.res.emit('close'); await secondResponse;
  gates[1].reject(Error('PRIVATE_LATE_ERROR')); await tick();
  assert.equal(second.res.listenerCount('close') + second.req.listenerCount('aborted'), 0);
});
