import { useLayoutEffect, useRef } from 'react';
import Timetable from '../pages/Timetable.jsx';
import { TimetableSessionProvider as RealTimetableSessionProvider,
  useTimetableSessions } from '../context/TimetableSessionContext.jsx';
import { captureServerOperationContext } from '../utils/serverAuthTransport.js';
import { useAcademicYear } from '../context/AcademicYearContext.jsx';
import { useClasses } from '../context/ClassContext.jsx';
import { useTimetableLayout } from '../context/TimetableLayoutContext.jsx';
import { abandonPending, collectCommittedIds } from '../utils/timetableCommitAttribution.js';

let nextId = 0;
export function TimetableSessionProvider(props) {
  const mountId = useRef(null);
  if (mountId.current === null) mountId.current = ++nextId;
  useLayoutEffect(() => {
    window.__timetableProviderMountId = mountId.current;
  });
  return <RealTimetableSessionProvider {...props} />;
}
export default function TimetableObserved(props) {
  const current = useTimetableSessions();
  const academic = useAcademicYear();
  const classes = useClasses();
  const layout = useTimetableLayout();
  const mountId = useRef(null);
  if (mountId.current === null) mountId.current = ++nextId;
  const state = () => ({ dated: current.dated?.weekStartDate,
    sessions: current.dated?.sessions, revision: current.revision,
    isSaving: current.isSaving, saved: current.saved, error: current.error,
    requestReference:current.requestReference, recurringReady:current.recurringReady,
    isLoading:current.isLoading, unsaved: current.unsaved });
  useLayoutEffect(() => {
    window.__firstLoginPlannerState = {
      yearId: academic.selectedAcademicYearId,
      yearError: academic.error,
      classNames: classes.entries.map(entry => entry.name),
      classError: classes.error,
      timetableId: layout.timetableId,
      layoutError: layout.error,
      lessonTitle: current.dated?.sessions?.[0]?.title,
      sessionError: current.error,
    };
    return () => { delete window.__firstLoginPlannerState; };
  });
  useLayoutEffect(() => {
    window.__timetableDisplayedObserverId = mountId.current;
    return () => {
      abandonPending(window.__timetablePendingUpdateIds, window.__timetableAbandonedUpdates,
        { providerId:current.testProviderId, observerId:mountId.current,
          reason:'observer-unmount' });
      window.__plannixTimetableOperationObserver?.({ kind:'observer-unmount',
        providerId:current.testProviderId, observerId:mountId.current });
      if (window.__timetableDisplayedObserverId === mountId.current)
        delete window.__timetableDisplayedObserverId;
    };
  }, []);
  useLayoutEffect(() => {
    let context;
    try { context = captureServerOperationContext(current.userId); } catch { /* No usable context. */ }
    const operationIds = collectCommittedIds(window.__timetablePendingUpdateIds,
      window.__timetableAbandonedUpdates, { context, providerId:current.testProviderId,
        observerId:mountId.current, userId:current.userId,
        committedMarkers:current.testCommitIds });
    if (!context) return;
    const commitSequence = (window.__timetableCommitSequence || 0) + 1;
    window.__timetableCommitSequence = commitSequence;
    // This runs only for a real React commit. Batching can associate several
    // scheduled operations with one commit; stale operations add no ID.
    window.__timetableCommittedState = { providerId:mountId.current,
      realProviderId:current.testProviderId,
      userId:current.userId, sessionName:context.sessionName,
      commitSequence, state:state() };
    if (operationIds.length) window.__timetableActualCommits.push({
      ...window.__timetableCommittedState, operationIds });
  });
  useLayoutEffect(() => {
    const id = mountId.current;
    window.__timetableContextTest = {
      id,
      edit(title) {
        if (!current.dated) return false;
        return current.edit({ type: 'date', weekStartDate: current.dated.weekStartDate },
          current.dated.sessions.map(session => ({ ...session, title })));
      },
      retry: () => current.retry(),
      reload: () => current.reload(),
      state,
    };
    return () => { if (window.__timetableContextTest?.id === id)
      delete window.__timetableContextTest; };
  });
  return <Timetable {...props} />;
}
