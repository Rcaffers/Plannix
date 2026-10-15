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
let channel;
const responseGenerations = new WeakMap();
if (serverManagedAuth && typeof BroadcastChannel !== 'undefined') {
  try {
    channel = new BroadcastChannel('plannix-server-session');
    channel.onmessage = () => { csrfToken = null; accountGeneration += 1;
      globalThis.dispatchEvent?.(new Event('plannix-server-session-change')); };
  } catch { /* Server verification still owns authentication. */ }
}

export function serverSessionGeneration() { return accountGeneration; }
export function invalidateServerSessionContext() {
  csrfToken = null;
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
export function notifyServerSessionChange() {
  csrfToken = null;
  accountGeneration += 1;
  channel?.postMessage({ changed: true });
  globalThis.dispatchEvent?.(new Event('plannix-server-session-change'));
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
  const response = await fetchImpl(sameOriginUrl('/__stage3/auth/status'), {
    method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
    ...(['profile-entry','deletion-initial','deletion-reconcile'].includes(verificationPurpose)
      || (import.meta.env?.MODE === 'stage4-app-browser-test' && testOperationId)
      ? { headers: {
        ...(['profile-entry','deletion-initial','deletion-reconcile'].includes(verificationPurpose)
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
  if (!allowTransition && displayedSessionName && (!result.authenticated
    || result.sessionName !== displayedSessionName)) {
    reportSessionMismatch();
    throw new DOMException('Account changed.', 'AbortError');
  } else if (!displayedSessionName || result.sessionName === displayedSessionName) {
    csrfToken = result.csrfToken;
  }
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
  unauthenticated = false, operationContext } = {}) {
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
  if (unsafe && !bootstrapOrRecoveryMutation && !operationContext) {
    throw new DOMException('Session operation context is required.', 'AbortError');
  }
  if (operationContext) assertServerOperationContext(operationContext);
  if ((!authPath || ordinaryAuthMutation) && !displayedSessionName) {
    throw new DOMException('Your session must be confirmed before continuing.', 'AbortError');
  }
  if (unsafe && !csrfToken) {
    if (unauthenticated) await bootstrapServerSession(fetchImpl);
    else {
      const current = await status(fetchImpl,{ operationContext });
      if (!current.authenticated) throw new Error('Authentication is required.');
      if (displayedSessionName && current.sessionName !== displayedSessionName)
        throw new DOMException('Account changed.', 'AbortError');
    }
  }
  if (operationContext) assertServerOperationContext(operationContext);
  const generation = accountGeneration;
  const headers = new Headers(options.headers || {});
  headers.delete('Authorization');
  if (!authPath || ordinaryAuthMutation) headers.set('X-Plannix-Expected-Session',
    operationContext?.sessionName || displayedSessionName);
  if (unsafe) headers.set('X-Plannix-CSRF', operationContext?.csrfToken || csrfToken);
  const response = await fetchImpl(url, { ...options, method, headers,
    credentials: 'same-origin', cache: 'no-store', redirect: options.redirect || 'error' });
  responseGenerations.set(response, generation);
  if (generation !== accountGeneration) throw new DOMException('Account changed.', 'AbortError');
  if (response.status === 409 && (!authPath || ordinaryAuthMutation)) reportSessionMismatch();
  if (response.status === 401 || response.status === 403) csrfToken = null;
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
