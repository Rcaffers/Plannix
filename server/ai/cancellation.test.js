import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { runOperationToSettlement } from './cancellation.js';
for (const reason of ['cancel', 'timeout']) for (const outcome of ['resolve', 'reject']) test(`${reason}: tracks late ${outcome} and cleans listeners`, async () => {
  const controller = new AbortController(); let resolve, reject, signal, settled = false;
  const underlying = new Promise((a, b) => { resolve = a; reject = b; });
  const operation = runOperationToSettlement(s => { signal = s; return underlying; }, { signal: controller.signal, timeoutMs: reason === 'timeout' ? 5 : 30000 });
  void operation.catch(() => {}).finally(() => { settled = true; });
  if (reason === 'cancel') controller.abort('private-fixture');
  await new Promise(r => setTimeout(r, 15));
  assert.equal(signal.aborted, true); assert.equal(settled, false);
  if (outcome === 'resolve') resolve('private-fixture'); else reject(Error('private-fixture'));
  await assert.rejects(operation, e => e.code === (reason === 'cancel' ? 'AI_CANCELLED' : 'AI_TIMEOUT') && !e.cause && !e.message.includes('private-fixture'));
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});
test('pre-cancellation prevents starting and normal completion removes listeners', async () => {
  const controller = new AbortController();
  assert.equal(await runOperationToSettlement(async () => 42, { signal: controller.signal }), 42);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  controller.abort();
  await assert.rejects(runOperationToSettlement(() => assert.fail('started'), { signal: controller.signal }), { code: 'AI_CANCELLED' });
});
