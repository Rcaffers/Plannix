import { createClient } from '@supabase/supabase-js';
import { env, requireSupabaseAdminConfig } from '../config/env.js';
import { createMorningSummaryDelivery } from './delivery.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const MAX_DISPLAY_PERIODS = 5;
const MAX_DISPLAY_EVENTS = 2;
const unavailable = () => new Error('Notification detail is unavailable.');

// The caller supplies only selectors. The session and owner come from the
// verified cookie guard; the pilot scope comes from server configuration.
export function createMorningSummaryDetailService({ config = env, createClientImpl = createClient,
  delivery = createMorningSummaryDelivery() } = {}) {
  async function authorize({ sessionId, userId, endpointHash, installationVersion,
    detailPolicyVersion, notificationRef }) {
    if (!UUID.test(sessionId) || !UUID.test(userId) || !HASH.test(endpointHash)
      || !UUID.test(installationVersion) || !UUID.test(detailPolicyVersion)
      || !UUID.test(notificationRef)
      || !UUID.test(config.morningSummaryPilotUserId || '')) throw unavailable();
    try {
      const { url, secretKey } = requireSupabaseAdminConfig(config);
      const client = createClientImpl(url, secretKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { data, error } = await client.rpc('plannix_authorize_morning_summary_detail_v2', {
        target_session: sessionId, target_hash: endpointHash,
        target_version: installationVersion, target_reference: notificationRef,
        target_pilot: config.morningSummaryPilotUserId,
        target_policy_version: detailPolicyVersion,
      });
      if (error || !data || Object.keys(data).sort().join(',') !== 'eventTitleConsent,lessonDetailConsent,ownerId'
        || data.ownerId !== userId || typeof data.lessonDetailConsent !== 'boolean'
        || typeof data.eventTitleConsent !== 'boolean'
        || (!data.lessonDetailConsent && !data.eventTitleConsent)) throw unavailable();
      return data;
    } catch { throw unavailable(); }
  }
  return {
    async resolve(input) {
      await authorize(input);
      let summary;
      try { summary = await delivery.resolveReference(input.userId, input.notificationRef); }
      catch { throw unavailable(); }
      // A snapshot can take time. Recheck the session, installation, current
      // consent, reference and pilot with fresh database time before returning.
      const current = await authorize(input);
      if (!summary || typeof summary.date !== 'string' || typeof summary.week !== 'string'
        || !Array.isArray(summary.lessons) || !Array.isArray(summary.events)) throw unavailable();
      return {
        date: summary.date, week: summary.week,
        lessons: current.lessonDetailConsent ? summary.lessons.slice(0, MAX_DISPLAY_PERIODS).map(lesson => ({ period: lesson.period,
          className: lesson.className, title: lesson.title, isPpa: lesson.isPpa })) : [],
        events: current.eventTitleConsent
          ? summary.events.slice(0, MAX_DISPLAY_EVENTS).map(event => ({ title: event.title })) : [],
        lessonDetailsIncluded: current.lessonDetailConsent,
        eventTitlesIncluded: current.eventTitleConsent,
      };
    },
  };
}
