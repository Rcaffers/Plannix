let isEditingModeCached = true;

export function loadTimetableEditModeFromStorage() {
  return Boolean(isEditingModeCached);
}

export function saveTimetableEditModeToStorage(isEditingClasses) {
  isEditingModeCached = Boolean(isEditingClasses);
}
