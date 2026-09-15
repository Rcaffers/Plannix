import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_ACADEMIC_YEAR, normalizeAcademicYear, selectCurrentAcademicYear } from '../utils/academicYear';
import { fetchAcademicYears, fetchAcademicYearPlan, saveAcademicYearPlan } from '../utils/api';

const AcademicYearContext = createContext(null);
const emptyPlan = () => normalizeAcademicYear(DEFAULT_ACADEMIC_YEAR);

export function AcademicYearProvider({ children, user }) {
  const organisationId = user?.organisationId || null;
  const [academicYears, setAcademicYears] = useState([]);
  const [selectedAcademicYearId, setSelectedAcademicYearId] = useState(null);
  const [academicYear, setAcademicYear] = useState(emptyPlan);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [requestReference, setRequestReference] = useState('');
  const generation = useRef(0);
  const saving = useRef(false);

  const clearUserAcademicYear = useCallback(() => {
    generation.current += 1;
    setAcademicYears([]);
    setSelectedAcademicYearId(null);
    setAcademicYear(emptyPlan());
    setIsLoading(false);
    setIsSaving(false);
    saving.current = false;
    setError('');
    setRequestReference('');
  }, []);

  const loadYear = useCallback(async (yearId, expectedGeneration = generation.current) => {
    if (!organisationId || !yearId) return null;
    setIsLoading(true);
    setError('');
    try {
      const result = await fetchAcademicYearPlan(organisationId, yearId);
      if (expectedGeneration !== generation.current) return null;
      const plan = normalizeAcademicYear(result.plan);
      setAcademicYear(plan);
      setSelectedAcademicYearId(plan.id);
      setRequestReference(result.requestId || '');
      return plan;
    } catch (loadError) {
      if (expectedGeneration === generation.current) {
        setError(loadError.message || 'Could not load the academic year.');
        setRequestReference(loadError.requestId || '');
      }
      return null;
    } finally {
      if (expectedGeneration === generation.current) setIsLoading(false);
    }
  }, [organisationId]);

  useEffect(() => {
    clearUserAcademicYear();
    if (!user?.id || !organisationId) return undefined;
    const expectedGeneration = generation.current;
    setIsLoading(true);
    fetchAcademicYears(organisationId).then(async (result) => {
      if (expectedGeneration !== generation.current) return;
      setAcademicYears(result.academicYears);
      setRequestReference(result.requestId || '');
      const currentId = selectCurrentAcademicYear(result.academicYears);
      if (currentId) await loadYear(currentId, expectedGeneration);
    }).catch((loadError) => {
      if (expectedGeneration === generation.current) {
        setError(loadError.message || 'Could not load academic years.');
        setRequestReference(loadError.requestId || '');
      }
    }).finally(() => {
      if (expectedGeneration === generation.current) setIsLoading(false);
    });
    return () => { generation.current += 1; };
  }, [user?.id, organisationId, clearUserAcademicYear, loadYear]);

  const selectAcademicYear = useCallback(async (yearId) => {
    const previousId = selectedAcademicYearId;
    generation.current += 1;
    const expectedGeneration = generation.current;
    setSelectedAcademicYearId(yearId || null);
    if (!yearId) { setAcademicYear(emptyPlan()); return null; }
    const loaded = await loadYear(yearId, expectedGeneration);
    if (!loaded && expectedGeneration === generation.current) setSelectedAcademicYearId(previousId);
    return loaded;
  }, [loadYear, selectedAcademicYearId]);

  const createAcademicYear = useCallback(() => {
    generation.current += 1;
    setSelectedAcademicYearId(null);
    setAcademicYear(emptyPlan());
    setError('');
    setRequestReference('');
  }, []);

  const saveAcademicYear = useCallback(async (plan) => {
    if (saving.current || !organisationId) return null;
    saving.current = true;
    const expectedGeneration = generation.current;
    setIsSaving(true);
    setError('');
    try {
      const result = await saveAcademicYearPlan(organisationId, normalizeAcademicYear(plan));
      if (expectedGeneration !== generation.current) return null;
      const savedPlan = normalizeAcademicYear({ ...plan, id: result.academicYearId });
      setAcademicYear(savedPlan);
      setSelectedAcademicYearId(result.academicYearId);
      setAcademicYears((years) => {
        const summary = { id: savedPlan.id, label: savedPlan.label, startDate: savedPlan.startDate, endDate: savedPlan.endDate };
        return [...years.filter((year) => year.id !== savedPlan.id), summary]
          .sort((a, b) => b.startDate.localeCompare(a.startDate) || a.id.localeCompare(b.id));
      });
      setRequestReference(result.requestId || '');
      await loadYear(result.academicYearId, expectedGeneration);
      return savedPlan;
    } catch (saveError) {
      if (expectedGeneration === generation.current) {
        setError(saveError.message || 'Could not save the academic year.');
        setRequestReference(saveError.requestId || '');
      }
      return null;
    } finally {
      saving.current = false;
      if (expectedGeneration === generation.current) setIsSaving(false);
    }
  }, [organisationId, loadYear]);

  const value = useMemo(() => ({
    academicYears, selectedAcademicYearId, academicYear, isLoading, isSaving, error, requestReference,
    selectAcademicYear, createAcademicYear, saveAcademicYear, clearUserAcademicYear,
  }), [academicYears, selectedAcademicYearId, academicYear, isLoading, isSaving, error, requestReference,
    selectAcademicYear, createAcademicYear, saveAcademicYear, clearUserAcademicYear]);
  return <AcademicYearContext.Provider value={value}>{children}</AcademicYearContext.Provider>;
}

export function useAcademicYear() {
  const ctx = useContext(AcademicYearContext);
  if (!ctx) throw new Error('useAcademicYear must be used within AcademicYearProvider');
  return ctx;
}
