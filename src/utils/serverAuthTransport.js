// Cookie-mode transport. This module never reads or stores a Supabase token.
import { observeAuthTestOperation } from './serverAuthTestObserver.js';
const mode = String(import.meta.env?.VITE_PLANNIX_AUTH_MODE || 'bearer').trim();
if (!['bearer', 'server'].includes(mode)) throw new Error('Authentication mode is invalid.');
export const serverManagedAuth = mode === 'server';

let csrfToken = null;
let displayedSessionName = null;
let displayedUserId = null;
let pendingMismatch = false;
let accountGeneration = 0;
let recoveryContext = null;
let statusSequence = 0;
let appliedStatusSequence = 0;
let channel;
function clearRecoveryContext(expected = recoveryContext) {
  if (!expected || recoveryContext !== expected) return;
  recoveryContext = null;
  try { globalThis.dispatchEvent?.(new Event('plannix-recovery-session-invalidated')); }
  catch { /* A listener cannot change session verification. */ }
}
const responseGenerations = new WeakMap();
if (serverManagedAuth && typeof BroadcastChannel !== 'undefined') {
  try {
    channel = new BroadcastChannel('plannix-server-session');
    channel.onmessage = () => { csrfToken = null; clearRecoveryContext(); accountGeneration += 1;
      globalThis.dispatchEvent?.(new Event('plannix-server-session-change')); };
  } catch { /* Server verification still owns authentication. */ }
}

export function serverSessionGeneration() { return accountGeneration; }
export function invalidateServerSessionContext() {
  csrfToken = null;
  clearRecoveryContext();
  accountGeneration += 1;
  pendingMismatch = true;
  return accountGeneration;
}
export function setServerSessionContext(sessionName, token, userId = null) {
  if (sessionName !== null && !/^__Host-plannix-s-[1-9]\d{0,15}$/.test(sessionName))
    throw new Error('Session context is invalid.');
  if (userId !== null && (typeof userId !== 'string' || !userId))
    throw new Error('Session context is invalid.');
  displayedSessionName = sessionName;
  displayedUserId = userId;
  csrfToken = token || null;
  if (sessionName) clearRecoveryContext();
  pendingMismatch = false;
}
export function captureServerOperationContext(expectedUserId) {
  if (!serverManagedAuth || !displayedSessionName || !displayedUserId || pendingMismatch
    || (expectedUserId !== undefined && expectedUserId !== displayedUserId)) {
    throw new DOMException('Account changed.', 'AbortError');
  }
  return Object.freeze({ sessionName: displayedSessionName, userId: displayedUserId,
    generation: accountGeneration, csrfToken });
}
export function assertServerOperationContext(context) {
  if (!context || !Object.isFrozen(context) || context.sessionName !== displayedSessionName
    || context.userId !== displayedUserId || context.generation !== accountGeneration
    || pendingMismatch) throw new DOMException('Account changed.', 'AbortError');
}
export function captureServerRecoveryContext(sessionName) {
  if (!serverManagedAuth || !recoveryContext || recoveryContext.sessionName !== sessionName)
    throw new DOMException('Recovery session changed.', 'AbortError');
  return recoveryContext;
}
function assertServerRecoveryContext(context) {
  if (!context || context !== recoveryContext || context.generation !== accountGeneration
    || displayedSessionName || pendingMismatch) {
    throw new DOMException('Recovery session changed.', 'AbortError');
  }
}
function reportSessionMismatch() {
  if (pendingMismatch) return;
  invalidateServerSessionContext();
  globalThis.dispatchEvent?.(new Event('plannix-server-session-mismatch'));
}
export function assertServerResponseCurrent(response) {
  const generation = responseGenerations.get(response);
  if (generation !== undefined && generation !== accountGeneration) {
    throw new DOMException('Account changed.', 'AbortError');
  }
}
export function notifyServerSessionChange({ reconcileThisTab = true } = {}) {
  csrfToken = null;
  clearRecoveryContext();
  accountGeneration += 1;
  try { channel?.postMessage({ changed: true }); }
  catch { /* The next server verification still owns session authority. */ }
  if (reconcileThisTab) {
    try { globalThis.dispatchEvent?.(new Event('plannix-server-session-change')); }
    catch { /* Notification failure cannot undo a completed session change. */ }
  }
}

function sameOriginUrl(input) {
  const location = globalThis.location;
  if (!location?.origin) throw new Error('Application origin is unavailable.');
  const url = new URL(input, location.origin);
  if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Cookie authentication requires a same-origin API.');
  }
  return url.toString();
}

async function readSmallJson(response) {
  if (response.status===204) return null;
  const reader=response.body?.getReader?.();
  if (!reader) throw new Error('Authentication response is invalid.');
  const chunks=[];let size=0;
  for (;;) {
    const {done,value}=await reader.read();
    assertServerResponseCurrent(response);
    if (done) break;
    size+=value.byteLength;
    if (size>16_384) { await reader.cancel().catch(()=>{});
      throw new Error('Authentication response is invalid.'); }
    chunks.push(value);
  }
  const bytes=new Uint8Array(size);let offset=0;
  for (const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
  catch { throw new Error('Authentication response is invalid.'); }
}

async function performStatus(fetchImpl = fetch, { signal, allowTransition = false,
  operationContext, verificationPurpose, testOperationId } = {}) {
  if (operationContext) assertServerOperationContext(operationContext);
  const generation = accountGeneration;
  const sequence = ++statusSequence;
  const response = await fetchImpl(sameOriginUrl('/__stage3/auth/status'), {
    method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
    ...(['profile-entry','deletion-initial','deletion-reconcile','recovery-entry'].includes(verificationPurpose)
      || (import.meta.env?.MODE === 'stage4-app-browser-test' && testOperationId)
      ? { headers: {
        ...(['profile-entry','deletion-initial','deletion-reconcile','recovery-entry'].includes(verificationPurpose)
          ? { 'X-Plannix-Verification': verificationPurpose } : {}),
        ...(import.meta.env?.MODE === 'stage4-app-browser-test' && testOperationId
          ? { 'X-Plannix-Test-Operation': testOperationId } : {}) } } : {}),
  });
  if (!response.ok) throw Object.assign(new Error('Authentication is required.'),
    { status:response.status });
  const result = await readSmallJson(response);
  if (signal?.aborted) throw new DOMException('Request cancelled.', 'AbortError');
  if (generation !== accountGeneration) throw new DOMException('Account changed.', 'AbortError');
  if (operationContext) assertServerOperationContext(operationContext);
  if (typeof result.csrfToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(result.csrfToken)) {
    throw new Error('Session verification is unavailable.');
  }
  const recovery = result.recovery === true && result.authenticated === false;
  if (recovery && (typeof result.sessionName !== 'string'
    || !/^__Host-plannix-r-[1-9]\d{0,15}$/.test(result.sessionName))) {
    throw new Error('Session verification is unavailable.');
  }
  if (sequence < appliedStatusSequence
    && (result.sessionName !== (recoveryContext?.sessionName || displayedSessionName)
      || (recovery && result.csrfToken !== recoveryContext?.csrfToken))) {
    throw new DOMException('Session verification was superseded.', 'AbortError');
  }
  appliedStatusSequence = Math.max(appliedStatusSequence, sequence);
  if (!allowTransition && displayedSessionName && (!result.authenticated
    || result.sessionName !== displayedSessionName)) {
    reportSessionMismatch();
    throw new DOMException('Account changed.', 'AbortError');
  } else if (!displayedSessionName || result.sessionName === displayedSessionName) {
    if (!recovery) csrfToken = result.csrfToken;
  }
  if (recovery && !displayedSessionName) {
    if (recoveryContext?.sessionName !== result.sessionName
      || recoveryContext.csrfToken !== result.csrfToken
      || recoveryContext.generation !== accountGeneration) {
      clearRecoveryContext();
      recoveryContext = Object.freeze({sessionName:result.sessionName,
        csrfToken:result.csrfToken,generation:accountGeneration});
    }
  } else if (!recovery) clearRecoveryContext();
  return result;
}

function status(fetchImpl = fetch, options = {}) {
  const request = performStatus(fetchImpl, options);
  if (!options.testOperationId) return request;
  return request.finally(() => observeAuthTestOperation({
    kind:'status-terminal', id:options.testOperationId }));
}

export async function serverSessionStatus(fetchImpl = fetch, options = {}) {
  return status(fetchImpl, options);
}

export async function bootstrapServerSession(fetchImpl = fetch, { signal } = {}) {
  const generation = accountGeneration;
  const response = await fetchImpl(sameOriginUrl('/__stage3/auth/bootstrap'), {
    method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
  });
  if (!response.ok) throw new Error('Authentication is unavailable.');
  const result = await readSmallJson(response);
  if (signal?.aborted || generation !== accountGeneration)
    throw new DOMException('Account changed.', 'AbortError');
  if (typeof result.csrfToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(result.csrfToken)) {
    throw new Error('Authentication is unavailable.');
  }
  if (!displayedSessionName) csrfToken = result.csrfToken;
  return result;
}

export async function serverAuthFetch(input, options = {}, { fetchImpl = fetch,
  unauthenticated = false, operationContext, recoveryOperationContext } = {}) {
  if (!serverManagedAuth) throw new Error('Cookie authentication is disabled.');
  const method = String(options.method || 'GET').toUpperCase();
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const url = sameOriginUrl(input);
  const authPath = new URL(url).pathname.startsWith('/__stage3/auth/');
  const ordinaryAuthMutation = ['/__stage3/auth/profile/name',
    '/__stage3/auth/profile/email','/__stage3/auth/profile/password',
    '/__stage3/auth/logout','/__stage3/auth/account'].includes(new URL(url).pathname);
  const bootstrapOrRecoveryMutation = ['/__stage3/auth/login','/__stage3/auth/signup',
    '/__stage3/auth/recover','/__stage3/auth/recovery/password',
    '/__stage3/auth/refresh'].includes(new URL(url).pathname);
  const recoveryMutation = new URL(url).pathname === '/__stage3/auth/recovery/password';
  if (recoveryMutation) assertServerRecoveryContext(recoveryOperationContext);
  if (unsafe && !bootstrapOrRecoveryMutation && !operationContext) {
    throw new DOMException('Session operation context is required.', 'AbortError');
  }
  if (operationContext) assertServerOperationContext(operationContext);
  if ((!authPath || ordinaryAuthMutation) && !displayedSessionName) {
    throw new DOMException('Your session must be confirmed before continuing.', 'AbortError');
  }
  if (unsafe && !csrfToken && !recoveryMutation) {
    if (unauthenticated) await bootstrapServerSession(fetchImpl);
    else {
      const current = await status(fetchImpl,{ operationContext });
      if (!current.authenticated) throw new Error('Authentication is required.');
      if (displayedSessionName && current.sessionName !== displayedSessionName)
        throw new DOMException('Account changed.', 'AbortError');
    }
  }
  if (operationContext) assertServerOperationContext(operationContext);
  if (recoveryMutation) assertServerRecoveryContext(recoveryOperationContext);
  const generation = accountGeneration;
  const headers = new Headers(options.headers || {});
  headers.delete('Authorization');
  if (!authPath || ordinaryAuthMutation) headers.set('X-Plannix-Expected-Session',
    operationContext?.sessionName || displayedSessionName);
  if (recoveryMutation) headers.set('X-Plannix-Expected-Session',
    recoveryOperationContext.sessionName);
  if (unsafe) headers.set('X-Plannix-CSRF', recoveryMutation
    ? recoveryOperationContext.csrfToken : operationContext?.csrfToken || csrfToken);
  const response = await fetchImpl(url, { ...options, method, headers,
    credentials: 'same-origin', cache: 'no-store', redirect: options.redirect || 'error' });
  responseGenerations.set(response, generation);
  // A confirmed password response is an irreversible provider result. A later local
  // session change must not turn that confirmation into a reported update failure.
  if (generation !== accountGeneration && !(recoveryMutation && response.status === 204))
    throw new DOMException('Account changed.', 'AbortError');
  if (response.status === 409 && (!authPath || ordinaryAuthMutation)) reportSessionMismatch();
  if (recoveryMutation && response.headers.get('X-Plannix-Recovery-Outcome') === 'invalid-session')
    clearRecoveryContext(recoveryOperationContext);
  if ((response.status === 401 || response.status === 403) && !recoveryMutation)
    csrfToken = null;
  return response;
}

export async function serverAuthJson(path, options = {}, settings = {}) {
  const response = await serverAuthFetch(path, options, settings);
  const payload = await readSmallJson(response);
  assertServerResponseCurrent(response);
  if (!response.ok) throw Object.assign(new Error(
    typeof payload?.message === 'string' && payload.message.length <= 180
      ? payload.message : 'Authentication request failed.'), { status: response.status });
  return payload;
}
