import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  buildDayColumnLabels,
  buildRowSegments,
  DEFAULT_TIMETABLE_LAYOUT,
  normalizeLayout,
} from '../utils/timetableLayout';
import { fetchTimetableLayout, saveTimetableLayout } from '../utils/api';

const TimetableLayoutContext = createContext(null);

export function TimetableLayoutProvider({ children, user }) {
  const [layout, setLayoutState] = useState(() => normalizeLayout(DEFAULT_TIMETABLE_LAYOUT));

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!user) {
        if (!cancelled) {
          setLayoutState(normalizeLayout(DEFAULT_TIMETABLE_LAYOUT));
        }
        return;
      }
      try {
        const serverLayout = await fetchTimetableLayout();
        if (!cancelled && serverLayout) {
          setLayoutState(normalizeLayout(serverLayout));
        }
      } catch {
        if (!cancelled) {
          setLayoutState(normalizeLayout(DEFAULT_TIMETABLE_LAYOUT));
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const setLayoutAndPersist = useCallback((next) => {
    setLayoutState((prev) => {
      const merged = typeof next === 'function' ? next(prev) : { ...prev, ...next };
      const normalized = normalizeLayout(merged);
      if (user) {
        saveTimetableLayout(normalized).catch(() => {});
      }
      return normalized;
    });
  }, [user]);

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
