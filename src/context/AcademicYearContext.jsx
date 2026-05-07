import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_ACADEMIC_YEAR,
  normalizeAcademicYear,
} from '../utils/academicYear';
import { fetchAcademicYearPlan, saveAcademicYearPlan } from '../utils/api';

const AcademicYearContext = createContext(null);

export function AcademicYearProvider({ children, user }) {
  const [academicYear, setAcademicYearState] = useState(() => normalizeAcademicYear(DEFAULT_ACADEMIC_YEAR));

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!user) {
        if (!cancelled) {
          setAcademicYearState(normalizeAcademicYear(DEFAULT_ACADEMIC_YEAR));
        }
        return;
      }
      try {
        const plan = await fetchAcademicYearPlan();
        if (!cancelled) {
          setAcademicYearState(normalizeAcademicYear(plan ?? DEFAULT_ACADEMIC_YEAR));
        }
      } catch {
        if (!cancelled) {
          setAcademicYearState(normalizeAcademicYear(DEFAULT_ACADEMIC_YEAR));
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const setAcademicYear = useCallback((next) => {
    setAcademicYearState((prev) => {
      const merged = typeof next === 'function' ? next(prev) : { ...prev, ...next };
      const normalized = normalizeAcademicYear(merged);
      if (user) {
        saveAcademicYearPlan(normalized).catch(() => {});
      }
      return normalized;
    });
  }, [user]);

  const value = useMemo(
    () => ({ academicYear, setAcademicYear }),
    [academicYear, setAcademicYear],
  );

  return <AcademicYearContext.Provider value={value}>{children}</AcademicYearContext.Provider>;
}

export function useAcademicYear() {
  const ctx = useContext(AcademicYearContext);
  if (!ctx) {
    throw new Error('useAcademicYear must be used within AcademicYearProvider');
  }
  return ctx;
}
