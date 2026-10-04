import { useCallback, useSyncExternalStore } from 'react';
import { readWeekendEventsPreference, weekendEventsPreferenceKey,
  WEEKEND_EVENTS_PREFERENCE_CHANGED, writeWeekendEventsPreference } from '../utils/weekendEventPreference.js';

export function useWeekendEventsPreference(userId) {
  const subscribe = useCallback(notify => {
    const key = weekendEventsPreferenceKey(userId);
    const changed = event => {
      if (event.type === WEEKEND_EVENTS_PREFERENCE_CHANGED
        ? event.detail?.userId === userId : event.key === key || event.key === null) notify();
    };
    window.addEventListener(WEEKEND_EVENTS_PREFERENCE_CHANGED, changed);
    window.addEventListener('storage', changed);
    return () => {
      window.removeEventListener(WEEKEND_EVENTS_PREFERENCE_CHANGED, changed);
      window.removeEventListener('storage', changed);
    };
  }, [userId]);
  const snapshot = useCallback(() => readWeekendEventsPreference(userId), [userId]);
  const enabled = useSyncExternalStore(subscribe, snapshot, () => false);
  const setEnabled = useCallback(value => writeWeekendEventsPreference(userId, value), [userId]);
  return [enabled, setEnabled];
}
