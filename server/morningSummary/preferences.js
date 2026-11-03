import { createClient } from '@supabase/supabase-js';
import { env, requireSupabaseAdminConfig } from '../config/env.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const unavailable = () => new Error('Morning summary preferences are unavailable.');
export class MorningSummaryPreferenceConflict extends Error {
  constructor() { super('Morning summary preferences changed elsewhere.'); }
}
const validRevision = value => Number.isSafeInteger(value) && value >= 0;

export function validDeliveryTime(value) {
  return typeof value === 'string' && TIME.test(value);
}

function mapPreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'academicYearId,deliveryTime,enabled,revision'
    || typeof value.enabled !== 'boolean' || !validDeliveryTime(value.deliveryTime)
    || !validRevision(value.revision)
    || (value.academicYearId !== null && (typeof value.academicYearId !== 'string' || !UUID.test(value.academicYearId)))) throw unavailable();
  return { enabled: value.enabled, deliveryTime: value.deliveryTime, revision: value.revision,
    academicYearId: value.academicYearId };
}

function mapDetailPreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'academicYearId,deliveryTime,enabled,eventTitleConsent,lessonDetailConsent,revision'
    || typeof value.lessonDetailConsent !== 'boolean' || typeof value.eventTitleConsent !== 'boolean')
    throw unavailable();
  const base = { enabled: value.enabled, deliveryTime: value.deliveryTime,
    revision: value.revision, academicYearId: value.academicYearId };
  return { ...mapPreferences(base), lessonDetailConsent: value.lessonDetailConsent,
    eventTitleConsent: value.eventTitleConsent };
}

export function createMorningSummaryPreferenceService({ config = env, createClientImpl = createClient } = {}) {
  async function rpc(name, userId, extra = {}, map = mapPreferences) {
    if (typeof userId !== 'string' || !UUID.test(userId)) throw unavailable();
    try {
      const { url, secretKey } = requireSupabaseAdminConfig(config);
      const client = createClientImpl(url, secretKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { data, error } = await client.rpc(name, { validated_user_id: userId, ...extra });
      if (error?.code === '40001') throw new MorningSummaryPreferenceConflict();
      if (error) throw unavailable();
      return map(data);
    } catch (error) {
      if (error instanceof MorningSummaryPreferenceConflict) throw error;
      throw unavailable();
    }
  }
  return {
    load: userId => rpc('plannix_get_morning_summary_preferences', userId),
    save(userId, value) {
      if (!value || typeof value.enabled !== 'boolean' || !validDeliveryTime(value.deliveryTime)
        || !validRevision(value.revision) || value.revision === Number.MAX_SAFE_INTEGER
        || typeof value.academicYearId !== 'string' || !UUID.test(value.academicYearId)) throw unavailable();
      return rpc('plannix_save_morning_summary_preferences', userId,
        { expected_revision: value.revision, target_enabled: value.enabled,
          target_delivery_time: value.deliveryTime, target_academic_year_id: value.academicYearId });
    },
    loadDetail: userId => rpc('plannix_get_morning_summary_detail_preferences', userId,
      {}, mapDetailPreferences),
    saveDetail(userId, value) {
      if (!value || typeof value.enabled !== 'boolean' || !validDeliveryTime(value.deliveryTime)
        || !validRevision(value.revision) || value.revision === Number.MAX_SAFE_INTEGER
        || typeof value.academicYearId !== 'string' || !UUID.test(value.academicYearId)
        || typeof value.lessonDetailConsent !== 'boolean'
        || typeof value.eventTitleConsent !== 'boolean') throw unavailable();
      return rpc('plannix_save_morning_summary_detail_preferences', userId,
        { expected_revision: value.revision, target_enabled: value.enabled,
          target_delivery_time: value.deliveryTime, target_academic_year_id: value.academicYearId,
          target_lesson_detail_consent: value.lessonDetailConsent,
          target_event_title_consent: value.eventTitleConsent }, mapDetailPreferences);
    },
  };
}
