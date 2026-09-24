import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { safeRequestReference } from '../utils/requestReference';
import { buildDayColumnLabels, buildRowSegments, normalizeLayout } from '../utils/timetableLayout';
import { createDefaultLayoutDraft, editableLayout, layoutDraftEqual, safeLayoutError } from '../utils/timetableLayoutPersistence';
import { fetchTimetableLayout, saveTimetableLayout } from '../utils/api';
import { useAcademicYear } from './AcademicYearContext';

const TimetableLayoutContext = createContext(null);

export function TimetableLayoutProvider({ children, user }) {
  const organisationId = user?.organisationId || null;
  const { selectedAcademicYearId, registerAcademicYearChangeGuard } = useAcademicYear();
  const [authoritativeLayout, setAuthoritativeLayout] = useState(null);
  const [draft, setDraftState] = useState(createDefaultLayoutDraft);
  const [isPersisted, setIsPersisted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [requestReference, setRequestReference] = useState('');
  const generation = useRef(0);
  const saving = useRef(false);
  const dirty = isPersisted ? !layoutDraftEqual(draft, authoritativeLayout) : !layoutDraftEqual(draft, createDefaultLayoutDraft());

  const confirmDiscard = useCallback((message) => !dirty || window.confirm(message), [dirty]);
  useEffect(() => registerAcademicYearChangeGuard(() => confirmDiscard('Discard unsaved timetable layout changes and switch academic years?')), [confirmDiscard, registerAcademicYearChangeGuard]);
  useEffect(() => {
    window.__plannixConfirmLayoutDiscard = () => confirmDiscard('Discard unsaved timetable layout changes and continue?');
    return () => { delete window.__plannixConfirmLayoutDiscard; };
  }, [confirmDiscard]);
  useEffect(() => {
    const warn = (event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const clearUserLayout = useCallback(() => {
    generation.current += 1; saving.current = false;
    setAuthoritativeLayout(null); setDraftState(createDefaultLayoutDraft()); setIsPersisted(false);
    setIsLoading(false); setIsSaving(false); setError(''); setRequestReference(''); setSuccess('');
  }, []);

  const load = useCallback(async ({ confirmDirty = false } = {}) => {
    if (!user?.id || !organisationId || !selectedAcademicYearId) return false;
    if (confirmDirty && !confirmDiscard('Discard unsaved timetable layout changes and reload?')) return false;
    const expectedGeneration = ++generation.current;
    setIsLoading(true); setError(''); setRequestReference(''); setSuccess('');
    try {
      const result = await fetchTimetableLayout(organisationId, selectedAcademicYearId);
      if (expectedGeneration !== generation.current) return false;
      if (result.layout === null) {
        setAuthoritativeLayout(null); setDraftState(createDefaultLayoutDraft()); setIsPersisted(false);
      } else {
        setAuthoritativeLayout(result.layout); setDraftState(editableLayout(result.layout)); setIsPersisted(true);
      }
      setRequestReference('');
      return true;
    } catch (loadError) {
      if (expectedGeneration === generation.current) {
        setError(safeLayoutError(loadError, 'Could not load timetable layout.'));
        setRequestReference(safeRequestReference(loadError));
      }
      return false;
    } finally { if (expectedGeneration === generation.current) setIsLoading(false); }
  }, [confirmDiscard, organisationId, selectedAcademicYearId, user?.id]);

  useEffect(() => {
    clearUserLayout();
    if (!user?.id || !organisationId || !selectedAcademicYearId) return undefined;
    load();
    return () => { generation.current += 1; };
  }, [user?.id, organisationId, selectedAcademicYearId, clearUserLayout]);

  const setDraft = useCallback((next) => {
    setSuccess(''); setError(''); setRequestReference('');
    setDraftState((current) => editableLayout(typeof next === 'function' ? next(current) : { ...current, ...next }));
  }, []);
  const resetLayout = useCallback(() => setDraft(createDefaultLayoutDraft()), [setDraft]);

  const save = useCallback(async () => {
    if (saving.current || isLoading || !user?.id || !organisationId || !selectedAcademicYearId) return null;
    saving.current = true; setIsSaving(true); setError(''); setRequestReference(''); setSuccess('');
    const expectedGeneration = generation.current;
    try {
      const result = await saveTimetableLayout(organisationId, selectedAcademicYearId,
        authoritativeLayout?.timetableId || null, authoritativeLayout?.revision || 0, draft);
      if (expectedGeneration !== generation.current) return null;
      setAuthoritativeLayout(result.layout); setDraftState(editableLayout(result.layout)); setIsPersisted(true);
      setRequestReference(''); setSuccess('Timetable layout saved.');
      return result.layout;
    } catch (saveError) {
      if (expectedGeneration === generation.current) {
        setError(safeLayoutError(saveError)); setRequestReference(safeRequestReference(saveError));
      }
      return null;
    } finally { saving.current = false; if (expectedGeneration === generation.current) setIsSaving(false); }
  }, [authoritativeLayout, draft, isLoading, organisationId, selectedAcademicYearId, user?.id]);

  const layout = normalizeLayout(authoritativeLayout || createDefaultLayoutDraft());
  const value = useMemo(() => ({
    layout, authoritativeLayout, draft, setDraft, setLayout: setDraft, resetLayout, clearUserLayout,
    save, reload: () => load({ confirmDirty: true }), dirty, isPersisted, isLoading, isSaving,
    error, success, requestReference, timetableId: authoritativeLayout?.timetableId || null,
    revision: authoritativeLayout?.revision ?? 0, weeks: authoritativeLayout?.weeks || [],
    periods: authoritativeLayout?.periods || [], dayLabels: buildDayColumnLabels(layout), rowSegments: buildRowSegments(layout),
  }), [layout, authoritativeLayout, draft, setDraft, resetLayout, clearUserLayout, save, load,
    dirty, isPersisted, isLoading, isSaving, error, success, requestReference]);
  return <TimetableLayoutContext.Provider value={value}>{children}</TimetableLayoutContext.Provider>;
}

export function useTimetableLayout() {
  const ctx = useContext(TimetableLayoutContext);
  if (!ctx) throw new Error('useTimetableLayout must be used within TimetableLayoutProvider');
  return ctx;
}
