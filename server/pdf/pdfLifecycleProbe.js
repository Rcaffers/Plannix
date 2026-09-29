// Isolated test process. It emits only a summary, never document/error contents.
import assert from 'node:assert/strict';
import { Worker, MessageChannel } from 'node:worker_threads';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { syntheticPdf } from './pdfFixtures.js';
globalThis.fetch = () => { throw new Error('Test network disabled'); };
for (const [object, names] of [[net, ['connect', 'createConnection']], [net.Socket.prototype, ['connect']],
  [http, ['request', 'get']], [https, ['request', 'get']]]) for (const name of names) object[name] = globalThis.fetch;
syncBuiltinESMExports();
const { createPdfExtractor } = await import('./extractTextFromHolidayPdf.js');
const records = [];
let mode = 'normal', controller;
class ObservedWorker extends Worker {
  constructor(path, options) {
    assert.equal(path.href, new URL('./pdfWorker.js', import.meta.url).href);
    const { port1, port2 } = new MessageChannel();
    // Observe entry into the real worker's page stream, not just worker startup.
    // The optional busy loop is test-only and exercises real native termination.
    const bootstrap = `
      import { workerData } from 'node:worker_threads';
      const port = workerData.observer; const mode = workerData.mode;
      delete workerData.observer; delete workerData.mode;
      const original = ReadableStream.prototype.getReader;
      let observed = false;
      ReadableStream.prototype.getReader = function(...args) {
        const reader = original.apply(this, args);
        if (!observed && new Error().stack.includes('pdfWorker.js')) {
          observed = true; port.postMessage('parsing');
          if (mode === 'timeout') reader.read = () => { while (true) {} };
          if (mode === 'cancel') reader.read = () => new Promise(() => {});
        }
        return reader;
      };
      await import(${JSON.stringify(path.href)});
      port.close();
    `;
    super(new URL(`data:text/javascript,${encodeURIComponent(bootstrap)}`), {
      ...options, workerData: { ...options.workerData, observer: port2, mode },
      transferList: [...options.transferList, port2],
    });
    this.record = { worker: this, terminalMessages: 0, terminated: 0, parsing: false, exitCode: null };
    records.push(this.record);
    this.observeTerminal = message => { assert.ok(message && (message.error || typeof message.text === 'string')); this.record.terminalMessages++; };
    this.on('message', this.observeTerminal);
    this.once('exit', code => { this.record.exitCode = code; port1.removeAllListeners(); port1.close(); });
    port1.on('message', event => { assert.equal(event, 'parsing'); this.record.parsing = true; if (mode === 'cancel') controller.abort('synthetic reason'); });
  }
  async terminate() { this.record.terminated++; const result = await super.terminate(); this.removeListener('message', this.observeTerminal); return result; }
}
const extract = createPdfExtractor({ WorkerClass: ObservedWorker });
const stress = syntheticPdf([''], { textOperations: 120000 });
for (let round = 0; round < 2; round++) {
  mode = 'normal';
  assert.equal((await extract({ data: syntheticPdf() })).pageCount, 1);
  await assert.rejects(extract({ data: Buffer.from('%PDF-1.7\ninvalid\nstartxref\n0\n%%EOF\n') }), { code: 'PDF_INVALID' });
  await assert.rejects(extract({ data: stress }), { code: 'PDF_PROCESSING_FAILED' });
  assert.equal(records.at(-1).terminalMessages, 1);
  assert.equal(records.at(-1).exitCode, 0);
  mode = 'cancel'; controller = new AbortController();
  await assert.rejects(extract({ data: syntheticPdf(), signal: controller.signal }), { code: 'PDF_CANCELLED' });
  assert.ok(records.at(-1).parsing);
  mode = 'timeout';
  await assert.rejects(extract({ data: syntheticPdf() }), { code: 'PDF_TIMEOUT' });
  assert.ok(records.at(-1).parsing);
  mode = 'normal';
  assert.equal((await extract({ data: syntheticPdf() })).pageCount, 1);
}
await new Promise(resolve => setImmediate(resolve));
await new Promise(resolve => setImmediate(resolve));
for (const record of records) {
  assert.equal(record.worker.threadId, -1);
  assert.equal(record.terminated, 1);
  assert.ok(record.terminalMessages <= 1);
  assert.equal(record.worker.listenerCount('message'), 0);
  assert.equal(record.worker.listenerCount('error'), 0);
  assert.equal(record.worker.listenerCount('exit'), 0);
}
assert.deepEqual(process.getActiveResourcesInfo().filter(type => ['MessagePort', 'Timeout'].includes(type)), []);
console.log(JSON.stringify({ operations: records.length, stressOperations: 120000, clean: true }));
