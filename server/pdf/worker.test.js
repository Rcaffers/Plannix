import test, { after } from 'node:test';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import dgram from 'node:dgram';
import { syncBuiltinESMExports } from 'node:module';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { getEventListeners } from 'node:events';
import { syntheticPdf } from './pdfFixtures.js';
// No native fetch captured when loading the extraction module.
const restore = [];
let networkCalls = 0;
for (const [object, keys] of [[globalThis, ['fetch']], [net, ['connect', 'createConnection']],
  [net.Socket.prototype, ['connect']], [http, ['request', 'get']], [https, ['request', 'get']],
  [tls, ['connect']], [dgram, ['createSocket']]]) for (const key of keys) {
  const original = object[key]; object[key] = () => { networkCalls++; throw new Error('PDF test network disabled'); };
  restore.push(() => { object[key] = original; });
}
syncBuiltinESMExports();
after(() => { assert.equal(networkCalls, 0); restore.forEach(fn => fn()); syncBuiltinESMExports(); });
const { createPdfExtractor } = await import('./extractTextFromHolidayPdf.js');

function fixture() {
  let worker, url, options;
  class Double extends EventEmitter {
    constructor(path, settings) { super(); worker = this; url = path; options = settings; this.terminated = 0; }
    async terminate() { this.terminated++; }
  }
  return { extract: createPdfExtractor({ WorkerClass: Double }), get worker() { return worker; },
    get url() { return url; }, get options() { return options; } };
}
function clean(f, signal) {
  assert.equal(f.worker.terminated, 1);
  assert.deepEqual(f.worker.eventNames(), []);
  if (signal) assert.equal(getEventListeners(signal, 'abort').length, 0);
}
const success = { text: 'Holiday', pageCount: 1 };
const safeFailure = code => error => {
  assert.equal(error.code, code); assert.equal(error.cause, undefined);
  assert.doesNotMatch(JSON.stringify(error) + error.stack, /private-pdf-content|upstream-secret/);
  return true;
};
test('fixed worker module, owned copy, empty environment, no inherited preload; success terminates', async () => {
  const f = fixture(), data = syntheticPdf(), controller = new AbortController();
  const promise = f.extract({ data, signal: controller.signal });
  assert.equal(f.url.href, new URL('./pdfWorker.js', import.meta.url).href);
  assert.deepEqual(f.options.env, {}); assert.deepEqual(f.options.execArgv, []);
  assert.deepEqual(Object.keys(f.options.workerData), ['data']);
  assert.notEqual(f.options.workerData.data.buffer, data.buffer);
  assert.deepEqual(f.options.transferList, [f.options.workerData.data.buffer]);
  assert.equal(f.options.resourceLimits.maxOldGenerationSizeMb, 128);
  f.worker.emit('message', success); f.worker.emit('exit', 0);
  assert.deepEqual(await promise, success); clean(f, controller.signal);
});
test('already cancelled and oversized input never construct a worker', async () => {
  const f = fixture(), controller = new AbortController(); controller.abort('upstream-secret');
  await assert.rejects(f.extract({ data: syntheticPdf(), signal: controller.signal }), safeFailure('PDF_CANCELLED'));
  await assert.rejects(f.extract({ data: Buffer.alloc(10 * 1024 * 1024 + 1) }), safeFailure('PDF_TOO_LARGE'));
  assert.equal(f.worker, undefined);
});
test('cancel during parsing; late result cannot win', async () => {
  const f = fixture(), controller = new AbortController();
  const promise = f.extract({ data: syntheticPdf(), signal: controller.signal });
  controller.abort('upstream-secret');
  f.worker.emit('message', success); f.worker.emit('exit', 0);
  await assert.rejects(promise, safeFailure('PDF_CANCELLED')); clean(f, controller.signal);
});
test('deadline terminates and ignores late result; timer cleared', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); const promise = f.extract({ data: syntheticPdf() });
  context.mock.timers.tick(10000);
  f.worker.emit('message', success); f.worker.emit('exit', 0);
  await assert.rejects(promise, safeFailure('PDF_TIMEOUT')); clean(f);
  context.mock.timers.tick(10000); assert.equal(f.worker.terminated, 1);
});
for (const [name, send] of [
  ['worker error', w => w.emit('error', new Error('upstream-secret'))],
  ['nonzero exit', w => { w.emit('message', success); w.emit('exit', 1); }],
  ['early exit', w => w.emit('exit', 0)],
  ['duplicate result', w => { w.emit('message', success); w.emit('message', success); }],
  ['unexpected message', w => w.emit('message', { arbitrary: 'private-pdf-content' })],
  ['extra property', w => w.emit('message', { ...success, secret: 'private-pdf-content' })],
  ['invalid page count', w => w.emit('message', { ...success, pageCount: 51 })],
  ['oversized text', w => w.emit('message', { ...success, text: 'a'.repeat(50001) })],
  ['control characters', w => w.emit('message', { ...success, text: 'a\u202e' })],
]) test(`${name} fails closed and releases worker`, async () => {
  const f = fixture(); const promise = f.extract({ data: syntheticPdf() }); send(f.worker);
  await assert.rejects(promise, safeFailure('PDF_PROCESSING_FAILED')); clean(f);
});
test('cancellation wins against an already received result before worker exit', async () => {
  const f = fixture(), controller = new AbortController();
  const promise = f.extract({ data: syntheticPdf(), signal: controller.signal });
  f.worker.emit('message', success); controller.abort(); f.worker.emit('exit', 0);
  await assert.rejects(promise, safeFailure('PDF_CANCELLED')); clean(f, controller.signal);
});
test('safe worker failure passes only taxonomy; successful settlement clears deadline', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); const promise = f.extract({ data: syntheticPdf() });
  f.worker.emit('message', { error: 'PDF_ENCRYPTED' }); f.worker.emit('exit', 0);
  await assert.rejects(promise, safeFailure('PDF_ENCRYPTED')); clean(f);
  context.mock.timers.tick(20000); assert.equal(f.worker.terminated, 1);
});
test('late events from a settled worker cannot settle a newer operation', async () => {
  const f = fixture();
  const first = f.extract({ data: syntheticPdf() }); const older = f.worker;
  older.emit('message', success); older.emit('exit', 0); await first;
  let newerSettled = false;
  const second = f.extract({ data: syntheticPdf() }).finally(() => { newerSettled = true; });
  const newer = f.worker;
  older.emit('message', { error: 'PDF_INVALID' }); older.emit('exit', 1);
  await Promise.resolve(); assert.equal(newerSettled, false);
  newer.emit('message', success); newer.emit('exit', 0);
  assert.deepEqual(await second, success); clean(f); assert.equal(older.terminated, 1);
});
test('cancellation wins while timeout cleanup is settling, exactly once', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(), controller = new AbortController();
  const promise = f.extract({ data: syntheticPdf(), signal: controller.signal });
  context.mock.timers.tick(10000); controller.abort();
  f.worker.emit('message', success);
  await assert.rejects(promise, safeFailure('PDF_CANCELLED')); clean(f, controller.signal);
});
