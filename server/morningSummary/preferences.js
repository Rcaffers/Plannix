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

export function createMorningSummaryPreferenceService({ config = env, createClientImpl = createClient } = {}) {
  async function rpc(name, userId, extra = {}) {
    if (typeof userId !== 'string' || !UUID.test(userId)) throw unavailable();
    try {
      const { url, secretKey } = requireSupabaseAdminConfig(config);
      const client = createClientImpl(url, secretKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { data, error } = await client.rpc(name, { validated_user_id: userId, ...extra });
      if (error?.code === '40001') throw new MorningSummaryPreferenceConflict();
      if (error) throw unavailable();
      return mapPreferences(data);
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
  };
}
