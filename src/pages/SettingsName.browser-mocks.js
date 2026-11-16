const year = { selectedAcademicYearId: 'year-1', registerAcademicYearChangeGuard: () => () => {} };
export function useAcademicYear() { return year; }
export function selectMockAcademicYear(id) { year.selectedAcademicYearId = id; }

export async function fetchTimetableLayout(_organisationId, academicYearId) {
  window.__layoutFetchCalls += 1;
  if (academicYearId === 'year-2' && window.__holdYearTwoFetch) {
    return new Promise(resolve => { window.__resolveYearTwoFetch = () => resolve({ layout: null }); });
  }
  return { layout: window.__storedLayout };
}

export async function saveTimetableLayout(_organisationId, _academicYearId, _timetableId, _revision, draft) {
  window.__layoutSaveCalls += 1;
  if (window.__layoutSaveFailure) throw Error('Synthetic save failure.');
  if (window.__holdLayoutSave) await new Promise(resolve => { window.__resolveLayoutSave = resolve; });
  const layout = { ...draft, name: draft.name.trim(), timetableId: 'layout-1', revision: window.__layoutSaveCalls };
  window.__storedLayout = layout;
  return { layout };
}
