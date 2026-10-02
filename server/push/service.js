import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';
import { env, requireSupabaseAdminConfig } from '../config/env.js';
import { endpointHash, validPushEndpoint, validPushSubscription, TEST_PUSH_PAYLOAD } from './subscription.js';

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const unavailable = () => new Error('Notifications are unavailable.');

export function pushConfiguration(config = env) {
  const publicKey = config.vapidPublicKey;
  const privateKey = config.vapidPrivateKey;
  const subject = config.vapidSubject;
  if (!publicKey || !privateKey || !subject || !/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(subject)) return null;
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    return { publicKey, privateKey, subject };
  } catch { return null; }
}

export function createPushService({ config = env, createClientImpl = createClient, pushImpl = webpush } = {}) {
  const client = () => {
    const { url, secretKey } = requireSupabaseAdminConfig(config);
    return createClientImpl(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  };
  async function rpc(name, args) {
    const { data, error } = await client().rpc(name, args);
    if (error) throw unavailable();
    return data;
  }
  function user(value) {
    if (typeof value !== 'string' || !USER_ID.test(value)) throw unavailable();
    return value;
  }
  return {
    configured: () => Boolean(pushConfiguration(config)),
    publicKey: () => pushConfiguration(config)?.publicKey || null,
    async status(userId, endpoint) {
      if (!validPushEndpoint(endpoint)) throw unavailable();
      const data = await rpc('plannix_push_device_status', { validated_user_id: user(userId), target_hash: endpointHash(endpoint) });
      if (typeof data !== 'boolean') throw unavailable();
      return data;
    },
    async register(userId, subscription) {
      if (!pushConfiguration(config) || !validPushSubscription(subscription)) throw unavailable();
      const result = await rpc('plannix_push_register_device', {
        validated_user_id: user(userId), target_hash: endpointHash(subscription.endpoint),
        target_endpoint: subscription.endpoint, target_p256dh: subscription.keys.p256dh, target_auth: subscription.keys.auth,
      });
      if (result !== true) throw unavailable();
    },
    async claim(userId, subscription) {
      if (!validPushSubscription(subscription)) throw unavailable();
      const result = await rpc('plannix_push_claim_device', {
        validated_user_id: user(userId), target_hash: endpointHash(subscription.endpoint),
        target_p256dh: subscription.keys.p256dh, target_auth: subscription.keys.auth,
      });
      if (result?.state === 'absent' || result?.state === 'superseded') return { state: result.state };
      if (result?.state === 'current' && typeof result.version === 'string' && USER_ID.test(result.version)) {
        return { state: 'current', version: result.version };
      }
      throw unavailable();
    },
    async remove(userId, endpoint, version) {
      if (!validPushEndpoint(endpoint) || typeof version !== 'string' || !USER_ID.test(version)) throw unavailable();
      const result = await rpc('plannix_push_remove_device', {
        validated_user_id: user(userId), target_hash: endpointHash(endpoint), claimed_version: version,
      });
      if (typeof result !== 'boolean') throw unavailable();
      return result;
    },
    async sendTest(userId, endpoint) {
      const vapid = pushConfiguration(config);
      if (!vapid || !validPushEndpoint(endpoint)) throw unavailable();
      const data = await rpc('plannix_push_claim_test', { validated_user_id: user(userId), target_hash: endpointHash(endpoint) });
      if (data?.rateLimited === true) return { rateLimited: true };
      if (!data || typeof data.version !== 'string' || !USER_ID.test(data.version)
        || !validPushSubscription({ endpoint: data.endpoint, keys: data.keys })) throw unavailable();
      if (data.endpoint !== endpoint) throw unavailable();
      try {
        const response = await pushImpl.sendNotification({ endpoint: data.endpoint, keys: data.keys }, TEST_PUSH_PAYLOAD, {
          vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
          TTL: 60, timeout: 10000,
        });
        if (!Number.isInteger(response?.statusCode) || response.statusCode < 200 || response.statusCode > 299) throw unavailable();
      } catch (error) {
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          try {
            const removed = await rpc('plannix_push_remove_expired_device', {
              validated_user_id: user(userId), target_hash: endpointHash(endpoint), claimed_version: data.version,
            });
            if (typeof removed !== 'boolean') throw unavailable();
            return removed ? { expired: true } : { superseded: true };
          } catch { throw unavailable(); }
        }
        throw unavailable();
      }
      return { accepted: true };
    },
  };
}
