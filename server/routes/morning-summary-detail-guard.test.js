import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import { createRequireServerSession } from '../auth/requireServerSession.js';
import { createSessionRequestSecurity } from '../auth/sessionRequestSecurity.js';
import { createMorningSummaryDetailService } from '../morningSummary/detail.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { registerMorningSummaryRoutes } from './morning-summary-routes.js';

const owner = 'cb000000-0000-4000-8000-000000000001';
const sessionId = 'cb000000-0000-4000-8000-000000000002';
const version = 'cb000000-0000-4000-8000-000000000003';
const policyVersion = 'cb000000-0000-4000-8000-000000000005';
const reference = 'cb000000-0000-4000-8000-000000000004';
const sessionName = '__Host-plannix-s-2';
const cookie = `__Host-plannix-b-1=${'a'.repeat(43)}; ${sessionName}=${'b'.repeat(43)}`;
const csrfKey = Buffer.alloc(32, 7);

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('production session guard excludes event titles removed while a detail snapshot is held', async () => {
  const arrived = deferred();
  const release = deferred();
  let eventTitleConsent = true;
  let authorizationReads = 0;
  let providerValidations = 0;
  let saved = 0;
  const app = express();
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const guard = createRequireServerSession({ origin, csrfKey,
    repository: { async resolveForApplication(header) {
      assert.equal(header, cookie);
      return { state: 'current', header, ownerId: owner, sessionId,
        sessionName, tokenVersion: 1, accessToken: 'synthetic-access' };
    } }, identity: { async validateAccess({ expectedUserId }) {
      assert.equal(expectedUserId, owner);
      providerValidations += 1;
    } },
  });
  const detail = createMorningSummaryDetailService({
    config: { supabaseUrl: 'https://example.test', supabaseSecretKey: 'synthetic',
      morningSummaryPilotUserId: owner },
    createClientImpl: () => ({ rpc: async (name, args) => {
      assert.equal(name, 'plannix_authorize_morning_summary_detail_v2');
      assert.equal(args.target_session, sessionId);
      authorizationReads += 1;
      return { data: { ownerId: owner, lessonDetailConsent:true,
        eventTitleConsent }, error: null };
    } }),
    delivery: { async resolveReference(userId, notificationRef) {
      assert.equal(userId, owner);
      assert.equal(notificationRef, reference);
      arrived.resolve();
      await release.promise;
      return { date: '2026-11-03', week: 'A', lessons: [],
        events: [{ title: 'Synthetic confidential event' }] };
    } },
  });
  // Match the production runtime's guard-to-route handoff: the verified
  // server session alone supplies the user identity exposed to routes.
  const requireAuth = (req, res, next) => guard(req, res, error => {
    if (error) return next(error);
    req.auth = { userId: req.serverSession.userId,
      accessToken: req.serverSession.accessToken };
    next();
  });
  registerMorningSummaryRoutes({ app, requireAuth, detail,
    config:{ morningSummaryDetailDisplayEnabled:true },
    service: { async saveDetail(userId, value) {
      assert.equal(userId, owner);
      assert.equal(value.eventTitleConsent, false);
      saved += 1;
      eventTitleConsent = false;
      return { ...value, revision: 2 };
    } },
  });
  app.use(errorHandler);
  const path = `${origin}/api/notifications/morning-summary/detail`;
  const headers = { Cookie: cookie, 'X-Plannix-Expected-Session': sessionName };
  let readinessTimer;
  try {
    const pending = fetch(path, { headers: { ...headers,
      'X-Plannix-Notification-Reference': reference,
      'X-Plannix-Installation-Hash': 'c'.repeat(64),
      'X-Plannix-Installation-Version': version,
      'X-Plannix-Detail-Policy-Version': policyVersion } });
    await Promise.race([arrived.promise, new Promise((_, reject) => {
      readinessTimer = setTimeout(() => reject(new Error('Detail snapshot did not reach its hold point.')), 5000);
    })]);
    clearTimeout(readinessTimer);
    assert.equal(authorizationReads, 1);
    const savedConsent = await fetch(`${origin}/api/notifications/morning-summary/detail-preferences`, {
      method: 'PUT', headers: { ...headers, Origin: origin,
        'X-Plannix-CSRF': createSessionRequestSecurity({ origin, csrfKey }).csrfFor(cookie),
        'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, academicYearId: version,
        deliveryTime: '07:00', revision: 1,
        lessonDetailConsent: true, eventTitleConsent: false }),
    });
    assert.equal(savedConsent.status, 200);
    assert.equal(saved, 1);
    release.resolve();
    const response = await pending;
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    const body = await response.json();
    assert.equal(body.eventTitlesIncluded, false);
    assert.deepEqual(body.events, []);
    assert.doesNotMatch(JSON.stringify(body), /Synthetic confidential event/);
    assert.equal(authorizationReads, 2);
    assert.equal(providerValidations, 2);
  } finally {
    clearTimeout(readinessTimer);
    release.resolve();
    await new Promise(resolve => server.close(resolve));
  }
});
