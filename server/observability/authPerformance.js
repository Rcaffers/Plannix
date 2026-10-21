import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { isCanonicalRequestId } from '../middleware/requestId.js';

const requests = new AsyncLocalStorage();
const labels = new Set([
  'auth.limiter', 'auth.repository.issueBinding', 'auth.repository.resolve',
  'auth.repository.begin', 'auth.repository.settle', 'auth.repository.readTokens',
  'auth.repository.inspect', 'auth.repository.claimRefresh',
  'auth.repository.finishRefresh', 'auth.repository.releaseRefresh',
  'auth.repository.reserveCallback', 'auth.repository.attachCallback',
  'auth.repository.readyCallback', 'auth.repository.cancelCallback',
  'auth.repository.claimCallback', 'auth.repository.logout', 'auth.repository.refresh',
  'auth.tokenDecrypt', 'auth.identity.login', 'auth.identity.validateAccess',
  'auth.identity.loadCurrentUser', 'auth.identity.userValidation',
  'auth.identity.profileRead', 'auth.identity.organisationSetup',
  'membership.membershipRows', 'membership.organisations',
  'membership.assignments', 'membership.roles',
  'request.bootstrap', 'request.login', 'request.status', 'request.me',
  'request.memberships', 'request.academicYears', 'request.academicYear',
  'request.classes', 'request.layout', 'request.recurring', 'request.dated',
]);

const routes = new Map([
  ['GET /__stage3/auth/bootstrap', 'request.bootstrap'],
  ['POST /__stage3/auth/login', 'request.login'],
  ['GET /__stage3/auth/status', 'request.status'],
  ['GET /__stage3/auth/me', 'request.me'],
  ['GET /api/memberships', 'request.memberships'],
  ['GET /api/academic-years', 'request.academicYears'],
  ['GET /api/academic-year', 'request.academicYear'],
  ['GET /api/classes', 'request.classes'],
  ['GET /api/timetable/layout', 'request.layout'],
  ['GET /api/timetable/sessions/recurring', 'request.recurring'],
  ['GET /api/timetable/sessions/date', 'request.dated'],
]);

function safeTime(clock) {
  try {
    const value = clock();
    return Number.isFinite(value) ? value : null;
  } catch { return null; }
}

// A deliberately small output schema. Never add arbitrary labels or error text.
export function createAuthPerformance({ enabled = false, write = line => console.info(line),
  clock = () => performance.now() } = {}) {
  if (!enabled) return { middleware: (_req, _res, next) => next() };
  function emit(context, label, start, outcome) {
    try {
      if (!context || !labels.has(label) || start === null) return;
      const end = safeTime(context.clock);
      if (end === null || end < start) return;
      const duration = end - start;
      if (!Number.isFinite(duration)) return;
      const durationMs = Math.round(duration * 10) / 10;
      if (!Number.isFinite(durationMs)) return;
      write(JSON.stringify({ requestId:context.requestId, operation:label,
        durationMs, outcome }));
    } catch { /* Observation must never change request behavior. */ }
  }
  return { middleware(req, res, next) {
    let context, label, start;
    try {
      const requestId = isCanonicalRequestId(req.id) ? req.id : randomUUID();
      label = routes.get(`${req.method} ${req.path}`);
      start = safeTime(clock);
      context = { requestId, emit, clock };
    } catch { next(); return; }
    requests.run(context, () => {
      if (label) {
        try { res.once('finish', () => {
          try { emit(context, label, start, res.statusCode < 400 ? 'ok' : 'error'); }
          catch { /* Observation must not affect response completion. */ }
        }); }
        catch { /* Observation must not block the request. */ }
      }
      next();
    });
  } };
}

export function measureAuth(label, work) {
  const context = requests.getStore();
  if (!context || !labels.has(label)) return work();
  const start = safeTime(context.clock);
  let pending;
  try { pending = work(); }
  catch (error) { context.emit(context, label, start, 'error'); throw error; }
  if (start === null) return pending;
  return Promise.resolve(pending).then(result => {
    context.emit(context, label, start, 'ok');
    return result;
  }, error => { context.emit(context, label, start, 'error'); throw error; });
}

export function measureAuthSync(label, work) {
  const context = requests.getStore();
  if (!context || !labels.has(label)) return work();
  const start = safeTime(context.clock);
  try { const result = work(); context.emit(context, label, start, 'ok'); return result; }
  catch (error) { context.emit(context, label, start, 'error'); throw error; }
}

export function measureAuthMethods(target, prefix) {
  return Object.freeze(Object.fromEntries(Object.entries(target).map(([name, method]) => [name,
    (...args) => measureAuth(`${prefix}.${name}`, () => method(...args))])));
}
