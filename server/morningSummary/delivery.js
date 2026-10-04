import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { env, requireSupabaseAdminConfig } from '../config/env.js';
import { pushConfiguration } from '../push/service.js';
import { endpointHash, validPushSubscription } from '../push/subscription.js';
import { buildMorningSummary, summaryDateInfo } from '../../src/utils/morningSummary.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HASH = /^[0-9a-f]{64}$/;
const unavailable = () => new Error('Morning summary is unavailable.');
export const GENERIC_SUMMARY_BODY = 'Open Plannix to view your morning summary.';

export function summaryPayload(summary, notificationRef) {
  if (!summary || !DATE.test(summary.date) || !UUID.test(notificationRef)
    || !Array.isArray(summary.lessons) || summary.lessons.length === 0
    || !Array.isArray(summary.events)) throw unavailable();
  const payload = { type: 'plannix-morning-summary', version: 1, notificationRef,
    title: 'Your Plannix day', body: GENERIC_SUMMARY_BODY };
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > 1024) throw unavailable();
  return payload;
}

export function createMorningSummaryDelivery({ config = env, createClientImpl = createClient,
  pushImpl = webpush, getPushConfiguration = pushConfiguration, now = () => new Date(),
  monotonicNow = () => performance.now() } = {}) {
  const client = () => {
    const { url, secretKey } = requireSupabaseAdminConfig(config);
    return createClientImpl(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  };
  async function rpc(name, args, signal) {
    try {
      if (signal?.aborted) throw unavailable();
      const request = client().rpc(name, args);
      const { data, error } = await (signal ? request.abortSignal(signal) : request);
      if (error) throw unavailable();
      return data;
    } catch { throw unavailable(); }
  }
  async function resolve(userId, academicYearId, date, signal) {
    if (!UUID.test(userId) || !UUID.test(academicYearId) || !DATE.test(date)) throw unavailable();
    const snapshot = await rpc('plannix_morning_summary_snapshot', {
      target_user: userId, target_year: academicYearId, target_date: date,
    }, signal);
    if (!snapshot || snapshot.date !== date || snapshot.year?.id !== academicYearId
      || !summaryDateInfo(date, snapshot.year).eligible) throw unavailable();
    try {
      return buildMorningSummary({ date, dated: snapshot.dated, periods: snapshot.periods,
        classes: snapshot.classes, events: snapshot.events, weeks: snapshot.weeks });
    } catch { throw unavailable(); }
  }
  async function resolveReference(userId, notificationRef) {
    if (!UUID.test(userId) || !UUID.test(notificationRef)) throw unavailable();
    const snapshot = await rpc('plannix_morning_summary_notification_snapshot', {
      target_user: userId, target_reference: notificationRef,
    });
    if (!snapshot || !DATE.test(snapshot.date) || !UUID.test(snapshot.year?.id)
      || !summaryDateInfo(snapshot.date, snapshot.year).eligible) throw unavailable();
    try {
      return buildMorningSummary({ date: snapshot.date, dated: snapshot.dated, periods: snapshot.periods,
        classes: snapshot.classes, events: snapshot.events, weeks: snapshot.weeks });
    } catch { throw unavailable(); }
  }
  async function run({ maxJobs = 4, concurrency = 4, pilotUserId, signal } = {}) {
    if (!getPushConfiguration(config) || !Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 50
      || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4
      || !UUID.test(pilotUserId)) throw unavailable();
    const call = (name, args) => rpc(name, args, signal);
    const claims = await call('plannix_claim_morning_summary_pilot_jobs', {
      max_jobs: maxJobs, pilot_user: pilotUserId,
    });
    if (!Array.isArray(claims) || claims.length > maxJobs) throw unavailable();
    let index = 0;
    async function next() {
      while (index < claims.length) {
        const job = claims[index++];
        if (!job || !UUID.test(job.userId) || !UUID.test(job.academicYearId)
          || !UUID.test(job.notificationRef)
          || !UUID.test(job.token) || !DATE.test(job.date) || !Number.isSafeInteger(job.revision)) throw unavailable();
        // A missing or partial snapshot fails closed. The lease expires, but no
        // device has been claimed or contacted.
        const summary = await resolve(job.userId, job.academicYearId, job.date, signal);
        const payload = JSON.stringify(summaryPayload(summary, job.notificationRef));
        const hashes = await call('plannix_morning_summary_device_hashes', {
          target_user: job.userId, target_date: job.date, target_token: job.token,
        });
        if (!Array.isArray(hashes) || hashes.length > 10 || hashes.some(hash => !HASH.test(hash))) throw unavailable();
        for (const hash of hashes) {
          const device = await call('plannix_claim_morning_summary_device', {
            target_user: job.userId, target_date: job.date, target_token: job.token,
            target_hash: hash, target_revision: job.revision, target_year: job.academicYearId,
          });
          if (!device) continue;
          if (!UUID.test(device.version) || !validPushSubscription({ endpoint: device.endpoint, keys: device.keys })
            || endpointHash(device.endpoint) !== hash) throw unavailable();
          const checkedFrom = monotonicNow();
          const seconds = await call('plannix_morning_summary_dispatch_seconds', {
            target_user: job.userId, target_date: job.date, target_token: job.token,
            target_hash: hash, target_version: device.version,
            target_revision: job.revision, target_year: job.academicYearId,
          });
          if (seconds !== null && (!Number.isInteger(seconds) || seconds < 1 || seconds > 900)) throw unavailable();
          const ttl = seconds === null ? 0 : seconds - Math.ceil(Math.max(0, monotonicNow() - checkedFrom) / 1000);
          if (ttl < 1) {
            await call('plannix_finish_morning_summary_device', {
              target_user: job.userId, target_date: job.date, target_token: job.token,
              target_hash: hash, target_version: device.version, target_state: 'skipped',
            });
            continue;
          }
          let state = 'uncertain';
          try {
            if (signal?.aborted) throw unavailable();
            const vapid = getPushConfiguration(config);
            const response = await pushImpl.sendNotification({ endpoint: device.endpoint, keys: device.keys }, payload, {
              vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
              TTL: ttl, timeout: 4000,
            });
            if (response?.statusCode >= 200 && response.statusCode < 300) state = 'accepted';
            else if (response?.statusCode === 404 || response?.statusCode === 410) state = 'expired';
            else if (response?.statusCode === 429) state = 'retryable';
          } catch (error) {
            if (error?.statusCode === 404 || error?.statusCode === 410) state = 'expired';
            else if (error?.statusCode === 429) state = 'retryable';
            // No status can mean accepted with a lost response. Never retry it.
          }
          await call('plannix_finish_morning_summary_device', {
            target_user: job.userId, target_date: job.date, target_token: job.token,
            target_hash: hash, target_version: device.version, target_state: state,
          });
          if (state === 'expired') await call('plannix_push_remove_expired_device', {
            validated_user_id: job.userId, target_hash: hash, claimed_version: device.version,
          });
        }
        await call('plannix_finish_morning_summary_job', {
          target_user: job.userId, target_date: job.date, target_token: job.token,
        });
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, claims.length) }, () => next()));
    return { claimed: claims.length, completedAt: now().toISOString() };
  }
  return { resolve, resolveReference, run };
}
