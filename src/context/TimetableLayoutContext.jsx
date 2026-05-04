import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  buildDayColumnLabels,
  buildRowSegments,
  DEFAULT_TIMETABLE_LAYOUT,
  loadTimetableLayoutFromStorage,
  normalizeLayout,
  saveTimetableLayoutToStorage,
} from '../utils/timetableLayout';

const TimetableLayoutContext = createContext(null);

export function TimetableLayoutProvider({ children }) {
  const [layout, setLayoutState] = useState(() => loadTimetableLayoutFromStorage());

  const setLayoutAndPersist = useCallback((next) => {
    setLayoutState((prev) => {
      const merged = typeof next === 'function' ? next(prev) : { ...prev, ...next };
      const normalized = normalizeLayout(merged);
      saveTimetableLayoutToStorage(normalized);
      return normalized;
    });
  }, []);

  const resetLayout = useCallback(() => {
    setLayoutAndPersist({ ...DEFAULT_TIMETABLE_LAYOUT });
  }, [setLayoutAndPersist]);

  const value = useMemo(() => {
    const normalized = normalizeLayout(layout);
    const rowSegments = buildRowSegments(normalized);
    return {
      layout: normalized,
      setLayout: setLayoutAndPersist,
      resetLayout,
      dayLabels: buildDayColumnLabels(normalized),
      rowSegments,
    };
  }, [layout, setLayoutAndPersist, resetLayout]);

  return <TimetableLayoutContext.Provider value={value}>{children}</TimetableLayoutContext.Provider>;
}

export function useTimetableLayout() {
  const ctx = useContext(TimetableLayoutContext);
  if (!ctx) {
    throw new Error('useTimetableLayout must be used within TimetableLayoutProvider');
  }
  return ctx;
}
