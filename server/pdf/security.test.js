import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import dgram from 'node:dgram';
import { syncBuiltinESMExports } from 'node:module';
import { syntheticPdf } from './pdfFixtures.js';
const restore = [];
let calls = 0;
for (const [object, keys] of [[globalThis, ['fetch']], [net, ['connect', 'createConnection']],
  [net.Socket.prototype, ['connect']], [http, ['request', 'get']], [https, ['request', 'get']],
  [tls, ['connect']], [dgram, ['createSocket']]]) for (const key of keys) {
  const original = object[key]; object[key] = () => { calls++; throw new Error('PDF test network disabled'); };
  restore.push(() => { object[key] = original; });
}
syncBuiltinESMExports();
after(() => { assert.equal(calls, 0); restore.forEach(fn => fn()); syncBuiltinESMExports(); });
const { extractTextFromHolidayPdf } = await import('./extractTextFromHolidayPdf.js');
const { pdfError, PDF_ERROR_CODES } = await import('./pdfErrors.js');

test('real worker emits only final message, no stdout/stderr, leaves input unchanged', async () => {
  const data = new Uint8Array(syntheticPdf(['Synthetic holiday']));
  const worker = new Worker(new URL('./pdfWorker.js', import.meta.url), {
    workerData: { data }, env: {}, execArgv: [], stdout: true, stderr: true,
  });
  const messages = [], output = [];
  worker.stdout.on('data', value => output.push(value)); worker.stderr.on('data', value => output.push(value));
  worker.on('message', value => messages.push(value));
  await new Promise((resolve, reject) => { worker.once('error', reject); worker.once('exit', code => code === 0 ? resolve() : reject(new Error('worker failed'))); });
  await worker.terminate();
  assert.deepEqual(messages, [{ text: 'Synthetic holiday', pageCount: 1 }]);
  assert.deepEqual(output, []); assert.deepEqual(Buffer.from(data), syntheticPdf(['Synthetic holiday']));
});
test('real cancellation settles without content or abort reason', async () => {
  const controller = new AbortController();
  const promise = extractTextFromHolidayPdf({ data: syntheticPdf(Array(50).fill('Synthetic')), signal: controller.signal });
  controller.abort('synthetic-sensitive-reason');
  await assert.rejects(promise, error => error.code === 'PDF_CANCELLED' && !JSON.stringify(error).includes('synthetic-sensitive-reason'));
});
test('taxonomy is immutable, generic and contains no upstream causes', () => {
  for (const code of PDF_ERROR_CODES) {
    const error = pdfError(code); assert.equal(error.code, code); assert.equal(error.cause, undefined); assert.ok(Object.isFrozen(error));
  }
  assert.equal(pdfError('synthetic-sensitive-error').code, 'PDF_PROCESSING_FAILED');
});
async function sources(dir) {
  const output = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) output.push(...await sources(path));
    else if (/\.[cm]?[jt]sx?$/.test(path)) output.push([path, await readFile(path, 'utf8')]);
  }
  return output;
}
test('no client import or HTTP route exposes PDF module; PDF modules have no provider integration', async () => {
  for (const [path, source] of [...await sources('src'), ...await sources('server/routes')]) {
    assert.doesNotMatch(source, /pdfjs-dist|extractTextFromHolidayPdf|pdfWorker\.js/, path);
  }
  for (const [path, source] of await sources('server/pdf')) if (!/test|Fixtures/.test(path)) {
    assert.doesNotMatch(source, /getAiCredential|generateStructuredJson|process\.env|writeFile\(/, path);
  }
});
test('malformed PDF content and parser failures never reach worker output or errors', async () => {
  const worker = new Worker(new URL('./pdfWorker.js', import.meta.url), {
    workerData: { data: new Uint8Array(Buffer.from('%PDF-1.7\nSYNTHETIC_PRIVATE_CONTENT\nstartxref\n0\n%%EOF\n')) },
    env: {}, execArgv: [], stdout: true, stderr: true,
  });
  const messages = [], output = [];
  worker.stdout.on('data', value => output.push(value)); worker.stderr.on('data', value => output.push(value));
  worker.on('message', value => messages.push(value));
  await new Promise((resolve, reject) => { worker.once('error', reject); worker.once('exit', code => code === 0 ? resolve() : reject(new Error('worker failed'))); });
  await worker.terminate();
  assert.deepEqual(messages, [{ error: 'PDF_INVALID' }]); assert.deepEqual(output, []);
});
test('real text extraction succeeds when optional native canvas is unavailable', async () => {
  const bootstrap = `const Module=require('node:module'); const load=Module._load;
    Module._load=function(id,...args){if(id==='@napi-rs/canvas')throw new Error('Synthetic unavailable optional canvas');return load.call(this,id,...args)};
    import(${JSON.stringify(new URL('./pdfWorker.js', import.meta.url).href)});`;
  const worker = new Worker(bootstrap, { eval: true, workerData: { data: new Uint8Array(syntheticPdf()) },
    env: {}, execArgv: [], stdout: true, stderr: true });
  const messages = []; let outputBytes = 0;
  worker.stdout.on('data', value => { outputBytes += value.length; });
  worker.stderr.on('data', value => { outputBytes += value.length; });
  worker.on('message', value => messages.push(value));
  try {
    await new Promise((resolve, reject) => { worker.once('error', () => reject(new Error('Worker failed safely'))); worker.once('exit', code => code === 0 ? resolve() : reject(new Error('Worker failed safely'))); });
    assert.equal(messages.length, 1); assert.equal(messages[0].pageCount, 1);
    assert.equal(messages[0].text === 'School holiday', true); assert.equal(outputBytes, 0);
  } finally { await worker.terminate(); }
});
