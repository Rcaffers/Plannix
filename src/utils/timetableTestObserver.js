// The browser fixture builds with this dedicated mode. Production builds erase the observer.
export function observeTimetableOperation(event) {
  if (import.meta.env.MODE !== 'stage4-timetable-browser-test') return;
  try { globalThis.__plannixTimetableOperationObserver?.(event); }
  catch { /* Test observation must not change operation behavior. */ }
}
