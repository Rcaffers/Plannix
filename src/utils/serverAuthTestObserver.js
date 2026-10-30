// Stage 4 browser fixture only. Production bundles remove these branches.
const enabled = import.meta.env?.MODE === 'stage4-app-browser-test';

export function authTestOperationId() {
  return enabled ? globalThis.crypto?.randomUUID?.() : null;
}

export function observeAuthTestOperation(event) {
  if (!enabled) return;
  try { globalThis.__plannixAuthTestObserver?.(event); }
  catch { /* Observation must not affect authentication. */ }
}
