// Rendered recovery fixture: observes the real providers without replacing them.
import { useLayoutEffect, useRef } from 'react';
import { TimetableSessionProvider as RealProvider, useTimetableSessions } from '../context/TimetableSessionContext.jsx';
import { useAcademicYear } from '../context/AcademicYearContext.jsx';
import { useClasses } from '../context/ClassContext.jsx';

let nextInstance = 0;
function Probe() {
  const sessions = useTimetableSessions();
  const years = useAcademicYear();
  const classes = useClasses();
  const instance = useRef(null);
  if (instance.current === null) instance.current = ++nextInstance;
  useLayoutEffect(() => {
    const api = {
      instance: instance.current,
      state: () => ({ userId: sessions.userId, yearId: years.selectedAcademicYearId,
        classes: classes.entries.map(entry => entry.name),
        datedTitle: sessions.dated?.sessions?.[0]?.title ?? null,
        datedWeek: sessions.dated?.weekStartDate ?? null,
        saved: sessions.saved, unsaved: sessions.unsaved, error: sessions.error }),
      draft: name => classes.updateEntries(entries => entries.map(entry => ({ ...entry, name }))),
      loadDate: weekStartDate => sessions.loadDate(weekStartDate),
      edit: title => sessions.dated && sessions.edit(
        { type:'date', weekStartDate:sessions.dated.weekStartDate },
        sessions.dated.sessions.map(entry => ({ ...entry, title }))),
    };
    globalThis.__recoveryPlanner = api;
    return () => { if (globalThis.__recoveryPlanner === api) delete globalThis.__recoveryPlanner; };
  });
  return null;
}

export function TimetableSessionProvider({ children, ...props }) {
  return <RealProvider {...props}><Probe />{children}</RealProvider>;
}
