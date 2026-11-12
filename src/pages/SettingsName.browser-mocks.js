const year = { selectedAcademicYearId: 'year-1', registerAcademicYearChangeGuard: () => () => {} };
export function useAcademicYear() { return year; }

export async function fetchTimetableLayout() {
  window.__layoutFetchCalls += 1;
  return { layout: window.__storedLayout };
}

export async function saveTimetableLayout(_organisationId, _academicYearId, _timetableId, _revision, draft) {
  window.__layoutSaveCalls += 1;
  const layout = { ...draft, name: draft.name.trim(), timetableId: 'layout-1', revision: window.__layoutSaveCalls };
  window.__storedLayout = layout;
  return { layout };
}
