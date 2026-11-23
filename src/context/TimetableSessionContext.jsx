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
import { beginSetupGuidanceSave, finishSetupGuidanceSave } from '../utils/setupGuidance';
import { observeTimetableOperation } from '../utils/timetableTestObserver';
import { serverManagedAuth, captureServerOperationContext,
  assertServerOperationContext, serverSessionGeneration } from '../utils/serverAuthTransport.js';

const TimetableSessionContext = createContext(null);
function serverContextIsCurrent(context) {
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
  const recurringScopeKey = scope ? `${user?.id}:${scope.organisationId}:${scope.academicYearId}:${scope.timetableId}:${sessionGeneration ?? 'bearer'}` : null;
  const roomReaders = useRef(0);
  const [roomAssignmentsReady,setRoomAssignmentsReady] = useState(false);
  const roomRequest = value => roomReaders.current ? {...value,includeRooms:true} : value;
  const currentScopeRef = useRef(recurringScopeKey); currentScopeRef.current = recurringScopeKey;
  const contextIsCurrent = useCallback(context => currentScopeRef.current === recurringScopeKey && serverContextIsCurrent(context), [recurringScopeKey]);
  const [recurring, setRecurring] = useState([]);
  const [recurringReady, setRecurringReady] = useState(false);
  const [loadedRecurringScopeKey, setLoadedRecurringScopeKey] = useState(null);
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
  const pendingRef = useRef(false); pendingRef.current = isSaving || unsaved;
  const generation = useRef(0);
  const recurringLoadGeneration = useRef(0);
  const datedLoadGeneration = useRef(0);
  const recurringStatusRef = useRef(null); recurringStatusRef.current = {ready:recurringReady,key:loadedRecurringScopeKey};
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
    setRoomAssignmentsReady(false);
    setRecurring([]); setRecurringReady(false); setLoadedRecurringScopeKey(null);
    setDated(null); setRevision(null); setIsLoading(false);
    setSaved(false); setError(''); setRequestReference(''); setConflict(false); setUnsaved(false);
  }, [resetSaveQueue]);

  const loadRecurring = useCallback(async () => {
    if (!scope || !contextIsCurrent(null)) return false;
    const operationContext = loadOperationContext(user?.id);
    if (serverManagedAuth && !operationContext) return false;
    resetSaveQueue();
    // A repeating reload supersedes any dated view retained from the main timetable.
    datedLoadGeneration.current += 1; setDated(null);
    const expected = ++recurringLoadGeneration.current; setRecurringReady(false); setLoadedRecurringScopeKey(null);
    const observedId = import.meta.env.MODE === 'stage4-timetable-browser-test'
      ? globalThis.crypto?.randomUUID?.() : null;
    observeTimetableOperation({ kind: 'recurring-start', id: observedId, userId: user?.id });
    let outcome = 'stale';
    setIsLoading(true); setError(''); setRequestReference(''); setSaved(false);
    try {
      let result = await fetchRecurringTimetableSessions(roomRequest(scope), { operationContext, isCurrent:()=>expected === recurringLoadGeneration.current && contextIsCurrent(operationContext) });
      if (expected !== recurringLoadGeneration.current || !contextIsCurrent(operationContext)) return false;
      // A consumer may mount after a legacy read was already sent. Upgrade the
      // read before publishing it, rather than racing a second initial load.
      if (roomReaders.current && result.roomAssignmentsLoaded !== true) {
        result = await fetchRecurringTimetableSessions(roomRequest(scope), { operationContext,
          isCurrent:()=>expected === recurringLoadGeneration.current && contextIsCurrent(operationContext) });
        if (expected !== recurringLoadGeneration.current || !contextIsCurrent(operationContext)) return false;
      }
      setRoomAssignmentsReady(result.roomAssignmentsLoaded === true);
      setRecurring(result.weeks); setRecurringReady(true); setLoadedRecurringScopeKey(recurringScopeKey);
      setRevision(result.revision); setRequestReference('');
      setConflict(false); setUnsaved(false); outcome = 'success'; return true;
    } catch (loadError) {
      if (expected === recurringLoadGeneration.current && contextIsCurrent(operationContext)) { setError(loadError.message || 'Could not load timetable sessions.'); setRequestReference(safeRequestReference(loadError)); outcome = 'error'; }
      return false;
    } finally { if (expected === recurringLoadGeneration.current && contextIsCurrent(operationContext)) setIsLoading(false);
      observeTimetableOperation({ kind: 'recurring-terminal', id: observedId, outcome }); }
  }, [scope, resetSaveQueue, user?.id, recurringScopeKey, contextIsCurrent]);

  const requireRoomAssignments = useCallback(() => {
    roomReaders.current += 1;
    if (pendingRef.current) setError('Save or explicitly reload pending timetable changes before loading room assignments.');
    else if (recurringStatusRef.current?.ready && recurringStatusRef.current.key === recurringScopeKey) void loadRecurring();
    return () => { roomReaders.current = Math.max(0,roomReaders.current-1); };
  }, [loadRecurring]);

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
    if (!scope || !contextIsCurrent(null)) return false;
    const operationContext = loadOperationContext(user?.id);
    if (serverManagedAuth && !operationContext) return false;
    resetSaveQueue();
    const expected = ++datedLoadGeneration.current; setIsLoading(true); setError(''); setRequestReference(''); setSaved(false);
    const observedId = import.meta.env.MODE === 'stage4-timetable-browser-test'
      ? globalThis.crypto?.randomUUID?.() : null;
    observeTimetableOperation({ kind:'dated-start', id:observedId, userId:user?.id });
    let outcome = 'stale';
    try {
      const result = await fetchDatedTimetableSessions(roomRequest({ ...scope, weekStartDate }), { operationContext, isCurrent:()=>expected === datedLoadGeneration.current && contextIsCurrent(operationContext) });
      if (expected !== datedLoadGeneration.current || !contextIsCurrent(operationContext)) return false;
      setDated(result); setRevision(result.revision); setRequestReference('');
      setConflict(false); setUnsaved(false); outcome = 'success'; return true;
    } catch (loadError) {
      if (expected === datedLoadGeneration.current && contextIsCurrent(operationContext)) { setError(loadError.message || 'Could not load timetable sessions.'); setRequestReference(safeRequestReference(loadError)); outcome = 'error'; }
      return false;
    } finally { if (expected === datedLoadGeneration.current && contextIsCurrent(operationContext)) setIsLoading(false);
      observeTimetableOperation({ kind:'dated-terminal', id:observedId, outcome }); }
  }, [scope, resetSaveQueue, contextIsCurrent]);

  const applyAuthoritative = useCallback((target, result, queued, observedId) => {
    if (target.type === 'recurring') setRoomAssignmentsReady(result.roomAssignmentsLoaded === true);
    setRevision(import.meta.env.MODE === 'stage4-timetable-browser-test' && queued && observedId
      ? { value:result.revision, observedId, providerId:testProviderId.current }
      : result.revision);
    revisionRef.current = result.revision;
    setRequestReference(''); setConflict(false); setError('');
    if (!queued) {
      if (target.type === 'recurring') setRecurring((current) => current.map((week) => week.weekId === target.weekId
        ? { ...week, collectionId: result.collectionId, sessions: result.sessions } : week));
      else setDated((current) => ({ ...current, source: 'override', overrideExists: true,
        collectionId: result.collectionId, repeatingWeekId: result.repeatingWeekId, sessions: result.sessions, revision: result.revision, roomAssignmentsLoaded:result.roomAssignmentsLoaded === true }));
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
      const queueGeneration = generation.current;
      queueRef.current = createSerializedSaveQueue({
        save: ({ sessions, operationContext }) => {
          if (!contextIsCurrent(operationContext)) throw new DOMException('Timetable context changed.','AbortError');
          if (operationContext) assertServerOperationContext(operationContext);
          return target.type === 'recurring'
            ? saveRecurringTimetableSessions(roomRequest({ ...scope, weekId: target.weekId, expectedRevision: revisionRef.current, sessions }), { operationContext, isCurrent:()=>queueGeneration === generation.current && contextIsCurrent(operationContext) })
            : saveDatedTimetableSessions(roomRequest({ ...scope, weekStartDate: target.weekStartDate, expectedRevision: revisionRef.current, sessions }), { operationContext, isCurrent:()=>queueGeneration === generation.current && contextIsCurrent(operationContext) });
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
          if (target.type === 'recurring' && !queued) finishSetupGuidanceSave(entry?.guidanceSave);
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
  }, [scope, applyAuthoritative, resetSaveQueue, contextIsCurrent]);

  const edit = useCallback((target, sessions) => {
    let operationContext;
    try { operationContext = serverManagedAuth ? captureServerOperationContext(user?.id) : null;
      if (!contextIsCurrent(operationContext)) return false;
      assertUniqueSessionSlots(sessions); }
    catch (validationError) { setError(validationError.message); return false; }
    const observedId = import.meta.env.MODE === 'stage4-timetable-browser-test'
      ? globalThis.crypto?.randomUUID?.() : null;
    const guidanceSave = target.type === 'recurring' ? beginSetupGuidanceSave(user?.id, 'placements') : null;
    const accepted = Boolean(scope && ensureQueue(target, operationContext).enqueue({ sessions, operationContext, observedId, guidanceSave }));
    if (accepted) observeTimetableOperation({ kind:'save-start', id:observedId,
      title:sessions?.[0]?.title, sessionName:operationContext?.sessionName });
    return accepted;
  }, [scope, ensureQueue, user?.id, contextIsCurrent]);
  const retry = useCallback(() => { const entry = retryRef.current;
    if (!entry || !contextIsCurrent(entry.operationContext)) return null;
    if (entry.operationContext) {
      try { assertServerOperationContext(entry.operationContext); } catch { return false; }
    }
    const observedId = import.meta.env.MODE === 'stage4-timetable-browser-test'
      ? globalThis.crypto?.randomUUID?.() : null;
    const guidanceSave = entry.target.type === 'recurring' ? beginSetupGuidanceSave(user?.id, 'placements') : null;
    const accepted = ensureQueue(entry.target, entry.operationContext).retry({ sessions:entry.sessions,
      operationContext:entry.operationContext, observedId, guidanceSave });
    if (accepted) observeTimetableOperation({ kind:'save-start', id:observedId,
      title:entry.sessions?.[0]?.title, sessionName:entry.operationContext?.sessionName });
    return accepted;
  }, [ensureQueue, user?.id, contextIsCurrent]);
  const reload = useCallback(() => dated?.weekStartDate ? loadDate(dated.weekStartDate) : loadRecurring(), [dated?.weekStartDate, loadDate, loadRecurring]);

  const removeOverride = useCallback(async () => {
    if (!contextIsCurrent(null) || !scope || !dated?.weekStartDate || revisionRef.current == null || isSaving) return false;
    const operationContext = serverManagedAuth ? captureServerOperationContext(user?.id) : null;
    const dateGeneration = datedLoadGeneration.current;
    setIsSaving(true); setSaved(false); setError(''); setRequestReference('');
    try { const result = await removeDatedTimetableOverride(roomRequest({ ...scope, weekStartDate: dated.weekStartDate, expectedRevision: revisionRef.current }), { operationContext, isCurrent:()=>dateGeneration === datedLoadGeneration.current && contextIsCurrent(operationContext) });
      if (operationContext) assertServerOperationContext(operationContext);
      if(dateGeneration !== datedLoadGeneration.current || !contextIsCurrent(operationContext))return false;
      setDated(result); setRevision(result.revision); setRequestReference(''); setUnsaved(false); setSaved(true); return true;
    } catch (removeError) { if (dateGeneration === datedLoadGeneration.current && contextIsCurrent(operationContext)) {
      setConflict(removeError.status === 409); setError(removeError.message || 'Could not restore the repeating timetable.'); setRequestReference(safeRequestReference(removeError)); } return false;
    } finally { if (dateGeneration === datedLoadGeneration.current && contextIsCurrent(operationContext)) setIsSaving(false); }
  }, [scope, dated?.weekStartDate, isSaving, user?.id, contextIsCurrent]);

  const saveBatch = useCallback(async (mutations, operationContext) => {
    if (!contextIsCurrent(null) || !scope || revisionRef.current == null || isSaving) return null;
    if (serverManagedAuth) assertServerOperationContext(operationContext);
    const dateGeneration = datedLoadGeneration.current;
    setIsSaving(true); setSaved(false); setError(''); setRequestReference('');
    try { const result = await saveTimetableSessionBatch(roomRequest({ ...scope, expectedRevision: revisionRef.current, mutations }), { operationContext, isCurrent:()=>dateGeneration === datedLoadGeneration.current && contextIsCurrent(operationContext) });
      if (operationContext) assertServerOperationContext(operationContext);
      if(dateGeneration !== datedLoadGeneration.current || !contextIsCurrent(operationContext))return null;
      setRevision(result.revision); setRequestReference(''); setUnsaved(false); setSaved(true);
      const current = result.collections.find((collection) => collection.type === 'date_override'
        && collection.weekStartDate === dated?.weekStartDate);
      if (current) setDated((value) => ({ ...value, revision: result.revision, source: 'override', overrideExists: true,
        collectionId: current.collectionId, repeatingWeekId: current.weekId, sessions: current.sessions, roomAssignmentsLoaded:result.roomAssignmentsLoaded === true }));
      return result;
    } catch (batchError) { if (dateGeneration === datedLoadGeneration.current && contextIsCurrent(operationContext)) {
      setConflict(batchError.status === 409); setError(batchError.message || 'Could not save timetable sessions.'); setRequestReference(safeRequestReference(batchError)); } return null;
    } finally { if (dateGeneration === datedLoadGeneration.current && contextIsCurrent(operationContext)) setIsSaving(false); }
  }, [scope, isSaving, dated?.weekStartDate, contextIsCurrent]);

  const loadDateSnapshots = useCallback(async (dates, operationContext) => {
    if (!scope || !contextIsCurrent(null)) return [];
    if (serverManagedAuth) assertServerOperationContext(operationContext);
    const dateGeneration = datedLoadGeneration.current;
    const snapshots = await Promise.all(dates.map((weekStartDate) => fetchDatedTimetableSessions(roomRequest({ ...scope, weekStartDate }), { operationContext, isCurrent:()=>dateGeneration === datedLoadGeneration.current && contextIsCurrent(operationContext) })));
    if (operationContext) assertServerOperationContext(operationContext);
    if(dateGeneration !== datedLoadGeneration.current || !contextIsCurrent(operationContext))throw new DOMException('Timetable context changed.','AbortError');
    return snapshots;
  }, [scope, contextIsCurrent]);

  const value = useMemo(() => ({ userId:user?.id || null,
    ...(import.meta.env.MODE === 'stage4-timetable-browser-test' ? {
      testProviderId:testProviderId.current,
      testCommitIds:[revisionState, savingState]
        .filter(state => state && typeof state === 'object'
          && state.providerId === testProviderId.current && state.observedId)
        .map(state => state.observedId),
    } : {}),
    roomAssignmentsReady: roomAssignmentsReady && loadedRecurringScopeKey === recurringScopeKey, requireRoomAssignments,
    scope, recurring, recurringReady, loadedRecurringScopeKey, recurringScopeKey,
    dated, revision, isLoading, isSaving, saved, error,
    requestReference, conflict, unsaved, weeks, periods, classes: classes || [], loadDate, edit, retry,
    reload, reloadRecurring:loadRecurring, removeOverride, saveBatch, loadDateSnapshots, clearSessions: clear,
  }), [roomAssignmentsReady, requireRoomAssignments, user?.id, scope, recurring, recurringReady, loadedRecurringScopeKey, recurringScopeKey,
    dated, revisionState, savingState, isLoading, saved, error, requestReference, conflict,
    unsaved, weeks, periods, classes, loadDate, loadRecurring, edit, retry, reload, removeOverride, saveBatch, loadDateSnapshots, clear]);
  return <TimetableSessionContext.Provider value={value}>{children}</TimetableSessionContext.Provider>;
}

export function useTimetableSessions() {
  const value = useContext(TimetableSessionContext);
  if (!value) throw new Error('useTimetableSessions must be used within TimetableSessionProvider');
  return value;
}
