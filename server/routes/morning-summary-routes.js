import express from 'express';
import { requireSupabaseAuth } from '../middleware/requireSupabaseAuth.js';
import { createMorningSummaryPreferenceService, MorningSummaryPreferenceConflict, validDeliveryTime } from '../morningSummary/preferences.js';
import { createMorningSummaryDelivery } from '../morningSummary/delivery.js';
import { createMorningSummaryDetailService } from '../morningSummary/detail.js';

const fail = (statusCode, message) => Object.assign(new Error(message), { expose: true, statusCode });
const noQuery = req => Object.keys(req.query).length === 0;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
function oneHeader(req, name) {
  const values = [];
  for (let index = 0; index < (req.rawHeaders?.length || 0); index += 2) {
    if (String(req.rawHeaders[index]).toLowerCase() === name) values.push(String(req.rawHeaders[index + 1]));
  }
  return values.length === 1 ? values[0] : null;
}

export function registerMorningSummaryRoutes({ app, requireAuth = requireSupabaseAuth,
  service = createMorningSummaryPreferenceService(), delivery = createMorningSummaryDelivery(),
  detail = createMorningSummaryDetailService() } = {}) {
  const parse = express.json({ limit: '2kb', strict: true });
  app.get('/api/notifications/morning-summary/preferences', requireAuth, async (req, res, next) => {
    try {
      if (!noQuery(req)) throw fail(400, 'Preference request is invalid.');
      res.json(await service.load(req.auth.userId));
    } catch (caught) { next(caught?.expose ? caught : fail(503, 'Could not load morning summary preferences.')); }
  });
  app.put('/api/notifications/morning-summary/preferences', requireAuth, parse, async (req, res, next) => {
    try {
      const body = req.body;
      if (!noQuery(req) || !body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).sort().join(',') !== 'academicYearId,deliveryTime,enabled,revision'
        || typeof body.enabled !== 'boolean' || !validDeliveryTime(body.deliveryTime)
        || typeof body.academicYearId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(body.academicYearId)
        || !Number.isSafeInteger(body.revision) || body.revision < 0
        || body.revision >= Number.MAX_SAFE_INTEGER) {
        throw fail(400, 'Preference request is invalid.');
      }
      res.json(await service.save(req.auth.userId, body));
    } catch (caught) { next(caught instanceof MorningSummaryPreferenceConflict
      ? fail(409, 'Morning summary preferences changed elsewhere. Reload latest before saving.')
      : caught?.expose ? caught : fail(503, 'Could not save morning summary preferences.')); }
  });
  app.get('/api/notifications/morning-summary/detail-preferences', requireAuth, async (req, res, next) => {
    try {
      if (!req.serverSession) throw fail(404, 'Notification detail is unavailable.');
      if (!noQuery(req)) throw fail(400, 'Preference request is invalid.');
      res.set('Cache-Control', 'no-store, private');
      res.json(await service.loadDetail(req.auth.userId));
    } catch (caught) { next(caught?.expose ? caught : fail(503, 'Could not load morning summary preferences.')); }
  });
  app.put('/api/notifications/morning-summary/detail-preferences', requireAuth, parse, async (req, res, next) => {
    try {
      if (!req.serverSession) throw fail(404, 'Notification detail is unavailable.');
      const body = req.body;
      if (!noQuery(req) || !body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).sort().join(',') !== 'academicYearId,deliveryTime,enabled,eventTitleConsent,lessonDetailConsent,revision'
        || typeof body.enabled !== 'boolean' || typeof body.lessonDetailConsent !== 'boolean'
        || typeof body.eventTitleConsent !== 'boolean' || !validDeliveryTime(body.deliveryTime)
        || typeof body.academicYearId !== 'string' || !UUID.test(body.academicYearId)
        || !Number.isSafeInteger(body.revision) || body.revision < 0
        || body.revision >= Number.MAX_SAFE_INTEGER) throw fail(400, 'Preference request is invalid.');
      res.set('Cache-Control', 'no-store, private');
      res.json(await service.saveDetail(req.auth.userId, body));
    } catch (caught) { next(caught instanceof MorningSummaryPreferenceConflict
      ? fail(409, 'Morning summary preferences changed elsewhere. Reload latest before saving.')
      : caught?.expose ? caught : fail(503, 'Could not save morning summary preferences.')); }
  });
  app.get('/api/notifications/morning-summary/detail', requireAuth, async (req, res, next) => {
    res.set('Cache-Control', 'no-store, private, max-age=0');
    res.set('Pragma', 'no-cache');
    res.vary('Cookie');
    try {
      if (!req.serverSession) throw fail(404, 'Notification detail is unavailable.');
      const notificationRef = oneHeader(req, 'x-plannix-notification-reference');
      const endpointHash = oneHeader(req, 'x-plannix-installation-hash');
      const installationVersion = oneHeader(req, 'x-plannix-installation-version');
      if (!noQuery(req) || !UUID.test(notificationRef || '') || !HASH.test(endpointHash || '')
        || !UUID.test(installationVersion || '')) throw fail(400, 'Notification detail request is invalid.');
      res.json(await detail.resolve({ sessionId: req.serverSession.sessionId,
        userId: req.auth.userId, endpointHash, installationVersion, notificationRef }));
    } catch (caught) { next(caught?.expose ? caught : fail(404, 'Notification detail is unavailable.')); }
  });
  app.get('/api/notifications/morning-summary/day', requireAuth, async (req, res, next) => {
    try {
      if (Object.keys(req.query).join(',') !== 'summaryRef'
        || typeof req.query.summaryRef !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(req.query.summaryRef))
        throw fail(400, 'Daily summary request is invalid.');
      res.json(await delivery.resolveReference(req.auth.userId, req.query.summaryRef));
    } catch (caught) { next(caught?.expose ? caught : fail(503, 'Daily summary is unavailable.')); }
  });
}
