import express from 'express';
import { requireSupabaseAuth } from '../middleware/requireSupabaseAuth.js';
import { createPushService } from '../push/service.js';
import { validPushEndpoint, validPushSubscription } from '../push/subscription.js';

const fail = (statusCode, message) => Object.assign(new Error(message), { expose: true, statusCode });
const only = (object, keys) => object && typeof object === 'object' && !Array.isArray(object)
  && Object.keys(object).sort().join(',') === keys.sort().join(',');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function registerPushRoutes({ app, requireAuth = requireSupabaseAuth, service = createPushService() } = {}) {
  const parse = express.json({ limit: '8kb', strict: true });
  function guard(req) {
    if (Object.keys(req.query).length) throw fail(400, 'Notification request is invalid.');
    if (!service.configured()) throw fail(503, 'Notifications are not configured.');
  }
  const error = (next) => next(fail(503, 'Notification service is temporarily unavailable.'));

  app.get('/api/notifications/config', requireAuth, (req, res, next) => {
    try {
      if (Object.keys(req.query).length) throw fail(400, 'Notification request is invalid.');
      res.json({ configured: service.configured(), publicKey: service.publicKey() });
    } catch { error(next); }
  });
  app.post('/api/notifications/status', requireAuth, parse, async (req, res, next) => {
    try {
      guard(req);
      if (!only(req.body, ['endpoint']) || !validPushEndpoint(req.body.endpoint)) throw fail(400, 'Notification request is invalid.');
      res.json({ registered: await service.status(req.auth.userId, req.body.endpoint) });
    } catch (caught) { next(caught?.expose ? caught : fail(503, 'Notification service is temporarily unavailable.')); }
  });
  app.post('/api/notifications/register', requireAuth, parse, async (req, res, next) => {
    try {
      guard(req);
      if (!only(req.body, ['subscription']) || !validPushSubscription(req.body.subscription)) throw fail(400, 'Notification request is invalid.');
      await service.register(req.auth.userId, req.body.subscription);
      res.json({ registered: true });
    } catch (caught) { next(caught?.expose ? caught : fail(503, 'Could not enable notifications.')); }
  });
  app.post('/api/notifications/claim', requireAuth, parse, async (req, res, next) => {
    try {
      guard(req);
      if (!only(req.body, ['subscription']) || !validPushSubscription(req.body.subscription)) throw fail(400, 'Notification request is invalid.');
      res.json(await service.claim(req.auth.userId, req.body.subscription));
    } catch (caught) { next(caught?.expose ? caught : fail(503, 'Could not check this device subscription.')); }
  });
  app.post('/api/notifications/remove', requireAuth, parse, async (req, res, next) => {
    try {
      guard(req);
      if (!only(req.body, ['endpoint', 'version']) || !validPushEndpoint(req.body.endpoint)
        || typeof req.body.version !== 'string' || !UUID.test(req.body.version)) throw fail(400, 'Notification request is invalid.');
      res.json({ removed: await service.remove(req.auth.userId, req.body.endpoint, req.body.version) });
    } catch (caught) { next(caught?.expose ? caught : fail(503, 'Could not disable notifications.')); }
  });
  app.post('/api/notifications/test', requireAuth, parse, async (req, res, next) => {
    try {
      guard(req);
      if (!only(req.body, ['endpoint']) || !validPushEndpoint(req.body.endpoint)) throw fail(400, 'Notification request is invalid.');
      const result = await service.sendTest(req.auth.userId, req.body.endpoint);
      if (result.rateLimited) {
        res.setHeader('Retry-After', '60');
        throw fail(429, 'Please wait before sending another test notification.');
      }
      if (result.expired) throw fail(410, 'This device subscription expired. Enable notifications again.');
      if (result.superseded) throw fail(409, 'This device subscription changed. Reload notification settings before testing again.');
      res.json({ accepted: true });
    } catch (caught) { next(caught?.expose ? caught : fail(503, 'Could not send the test notification.')); }
  });
}
