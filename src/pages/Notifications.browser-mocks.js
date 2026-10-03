const yearId = 'cb000000-0000-4000-8000-000000000010';
const organisationId = 'cb000000-0000-4000-8000-000000000011';
const timetableId = 'cb000000-0000-4000-8000-000000000012';
const weekId = 'cb000000-0000-4000-8000-000000000013';
const classId = 'cb000000-0000-4000-8000-000000000014';
const periodId = 'cb000000-0000-4000-8000-000000000015';
export const notificationFixtureOrganisationId = organisationId;

export const useAcademicYear = () => ({ selectedAcademicYearId: window.summaryYearId || yearId, isLoading: false, error: '',
  academicYear: { id: window.summaryYearId || yearId, label: '2026/2027', startDate: '2026-09-01', endDate: '2027-07-31', holidays: [] } });
export const useClasses = () => ({ isLoaded: true, isLoading: false, error: '', revision: 1,
  authoritativeEntries: [{ id: classId, name: '7A' }] });
export const useTimetableLayout = () => ({ isPersisted: true, isLoading: false, error: '', revision: 1, timetableId,
  weeks: [{ id: weekId, code: 'A' }], periods: [{ id: periodId, type: 'teaching', enabled: true,
    order: 1, startTime: '09:00', endTime: '10:00' }] });
export const fetchDatedTimetableSessions = async ({ weekStartDate }, { signal } = {}) => {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (window.summaryDelayWeek === weekStartDate) await new Promise((resolve, reject) => {
    window.releaseSummaryWeek = (failure = false) => failure ? reject(Error('Synthetic delayed failure')) : resolve();
  });
  if (window.summaryFailWeek === weekStartDate) throw Error('Synthetic timetable failure');
  return { weekStartDate, repeatingWeekId: weekId, sessions: [{ day: 0, periodId, classId, title: 'Fractions', notes: '' }] };
};
export const eventApi = { list: async (academicYearId, options) => {
  window.summaryEventQueries = [...(window.summaryEventQueries || []), { academicYearId, from: options.from, to: options.to }];
  if (window.summaryDelayEventDate === options.from) return new Promise((resolve, reject) => {
    window.releaseSummaryEvents = (failure = false) => failure ? reject(Error('Synthetic late event failure'))
      : resolve({ events: [{ id: 'synthetic-late-event', date: options.from, title: 'Late event',
        startTime: null, endTime: null, location: null }] });
  });
  return { events: [] };
} };
const preferencesByUser = new Map();
const currentPreference = userId => preferencesByUser.get(userId) || { enabled: false, deliveryTime: '07:00', revision: 0 };
window.setSummaryPreference = (userId, value) => preferencesByUser.set(userId, value);
export const morningSummaryApi = {
  load: async userId => {
    window.summaryPreferenceLoads = (window.summaryPreferenceLoads || 0) + 1;
    if (window.summaryPreferenceFailLoad) throw Error('Synthetic preference reload failure');
    if (window.summaryDelayPreferenceLoad) return new Promise((resolve, reject) => {
      window.releaseSummaryPreferenceLoad = (failure = false) => failure
        ? reject(Error('Synthetic delayed preference failure')) : resolve(currentPreference(userId));
    });
    return currentPreference(userId);
  },
  save: async (userId, value) => {
    window.summaryPreferenceSaves = [...(window.summaryPreferenceSaves || []), value];
    const current = currentPreference(userId);
    if (value.revision !== current.revision) throw Object.assign(Error('Synthetic conflict'), { status: 409 });
    const saved = { enabled: value.enabled, deliveryTime: value.deliveryTime, revision: current.revision + 1 };
    preferencesByUser.set(userId, saved);
    return saved;
  },
};
