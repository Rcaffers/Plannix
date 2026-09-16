import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAcademicYear } from './AcademicYearContext';
import { fetchClassCollection, saveClassCollection } from '../utils/api';
import {
  addDraftClass,
  classEntriesEqual,
  safeClassError,
  toClassRequestEntries,
  toDraftClasses,
  validateClassDraft,
} from '../utils/classPersistence';

const ClassContext = createContext(null);

export function ClassProvider({ children, user }) {
  const organisationId = user?.organisationId || null;
  const { selectedAcademicYearId, registerAcademicYearChangeGuard } = useAcademicYear();
  const [authoritativeEntries, setAuthoritativeEntries] = useState(null);
  const [entries, setEntriesState] = useState([]);
  const [revision, setRevision] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [requestReference, setRequestReference] = useState('');
  const [saved, setSaved] = useState(false);
  const generation = useRef(0);
  const saving = useRef(false);

  const dirty = authoritativeEntries !== null
    && !classEntriesEqual(entries, authoritativeEntries);

  useEffect(() => registerAcademicYearChangeGuard(() =>
    !dirty || window.confirm('Discard unsaved class changes and switch academic years?')),
  [dirty, registerAcademicYearChangeGuard]);

  useEffect(() => {
    window.__plannixConfirmClassDiscard = () =>
      !dirty || window.confirm('Discard unsaved class changes and sign out?');
    return () => { delete window.__plannixConfirmClassDiscard; };
  }, [dirty]);

  const clear = useCallback(() => {
    generation.current += 1;
    saving.current = false;
    setAuthoritativeEntries(null);
    setEntriesState([]);
    setRevision(null);
    setIsLoading(false);
    setIsSaving(false);
    setError('');
    setRequestReference('');
    setSaved(false);
  }, []);

  const load = useCallback(async ({ confirmDiscard = false } = {}) => {
    if (!user?.id || !organisationId || !selectedAcademicYearId) return false;
    if (confirmDiscard && dirty
        && !window.confirm('Discard unsaved class changes and reload?')) return false;
    generation.current += 1;
    const expectedGeneration = generation.current;
    setIsLoading(true);
    setError('');
    setSaved(false);
    try {
      const result = await fetchClassCollection(organisationId, selectedAcademicYearId);
      if (expectedGeneration !== generation.current) return false;
      const loaded = toDraftClasses(result.entries);
      setAuthoritativeEntries(loaded);
      setEntriesState(loaded);
      setRevision(result.revision);
      setRequestReference(result.requestId || '');
      return true;
    } catch (loadError) {
      if (expectedGeneration === generation.current) {
        setAuthoritativeEntries(null);
        setEntriesState([]);
        setRevision(null);
        setError(safeClassError(loadError, 'Could not load classes.'));
        setRequestReference(loadError.requestId || '');
      }
      return false;
    } finally {
      if (expectedGeneration === generation.current) setIsLoading(false);
    }
  }, [dirty, organisationId, selectedAcademicYearId, user?.id]);

  useEffect(() => {
    clear();
    if (!user?.id || !organisationId || !selectedAcademicYearId) return undefined;
    load();
    return () => { generation.current += 1; };
  }, [user?.id, organisationId, selectedAcademicYearId, clear]); // load intentionally scoped by IDs

  const updateEntries = useCallback((next) => {
    setSaved(false);
    setError('');
    setEntriesState((current) => (typeof next === 'function' ? next(current) : next));
  }, []);

  const addClass = useCallback(() => updateEntries(addDraftClass), [updateEntries]);
  const removeClass = useCallback((index) => updateEntries((current) =>
    current.filter((_, entryIndex) => entryIndex !== index)), [updateEntries]);

  const save = useCallback(async () => {
    if (saving.current || isLoading || revision === null
        || !organisationId || !selectedAcademicYearId) return false;
    const validationError = validateClassDraft(entries);
    if (validationError) { setError(validationError); return false; }
    saving.current = true;
    const expectedGeneration = generation.current;
    setIsSaving(true);
    setError('');
    setSaved(false);
    try {
      const result = await saveClassCollection(
        organisationId,
        selectedAcademicYearId,
        revision,
        toClassRequestEntries(entries),
      );
      if (expectedGeneration !== generation.current) return false;
      const authoritative = toDraftClasses(result.entries);
      setAuthoritativeEntries(authoritative);
      setEntriesState(authoritative);
      setRevision(result.revision);
      setRequestReference(result.requestId || '');
      setSaved(true);
      return true;
    } catch (saveError) {
      if (expectedGeneration === generation.current) {
        setError(safeClassError(saveError, 'Could not save classes.'));
        setRequestReference(saveError.requestId || '');
      }
      return false;
    } finally {
      if (expectedGeneration === generation.current) {
        saving.current = false;
        setIsSaving(false);
      }
    }
  }, [entries, isLoading, organisationId, revision, selectedAcademicYearId]);

  const value = useMemo(() => ({
    authoritativeEntries,
    entries,
    revision,
    isLoaded: authoritativeEntries !== null,
    isLoading,
    isSaving,
    dirty,
    error,
    requestReference,
    saved,
    updateEntries,
    addClass,
    removeClass,
    save,
    reload: () => load({ confirmDiscard: true }),
    clearClasses: clear,
  }), [authoritativeEntries, entries, revision, isLoading, isSaving, dirty, error,
    requestReference, saved, updateEntries, addClass, removeClass, save, load, clear]);

  return <ClassContext.Provider value={value}>{children}</ClassContext.Provider>;
}

export function useClasses() {
  const context = useContext(ClassContext);
  if (!context) throw new Error('useClasses must be used within ClassProvider');
  return context;
}
