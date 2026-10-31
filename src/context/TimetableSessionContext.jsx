import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { safeRequestReference } from '../utils/requestReference';
import { useAcademicYear } from './AcademicYearContext';
import { useClasses } from './ClassContext';
import { useTimetableLayout } from './TimetableLayoutContext';
import {
  fetchDatedTimetableSessions, fetchRecurringTimetableSessions, removeDatedTimetableOverride,
  saveDatedTimetableSessions, saveRecurringTimetableSessions, saveTimetableSessionBatch,
} from '../utils/timetableSessionApi';
import { assertUniqueSessionSlots, createSerializedSaveQueue } from '../utils/timetableSessionState';
import { observeTimetableOperation } from '../utils/timetableTestObserver';
import { serverManagedAuth, captureServerOperationContext,
  assertServerOperationContext, serverSessionGeneration } from '../utils/serverAuthTransport.js';

const TimetableSessionContext = createContext(null);
function contextIsCurrent(context) {
  if (!context) return true;
  try { assertServerOperationContext(context); return true; } catch { return false; }
}
function loadOperationContext(userId) {
  if (!serverManagedAuth) return null;
  try { return captureServerOperationContext(userId); } catch { return undefined; }
}

export function TimetableSessionProvider({ children, user }) {
  const organisationId = user?.organisationId || null;
  const { selectedAcademicYearId, registerAcademicYearChangeGuard } = useAcademicYear();
  const { timetableId, weeks, periods } = useTimetableLayout();
  const { authoritativeEntries: classes } = useClasses();
  const scope = useMemo(() => organisationId && selectedAcademicYearId && timetableId
    ? { organisationId, academicYearId: selectedAcademicYearId, timetableId } : null,
  [organisationId, selectedAcademicYearId, timetableId]);
  const sessionGeneration = serverManagedAuth ? serverSessionGeneration() : null;
  const [recurring, setRecurring] = useState([]);
  const [recurringReady, setRecurringReady] = useState(false);
  const [dated, setDated] = useState(null);
  const [revisionState, setRevision] = useState(null);
  const revision = import.meta.env.MODE === 'stage4-timetable-browser-test'
    && typeof revisionState === 'object' && revisionState !== null
    ? revisionState.value : revisionState;
  const [isLoading, setIsLoading] = useState(false);
  const [savingState, setIsSaving] = useState(false);
  const isSaving = import.meta.env.MODE === 'stage4-timetable-browser-test'
    && typeof savingState === 'object' && savingState !== null
    ? savingState.value : savingState;
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [requestReference, setRequestReference] = useState('');
  const [conflict, setConflict] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const generation = useRef(0);
  const recurringLoadGeneration = useRef(0);
  const datedLoadGeneration = useRef(0);
  const revisionRef = useRef(null);
  const activeRef = useRef(null);
  const activeSessionRef = useRef(null);
  const retryRef = useRef(null);
  const queueRef = useRef(null);
  const testProviderId = useRef(null);
  if (import.meta.env.MODE === 'stage4-timetable-browser-test' && !testProviderId.current)
    testProviderId.current = globalThis.crypto?.randomUUID?.();
  revisionRef.current = revision;

  useEffect(() => () => observeTimetableOperation({ kind:'provider-unmount',
    providerId:testProviderId.current }), []);

  const resetSaveQueue = useCallback(() => {
    // Invalidate callbacks before releasing the queue and its retry payload.
    generation.current += 1;
    queueRef.current?.reset();
    queueRef.current = null;
    activeRef.current = null;
    activeSessionRef.current = null;
    retryRef.current = null;
    setIsSaving(false);
  }, []);

  const clear = useCallback(() => {
    resetSaveQueue();
    recurringLoadGeneration.current += 1;
    datedLoadGeneration.current += 1;
    setRecurring([]); setRecurringReady(false); setDated(null); setRevision(null); setIsLoading(false);
    setSaved(false); setError(''); setRequestReference(''); setConflict(false); setUnsaved(false);
  }, [resetSaveQueue]);

  const loadRecurring = useCallback(async () => {
    if (!scope) return false;
    const operationContext = loadOperationContext(user?.id);
    if (serverManagedAuth && !operationContext) return false;
    resetSaveQueue();
    const expected = ++recurringLoadGeneration.current; setRecurringReady(false);
    const observedId = import.meta.env.MODE === 'stage4-timetable-browser-test'
      ? globalThis.crypto?.randomUUID?.() : null;
    observeTimetableOperation({ kind: 'recurring-start', id: observedId, userId: user?.id });
    let outcome = 'stale';
    setIsLoading(true); setError(''); setRequestReference(''); setSaved(false);
    try {
      const result = await fetchRecurringTimetableSessions(scope, { operationContext });
      if (expected !== recurringLoadGeneration.current || !contextIsCurrent(operationContext)) return false;
      setRecurring(result.weeks); setRecurringReady(true); setRevision(result.revision); setRequestReference('');
      setConflict(false); setUnsaved(false); outcome = 'success'; return true;
    } catch (loadError) {
      if (expected === recurringLoadGeneration.current && contextIsCurrent(operationContext)) { setError(loadError.message || 'Could not load timetable sessions.'); setRequestReference(safeRequestReference(loadError)); outcome = 'error'; }
      return false;
    } finally { if (expected === recurringLoadGeneration.current && contextIsCurrent(operationContext)) setIsLoading(false);
      observeTimetableOperation({ kind: 'recurring-terminal', id: observedId, outcome }); }
  }, [scope, resetSaveQueue, user?.id]);

  useEffect(() => { clear(); if (scope && user?.id) void loadRecurring(); return clear; }, [scope, user?.id, sessionGeneration]);
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
    const operationContext = loadOperationContext(user?.id);
    if (serverManagedAuth && !operationContext) return false;
    resetSaveQueue();
    const expected = ++datedLoadGeneration.current; setIsLoading(true); setError(''); setRequestReference(''); setSaved(false);
    const observedId = import.meta.env.MODE === 'stage4-timetable-browser-test'
      ? globalThis.crypto?.randomUUID?.() : null;
    observeTimetableOperation({ kind:'dated-start', id:observedId, userId:user?.id });
    let outcome = 'stale';
    try {
      const result = await fetchDatedTimetableSessions({ ...scope, weekStartDate }, { operationContext });
      if (expected !== datedLoadGeneration.current || !contextIsCurrent(operationContext)) return false;
      setDated(result); setRevision(result.revision); setRequestReference('');
      setConflict(false); setUnsaved(false); outcome = 'success'; return true;
    } catch (loadError) {
      if (expected === datedLoadGeneration.current && contextIsCurrent(operationContext)) { setError(loadError.message || 'Could not load timetable sessions.'); setRequestReference(safeRequestReference(loadError)); outcome = 'error'; }
      return false;
    } finally { if (expected === datedLoadGeneration.current && contextIsCurrent(operationContext)) setIsLoading(false);
      observeTimetableOperation({ kind:'dated-terminal', id:observedId, outcome }); }
  }, [scope, resetSaveQueue]);

  const applyAuthoritative = useCallback((target, result, queued, observedId) => {
    setRevision(import.meta.env.MODE === 'stage4-timetable-browser-test' && queued && observedId
      ? { value:result.revision, observedId, providerId:testProviderId.current }
      : result.revision);
    revisionRef.current = result.revision;
    setRequestReference(''); setConflict(false); setError('');
    if (!queued) {
      if (target.type === 'recurring') setRecurring((current) => current.map((week) => week.weekId === target.weekId
        ? { ...week, collectionId: result.collectionId, sessions: result.sessions } : week));
      else setDated((current) => ({ ...current, source: 'override', overrideExists: true,
        collectionId: result.collectionId, repeatingWeekId: result.repeatingWeekId, sessions: result.sessions, revision: result.revision }));
      setUnsaved(false); setSaved(true);
      setIsSaving(import.meta.env.MODE === 'stage4-timetable-browser-test' && observedId
        ? { value:false, observedId, providerId:testProviderId.current } : false);
    }
  }, []);

  const ensureQueue = useCallback((target, operationContext) => {
    const key = target.type === 'recurring' ? `recurring:${target.weekId}` : `date:${target.weekStartDate}`;
    const sessionKey = operationContext
      ? `${operationContext.sessionName}:${operationContext.generation}` : 'bearer';
    if (activeRef.current !== key || activeSessionRef.current !== sessionKey) {
      resetSaveQueue(); activeRef.current = key; activeSessionRef.current = sessionKey;
      queueRef.current = createSerializedSaveQueue({
        save: ({ sessions, operationContext }) => {
          if (operationContext) assertServerOperationContext(operationContext);
          return target.type === 'recurring'
            ? saveRecurringTimetableSessions({ ...scope, weekId: target.weekId, expectedRevision: revisionRef.current, sessions }, { operationContext })
            : saveDatedTimetableSessions({ ...scope, weekStartDate: target.weekStartDate, expectedRevision: revisionRef.current, sessions }, { operationContext });
        },
        onOptimistic: ({ sessions, operationContext }) => { setUnsaved(true); setSaved(false); setError(''); setRequestReference(''); setIsSaving(true); retryRef.current = { target, sessions, operationContext };
          if (target.type === 'recurring') setRecurring((current) => current.map((week) => week.weekId === target.weekId ? { ...week, sessions } : week));
          else setDated((current) => ({ ...current, sessions, source: 'override', overrideExists: true })); },
        onAuthoritative: (result, queued, entry) => { if (!contextIsCurrent(entry?.operationContext)) return false;
          observeTimetableOperation({ kind:'save-update-start', id:entry?.observedId,
            providerId:testProviderId.current,
            observerId:globalThis.__timetableDisplayedObserverId,
            userId:entry?.operationContext?.userId,
            sessionName:entry?.operationContext?.sessionName,
            generation:entry?.operationContext?.generation,
            commitChannel:queued ? 'revision' : 'saving' });
          applyAuthoritative(target, result, queued, entry?.observedId);
          observeTimetableOperation({ kind:'save-update-scheduled', id:entry?.observedId });
          return true; },
        onError: (saveError, entry) => { if (!contextIsCurrent(entry?.operationContext)) return false;
          observeTimetableOperation({ kind:'save-update-start', id:entry?.observedId,
            providerId:testProviderId.current,
            observerId:globalThis.__timetableDisplayedObserverId,
            userId:entry?.operationContext?.userId,
            sessionName:entry?.operationContext?.sessionName,
            generation:entry?.operationContext?.generation,
            commitChannel:'saving' });
          setIsSaving(import.meta.env.MODE === 'stage4-timetable-browser-test' && entry?.observedId
            ? { value:false, observedId:entry.observedId, providerId:testProviderId.current } : false);
          setUnsaved(true); setSaved(false); setConflict(saveError.status === 409);
          setError(saveError.message || 'Could not save timetable sessions.'); setRequestReference(safeRequestReference(saveError));
          observeTimetableOperation({ kind:'save-update-scheduled', id:entry?.observedId });
          return true; },
        onTerminal: (entry, outcome, scheduledUpdate) => observeTimetableOperation({ kind:'save-terminal',
          id:entry?.observedId,
          outcome:(outcome === 'success' || outcome === 'error') && scheduledUpdate !== true
            ? 'stale' : outcome,
          scheduledSettlementUpdate:scheduledUpdate === true,
          title:entry?.sessions?.[0]?.title,
          sessionName:entry?.operationContext?.sessionName }),
      });
    }
    return queueRef.current;
  }, [scope, applyAuthoritative, resetSaveQueue]);

  const edit = useCallback((target, sessions) => {
    let operationContext;
    try { operationContext = serverManagedAuth ? captureServerOperationContext(user?.id) : null;
      assertUniqueSessionSlots(sessions); }
    catch (validationError) { setError(validationError.message); return false; }
    const observedId = import.meta.env.MODE === 'stage4-timetable-browser-test'
      ? globalThis.crypto?.randomUUID?.() : null;
    const accepted = Boolean(scope && ensureQueue(target, operationContext).enqueue({ sessions, operationContext, observedId }));
    if (accepted) observeTimetableOperation({ kind:'save-start', id:observedId,
      title:sessions?.[0]?.title, sessionName:operationContext?.sessionName });
    return accepted;
  }, [scope, ensureQueue, user?.id]);
  const retry = useCallback(() => { const entry = retryRef.current;
    if (!entry) return null;
    if (entry.operationContext) {
      try { assertServerOperationContext(entry.operationContext); } catch { return false; }
    }
    const observedId = import.meta.env.MODE === 'stage4-timetable-browser-test'
      ? globalThis.crypto?.randomUUID?.() : null;
    const accepted = ensureQueue(entry.target, entry.operationContext).retry({ sessions:entry.sessions,
      operationContext:entry.operationContext, observedId });
    if (accepted) observeTimetableOperation({ kind:'save-start', id:observedId,
      title:entry.sessions?.[0]?.title, sessionName:entry.operationContext?.sessionName });
    return accepted;
  }, [ensureQueue]);
  const reload = useCallback(() => dated?.weekStartDate ? loadDate(dated.weekStartDate) : loadRecurring(), [dated?.weekStartDate, loadDate, loadRecurring]);

  const removeOverride = useCallback(async () => {
    if (!scope || !dated?.weekStartDate || revisionRef.current == null || isSaving) return false;
    const operationContext = serverManagedAuth ? captureServerOperationContext(user?.id) : null;
    setIsSaving(true); setSaved(false); setError(''); setRequestReference('');
    try { const result = await removeDatedTimetableOverride({ ...scope, weekStartDate: dated.weekStartDate, expectedRevision: revisionRef.current }, { operationContext });
      if (operationContext) assertServerOperationContext(operationContext);
      setDated(result); setRevision(result.revision); setRequestReference(''); setUnsaved(false); setSaved(true); return true;
    } catch (removeError) { if (contextIsCurrent(operationContext)) {
      setConflict(removeError.status === 409); setError(removeError.message || 'Could not restore the repeating timetable.'); setRequestReference(safeRequestReference(removeError)); } return false;
    } finally { if (contextIsCurrent(operationContext)) setIsSaving(false); }
  }, [scope, dated?.weekStartDate, isSaving, user?.id]);

  const saveBatch = useCallback(async (mutations, operationContext) => {
    if (!scope || revisionRef.current == null || isSaving) return null;
    if (serverManagedAuth) assertServerOperationContext(operationContext);
    setIsSaving(true); setSaved(false); setError(''); setRequestReference('');
    try { const result = await saveTimetableSessionBatch({ ...scope, expectedRevision: revisionRef.current, mutations }, { operationContext });
      if (operationContext) assertServerOperationContext(operationContext);
      setRevision(result.revision); setRequestReference(''); setUnsaved(false); setSaved(true);
      const current = result.collections.find((collection) => collection.type === 'date_override'
        && collection.weekStartDate === dated?.weekStartDate);
      if (current) setDated((value) => ({ ...value, revision: result.revision, source: 'override', overrideExists: true,
        collectionId: current.collectionId, repeatingWeekId: current.weekId, sessions: current.sessions }));
      return result;
    } catch (batchError) { if (contextIsCurrent(operationContext)) {
      setConflict(batchError.status === 409); setError(batchError.message || 'Could not save timetable sessions.'); setRequestReference(safeRequestReference(batchError)); } return null;
    } finally { if (contextIsCurrent(operationContext)) setIsSaving(false); }
  }, [scope, isSaving, dated?.weekStartDate]);

  const loadDateSnapshots = useCallback(async (dates, operationContext) => {
    if (!scope) return [];
    if (serverManagedAuth) assertServerOperationContext(operationContext);
    const snapshots = await Promise.all(dates.map((weekStartDate) => fetchDatedTimetableSessions({ ...scope, weekStartDate }, { operationContext })));
    if (operationContext) assertServerOperationContext(operationContext);
    return snapshots;
  }, [scope]);

  const value = useMemo(() => ({ userId:user?.id || null,
    ...(import.meta.env.MODE === 'stage4-timetable-browser-test' ? {
      testProviderId:testProviderId.current,
      testCommitIds:[revisionState, savingState]
        .filter(state => state && typeof state === 'object'
          && state.providerId === testProviderId.current && state.observedId)
        .map(state => state.observedId),
    } : {}),
    scope, recurring, recurringReady, dated, revision, isLoading, isSaving, saved, error,
    requestReference, conflict, unsaved, weeks, periods, classes: classes || [], loadDate, edit, retry,
    reload, removeOverride, saveBatch, loadDateSnapshots, clearSessions: clear,
  }), [user?.id, scope, recurring, recurringReady, dated, revisionState, savingState, isLoading, saved, error, requestReference, conflict,
    unsaved, weeks, periods, classes, loadDate, edit, retry, reload, removeOverride, saveBatch, loadDateSnapshots, clear]);
  return <TimetableSessionContext.Provider value={value}>{children}</TimetableSessionContext.Provider>;
}

export function useTimetableSessions() {
  const value = useContext(TimetableSessionContext);
  if (!value) throw new Error('useTimetableSessions must be used within TimetableSessionProvider');
  return value;
}
