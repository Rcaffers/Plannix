const year = { selectedAcademicYearId:'year-1', academicYears:[{ id:'year-1' }],
  isLoading:false, error:'', registerAcademicYearChangeGuard:() => () => {} };
export function useAcademicYear() { return year; }
export function useTimetableLayout() { return { layout:{cycle:'one-week'}, isPersisted:true,
  loadedAcademicYearId:'year-1', isLoading:false, error:'' }; }
export function useTimetableSessions() { return { recurringReady:true,
  loadedRecurringScopeKey:'fixture', recurringScopeKey:'fixture', recurring:[],
  isLoading:false, isSaving:false, unsaved:false, error:'' }; }

export async function fetchClassCollection() {
  return { entries:window.__storedClasses, revision:window.__classRevision };
}
export function saveClassCollection(_organisationId, _yearId, _revision, entries) {
  window.__classSaveCalls += 1;
  return new Promise((resolve,reject) => {
    window.__finishClassRequest = success => {
      if (!success) { reject(Error('Synthetic save failure')); return; }
      window.__storedClasses = entries;
      window.__classRevision += 1;
      resolve({ entries, revision:window.__classRevision });
    };
  });
}
