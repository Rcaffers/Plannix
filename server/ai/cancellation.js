import { aiError } from './generationErrors.js';
export function checkCancellation(signal) {
  if (signal?.aborted) throw aiError('AI_CANCELLED');
}
// This promise represents actual settlement, not prompt response cancellation.
// Abort requests cooperation; even an uncooperative dependency must settle before
// its owner can release a concurrency lock. HTTP response races live at the route.
export async function runOperationToSettlement(start, { signal, timeoutMs = 30_000 } = {}) {
  checkCancellation(signal);
  const controller = new AbortController();
  let reason;
  const stop = code => { if (!reason) { reason = code; controller.abort(); } };
  const cancel = () => stop('AI_CANCELLED');
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => stop('AI_TIMEOUT'), timeoutMs);
  try {
    const result = await start(controller.signal);
    if (reason) throw aiError(reason);
    checkCancellation(signal);
    return result;
  } catch (error) {
    if (reason) throw aiError(reason);
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
