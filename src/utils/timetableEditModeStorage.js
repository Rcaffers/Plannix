const STORAGE_KEY = 'plannix_timetable_edit_mode_v1';

export function loadTimetableEditModeFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'locked') return false;
    if (raw === 'editing') return true;
  } catch {
    /* ignore */
  }
  return true;
}

export function saveTimetableEditModeToStorage(isEditingClasses) {
  try {
    localStorage.setItem(STORAGE_KEY, isEditingClasses ? 'editing' : 'locked');
  } catch {
    /* ignore */
  }
}
