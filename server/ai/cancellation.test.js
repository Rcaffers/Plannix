import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForOperation } from './cancellation.js';
test('non-cooperative dependency has an independent bounded deadline', async () => {
  await assert.rejects(waitForOperation(new Promise(() => {}), new AbortController().signal, 5), { code: 'AI_TIMEOUT' });
});
test('cancelled dependency consumes late rejection without exposing reason', async () => {
  const controller = new AbortController(); let reject;
  const pending = waitForOperation(new Promise((_, r) => { reject = r; }), controller.signal);
  controller.abort('private-fixture');
  await assert.rejects(pending, e => e.code === 'AI_CANCELLED' && !e.cause && !e.message.includes('private-fixture'));
  reject(Error('private-fixture'));
  await new Promise(r => setImmediate(r));
});
