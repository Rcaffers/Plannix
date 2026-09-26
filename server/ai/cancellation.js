import { aiError } from './generationErrors.js';
export function checkCancellation(signal) {
  if (signal?.aborted) throw aiError('AI_CANCELLED');
}
// Observe late settlement too: cancelled non-cooperative dependencies must never
// create unhandled rejections. Only fixed errors escape, never signal.reason.
export async function waitForOperation(operation, signal, timeoutMs = 30_000) {
  let timer, cancel;
  const stopped = new Promise((_, reject) => {
    cancel = () => reject(aiError('AI_CANCELLED'));
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    timer = setTimeout(() => reject(aiError('AI_TIMEOUT')), timeoutMs);
  });
  try { return await Promise.race([operation, stopped]); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
