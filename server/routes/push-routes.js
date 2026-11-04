import express from 'express';
import { requireSupabaseAuth } from '../middleware/requireSupabaseAuth.js';
import { createPushService } from '../push/service.js';
import { env } from '../config/env.js';
import { validPushEndpoint, validPushSubscription } from '../push/subscription.js';

const fail = (statusCode, message) => Object.assign(new Error(message), { expose: true, statusCode });
const only = (object, keys) => object && typeof object === 'object' && !Array.isArray(object)
  && Object.keys(object).sort().join(',') === keys.sort().join(',');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function registerPushRoutes({ app, requireAuth = requireSupabaseAuth,
  service = createPushService(), config = env } = {}) {
  const parse = express.json({ limit: '8kb', strict: true });
  function guard(req) {
    if (Object.keys(req.query).length) throw fail(400, 'Notification request is invalid.');
    if (!service.configured()) throw fail(503, 'Notifications are not configured.');
  }
  const error = (next) => next(fail(503, 'Notification service is temporarily unavailable.'));
  const sessionOptions = req => ({ sessionId:req.serverSession?.sessionId });

  app.get('/api/notifications/config', requireAuth, (req, res, next) => {
    try {
      if (Object.keys(req.query).length) throw fail(400, 'Notification request is invalid.');
      res.json({ configured: service.configured(), publicKey: service.publicKey(),
        ...(req.serverSession ? { detailDisplayAvailable: config.morningSummaryDetailDisplayEnabled === true
          && req.auth.userId === config.morningSummaryPilotUserId } : {}) });
    } catch { error(next); }
  });
  app.post('/api/notifications/status', requireAuth, parse, async (req, res, next) => {
    try {
      guard(req);
      if (!only(req.body, ['endpoint']) || !validPushEndpoint(req.body.endpoint)) throw fail(400, 'Notification request is invalid.');
      res.json(await service.status(req.auth.userId, req.body.endpoint, sessionOptions(req)));
    } catch (caught) { next(caught?.expose ? caught : fail(503, 'Notification service is temporarily unavailable.')); }
  });
  app.post('/api/notifications/register', requireAuth, parse, async (req, res, next) => {
    try {
      guard(req);
      const scoped = Boolean(req.serverSession);
      if (!only(req.body, scoped ? ['subscription','expectedVersion'] : ['subscription'])
        || !validPushSubscription(req.body.subscription)
        || (scoped && req.body.expectedVersion !== null
          && (typeof req.body.expectedVersion !== 'string' || !UUID.test(req.body.expectedVersion))))
        throw fail(400, 'Notification request is invalid.');
      const committed = await service.register(req.auth.userId, req.body.subscription,
        { ...sessionOptions(req), expectedVersion:req.body.expectedVersion });
      res.json(scoped ? { registered: true, version: committed.version } : { registered: true });
    } catch (caught) { next(caught?.expose ? caught : fail(503, 'Could not enable notifications.')); }
  });
  app.post('/api/notifications/detail-policy/status', requireAuth, parse, async (req, res, next) => {
    res.set('Cache-Control', 'no-store, private');
    try {
      if (!config.morningSummaryDetailDisplayEnabled || !req.serverSession)
        throw fail(404, 'Notification detail is unavailable.');
      guard(req);
      if (!only(req.body, ['endpoint','installationVersion'])
        || !validPushEndpoint(req.body.endpoint) || !UUID.test(req.body.installationVersion))
        throw fail(400, 'Notification request is invalid.');
      res.json(await service.detailPolicy(req.auth.userId, req.body.endpoint,
        req.body.installationVersion, sessionOptions(req)));
    } catch (caught) { next(caught?.expose ? caught : fail(404, 'Notification detail is unavailable.')); }
  });
  app.post('/api/notifications/detail-policy/set', requireAuth, parse, async (req, res, next) => {
    res.set('Cache-Control', 'no-store, private');
    try {
      if (!config.morningSummaryDetailDisplayEnabled || !req.serverSession)
        throw fail(404, 'Notification detail is unavailable.');
      guard(req);
      if (!only(req.body, ['endpoint','enabled','installationVersion','policyVersion'])
        || !validPushEndpoint(req.body.endpoint) || !UUID.test(req.body.installationVersion)
        || !UUID.test(req.body.policyVersion) || typeof req.body.enabled !== 'boolean')
        throw fail(400, 'Notification request is invalid.');
      res.json(await service.setDetailPolicy(req.auth.userId, req.body.endpoint,
        req.body.installationVersion, req.body.policyVersion, req.body.enabled, sessionOptions(req)));
    } catch (caught) { next(caught?.expose ? caught : fail(404, 'Notification detail is unavailable.')); }
  });
  app.post('/api/notifications/observe', requireAuth, parse, async (req, res, next) => {
    try {
      guard(req);
      if (!req.serverSession || !only(req.body, ['subscription'])
        || !validPushSubscription(req.body.subscription)) throw fail(400, 'Notification request is invalid.');
      res.json(await service.observe(req.auth.userId, req.body.subscription, sessionOptions(req)));
    } catch (caught) { next(caught?.expose ? caught : fail(503, 'Could not check this device subscription.')); }
  });
  app.post('/api/notifications/claim', requireAuth, parse, async (req, res, next) => {
    try {
      guard(req);
      if (!only(req.body, ['subscription']) || !validPushSubscription(req.body.subscription)) throw fail(400, 'Notification request is invalid.');
      res.json(await service.claim(req.auth.userId, req.body.subscription, sessionOptions(req)));
    } catch (caught) { next(caught?.expose ? caught : fail(503, 'Could not check this device subscription.')); }
  });
  app.post('/api/notifications/remove', requireAuth, parse, async (req, res, next) => {
    try {
      guard(req);
      if (!only(req.body, ['endpoint', 'version']) || !validPushEndpoint(req.body.endpoint)
        || typeof req.body.version !== 'string' || !UUID.test(req.body.version)) throw fail(400, 'Notification request is invalid.');
      res.json({ removed: await service.remove(req.auth.userId, req.body.endpoint, req.body.version, sessionOptions(req)) });
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
