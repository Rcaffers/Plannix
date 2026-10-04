import { CANONICAL_EVENT_UUID } from '../../shared/personalEvent.js';

export const WEEKEND_EVENTS_PREFERENCE_CHANGED = 'plannix:weekend-events-preference';
const STORAGE_PREFIX = 'plannix_show_weekend_events_v1:';

export function weekendEventsPreferenceKey(userId) {
  return typeof userId === 'string' && CANONICAL_EVENT_UUID.test(userId)
    ? `${STORAGE_PREFIX}${userId}` : null;
}

export function readWeekendEventsPreference(userId, storage) {
  const key = weekendEventsPreferenceKey(userId);
  if (!key) return false;
  try {
    return (storage ?? globalThis.localStorage).getItem(key) === 'true';
  } catch {
    return false;
  }
}

export function writeWeekendEventsPreference(userId, enabled, storage, notify) {
  const key = weekendEventsPreferenceKey(userId);
  if (!key || typeof enabled !== 'boolean') return false;
  try {
    (storage ?? globalThis.localStorage).setItem(key, enabled ? 'true' : 'false');
    (notify ?? (detail => globalThis.dispatchEvent(new CustomEvent(WEEKEND_EVENTS_PREFERENCE_CHANGED, { detail }))))({ userId });
    return true;
  } catch {
    return false;
  }
}
