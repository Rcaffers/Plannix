import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { safeRequestReference } from '../utils/requestReference';
import { useAcademicYear } from './AcademicYearContext';
import { useClasses } from './ClassContext';
import { useTimetableLayout } from './TimetableLayoutContext';
import {
  fetchDatedTimetableSessions, fetchRecurringTimetableSessions, removeDatedTimetableOverride,
  saveDatedTimetableSessions, saveRecurringTimetableSessions, saveTimetableSessionBatch,
} from '../utils/timetableSessionApi';
import { assertUniqueSessionSlots, createSerializedSaveQueue, sameSessions } from '../utils/timetableSessionState';

const TimetableSessionContext = createContext(null);

export function TimetableSessionProvider({ children, user }) {
  const organisationId = user?.organisationId || null;
  const { selectedAcademicYearId, registerAcademicYearChangeGuard } = useAcademicYear();
  const { timetableId, weeks, periods } = useTimetableLayout();
  const { authoritativeEntries: classes } = useClasses();
  const scope = useMemo(() => organisationId && selectedAcademicYearId && timetableId
    ? { organisationId, academicYearId: selectedAcademicYearId, timetableId } : null,
  [organisationId, selectedAcademicYearId, timetableId]);
  const [recurring, setRecurring] = useState([]);
  const [dated, setDated] = useState(null);
  const [revision, setRevision] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [requestReference, setRequestReference] = useState('');
  const [conflict, setConflict] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const [restorePoint, setRestorePoint] = useState(null);
  const generation = useRef(0);
  const revisionRef = useRef(null);
  const activeRef = useRef(null);
  const retryRef = useRef(null);
  const queueRef = useRef(null);
  revisionRef.current = revision;

  const resetSaveQueue = useCallback(() => {
    // Invalidate callbacks before releasing the queue and its retry payload.
    generation.current += 1;
    queueRef.current?.reset();
    queueRef.current = null;
    activeRef.current = null;
    retryRef.current = null;
    setIsSaving(false);
  }, []);

  const clear = useCallback(() => {
    resetSaveQueue();
    setRecurring([]); setDated(null); setRevision(null); setIsLoading(false);
    setSaved(false); setError(''); setRequestReference(''); setConflict(false); setUnsaved(false);
    setRestorePoint(null);
  }, [resetSaveQueue]);

  const loadRecurring = useCallback(async () => {
    if (!scope) return false;
    resetSaveQueue();
    const expected = generation.current; setIsLoading(true); setError(''); setRequestReference(''); setSaved(false);
    try {
      const result = await fetchRecurringTimetableSessions(scope);
      if (expected !== generation.current) return false;
      setRecurring(result.weeks); setRevision(result.revision); setRequestReference('');
      setConflict(false); setUnsaved(false); return true;
    } catch (loadError) {
      if (expected === generation.current) { setError(loadError.message || 'Could not load timetable sessions.'); setRequestReference(safeRequestReference(loadError)); }
      return false;
    } finally { if (expected === generation.current) setIsLoading(false); }
  }, [scope, resetSaveQueue]);

  useEffect(() => { clear(); if (scope && user?.id) void loadRecurring(); return clear; }, [scope, user?.id]);
  const hasPending = isSaving || unsaved;
  useEffect(() => registerAcademicYearChangeGuard(() => !hasPending
    || window.confirm('Timetable changes are not saved. Discard them and switch academic years?')),
  [hasPending, registerAcademicYearChangeGuard]);
  useEffect(() => {
    window.__plannixConfirmSessionDiscard = () => !hasPending
      || window.confirm('Timetable changes are not saved. Discard them and continue?');
    return () => { delete window.__plannixConfirmSessionDiscard; };
  }, [hasPending]);

  const loadDate = useCallback(async (weekStartDate) => {
    if (!scope) return false;
    resetSaveQueue();
    const expected = generation.current; setIsLoading(true); setError(''); setRequestReference(''); setSaved(false); setRestorePoint(null);
    try {
      const result = await fetchDatedTimetableSessions({ ...scope, weekStartDate });
      if (expected !== generation.current) return false;
      setDated(result); setRevision(result.revision); setRequestReference('');
      setConflict(false); setUnsaved(false); return true;
    } catch (loadError) {
      if (expected === generation.current) { setError(loadError.message || 'Could not load timetable sessions.'); setRequestReference(safeRequestReference(loadError)); }
      return false;
    } finally { if (expected === generation.current) setIsLoading(false); }
  }, [scope, resetSaveQueue]);

  const applyAuthoritative = useCallback((target, result, queued) => {
    setRevision(result.revision); revisionRef.current = result.revision;
    setRequestReference(''); setConflict(false); setError('');
    if (!queued) {
      if (target.type === 'recurring') setRecurring((current) => current.map((week) => week.weekId === target.weekId
        ? { ...week, collectionId: result.collectionId, sessions: result.sessions } : week));
      else setDated((current) => ({ ...current, source: 'override', overrideExists: true,
        collectionId: result.collectionId, repeatingWeekId: result.repeatingWeekId, sessions: result.sessions, revision: result.revision }));
      setUnsaved(false); setSaved(true); setIsSaving(false);
    }
  }, []);

  const ensureQueue = useCallback((target) => {
    const key = target.type === 'recurring' ? `recurring:${target.weekId}` : `date:${target.weekStartDate}`;
    if (activeRef.current !== key) { resetSaveQueue(); activeRef.current = key;
      queueRef.current = createSerializedSaveQueue({
        save: (sessions) => target.type === 'recurring'
          ? saveRecurringTimetableSessions({ ...scope, weekId: target.weekId, expectedRevision: revisionRef.current, sessions })
          : saveDatedTimetableSessions({ ...scope, weekStartDate: target.weekStartDate, expectedRevision: revisionRef.current, sessions }),
        onOptimistic: (sessions) => { setUnsaved(true); setSaved(false); setError(''); setRequestReference(''); setIsSaving(true); retryRef.current = { target, sessions };
          if (target.type === 'recurring') setRecurring((current) => current.map((week) => week.weekId === target.weekId ? { ...week, sessions } : week));
          else setDated((current) => ({ ...current, sessions, source: 'override', overrideExists: true })); },
        onAuthoritative: (result, queued) => applyAuthoritative(target, result, queued),
        onError: (saveError) => { setIsSaving(false); setUnsaved(true); setSaved(false); setConflict(saveError.status === 409);
          setError(saveError.message || 'Could not save timetable sessions.'); setRequestReference(safeRequestReference(saveError)); },
      });
    }
    return queueRef.current;
  }, [scope, applyAuthoritative, resetSaveQueue]);

  const edit = useCallback((target, sessions) => {
    try { assertUniqueSessionSlots(sessions); }
    catch (validationError) { setError(validationError.message); return false; }
    return Boolean(scope && ensureQueue(target).enqueue(sessions));
  }, [scope, ensureQueue]);
  const retry = useCallback(() => retryRef.current && ensureQueue(retryRef.current.target).retry(retryRef.current.sessions), [ensureQueue]);
  const reload = useCallback(() => dated?.weekStartDate ? loadDate(dated.weekStartDate) : loadRecurring(), [dated?.weekStartDate, loadDate, loadRecurring]);

  const removeOverride = useCallback(async () => {
    if (!scope || !dated?.weekStartDate || revisionRef.current == null || isSaving) return false;
    setIsSaving(true); setSaved(false); setError(''); setRequestReference('');
    try { const result = await removeDatedTimetableOverride({ ...scope, weekStartDate: dated.weekStartDate, expectedRevision: revisionRef.current });
      setDated(result); setRevision(result.revision); setRequestReference(''); setUnsaved(false); setSaved(true); return true;
    } catch (removeError) { setConflict(removeError.status === 409); setError(removeError.message || 'Could not restore the repeating timetable.'); setRequestReference(safeRequestReference(removeError)); return false;
    } finally { setIsSaving(false); }
  }, [scope, dated?.weekStartDate, isSaving]);

  const saveBatch = useCallback(async (mutations) => {
    if (!scope || revisionRef.current == null || isSaving) return null;
    setIsSaving(true); setSaved(false); setError(''); setRequestReference('');
    try { const result = await saveTimetableSessionBatch({ ...scope, expectedRevision: revisionRef.current, mutations });
      setRevision(result.revision); setRequestReference(''); setUnsaved(false); setSaved(true);
      const current = result.collections.find((collection) => collection.type === 'date_override'
        && collection.weekStartDate === dated?.weekStartDate);
      if (current) setDated((value) => ({ ...value, revision: result.revision, source: 'override', overrideExists: true,
        collectionId: current.collectionId, repeatingWeekId: current.weekId, sessions: current.sessions }));
      return result;
    } catch (batchError) { setConflict(batchError.status === 409); setError(batchError.message || 'Could not save timetable sessions.'); setRequestReference(safeRequestReference(batchError)); return null;
    } finally { setIsSaving(false); }
  }, [scope, isSaving, dated?.weekStartDate]);

  const loadDateSnapshots = useCallback(async (dates) => {
    if (!scope) return [];
    return Promise.all(dates.map((weekStartDate) => fetchDatedTimetableSessions({ ...scope, weekStartDate })));
  }, [scope]);

  const setCurrentRestorePoint = useCallback((target, sessions, overrideExists = false) => {
    if (isLoading || isSaving || unsaved || conflict) return false;
    setRestorePoint({ key: target.type === 'recurring' ? `recurring:${target.weekId}` : `date:${target.weekStartDate}`,
      target, sessions: sessions.map((entry) => ({ ...entry })), overrideExists }); return true;
  }, [isLoading, isSaving, unsaved, conflict]);
  const undoRestorePoint = useCallback(async (target, current) => {
    const key = target.type === 'recurring' ? `recurring:${target.weekId}` : `date:${target.weekStartDate}`;
    if (!restorePoint || restorePoint.key !== key || sameSessions(restorePoint.sessions, current)
        || !window.confirm('Undo this week to the restore point?')) return false;
    if (target.type === 'date' && !restorePoint.overrideExists) return removeOverride();
    edit(target, restorePoint.sessions); return true;
  }, [restorePoint, removeOverride, edit]);

  const value = useMemo(() => ({ scope, recurring, dated, revision, isLoading, isSaving, saved, error,
    requestReference, conflict, unsaved, weeks, periods, classes: classes || [], loadDate, edit, retry,
    reload, removeOverride, saveBatch, loadDateSnapshots, restorePoint, setCurrentRestorePoint, undoRestorePoint, clearSessions: clear,
  }), [scope, recurring, dated, revision, isLoading, isSaving, saved, error, requestReference, conflict,
    unsaved, weeks, periods, classes, loadDate, edit, retry, reload, removeOverride, saveBatch, loadDateSnapshots, restorePoint,
    setCurrentRestorePoint, undoRestorePoint, clear]);
  return <TimetableSessionContext.Provider value={value}>{children}</TimetableSessionContext.Provider>;
}

export function useTimetableSessions() {
  const value = useContext(TimetableSessionContext);
  if (!value) throw new Error('useTimetableSessions must be used within TimetableSessionProvider');
  return value;
}
