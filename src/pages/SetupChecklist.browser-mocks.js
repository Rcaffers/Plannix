export function useAcademicYear() { return window.__setupFixture.year; }
export function useTimetableLayout() { return window.__setupFixture.layout; }
export function useClasses() { return window.__setupFixture.classes; }
export function useTimetableSessions() { return window.__setupFixture.timetable; }
export const aiConnectionApi = { load: async () => {
  if (window.__setupOptionalFail) throw Error('Synthetic optional read failure');
  return { active:false };
} };
export const morningSummaryApi = { load: async () => {
  if (window.__setupOptionalFail) throw Error('Synthetic optional read failure');
  return { enabled:false };
} };
