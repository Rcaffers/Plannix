import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  loadAcademicYearFromStorage,
  normalizeAcademicYear,
  saveAcademicYearToStorage,
} from '../utils/academicYear';

const AcademicYearContext = createContext(null);

export function AcademicYearProvider({ children }) {
  const [academicYear, setAcademicYearState] = useState(() => loadAcademicYearFromStorage());

  const setAcademicYear = useCallback((next) => {
    setAcademicYearState((prev) => {
      const merged = typeof next === 'function' ? next(prev) : { ...prev, ...next };
      const normalized = normalizeAcademicYear(merged);
      saveAcademicYearToStorage(normalized);
      return normalized;
    });
  }, []);

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
