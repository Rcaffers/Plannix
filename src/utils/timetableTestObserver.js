// Browser fixture modes only. Production builds erase the observer.
export function observeTimetableOperation(event) {
  if (import.meta.env.MODE !== 'stage4-timetable-browser-test'
    && import.meta.env.MODE !== 'stage4-app-browser-test') return;
  try { globalThis.__plannixTimetableOperationObserver?.(event); }
  catch { /* Test observation must not change operation behavior. */ }
}
