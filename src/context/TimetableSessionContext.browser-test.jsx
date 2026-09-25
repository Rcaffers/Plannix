import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { TimetableSessionProvider, useTimetableSessions } from './TimetableSessionContext.jsx';

// Only the surrounding contexts and network boundary are substituted by the
// browser runner. The provider, queue, React state and lifecycle are real.
const guard = () => () => {};
export const useAcademicYear = () => ({ selectedAcademicYearId: 'year', registerAcademicYearChangeGuard: guard });
export const useTimetableLayout = () => ({ timetableId: 'timetable', weeks: [], periods: [] });
export const useClasses = () => ({ authoritativeEntries: [] });
const calls = [];
let read, save;
export const fetchRecurringTimetableSessions = (...args) => read(...args);
export const fetchDatedTimetableSessions = (...args) => read(...args);
export const saveRecurringTimetableSessions = args => { calls.push(args); return save(args); };
export const saveDatedTimetableSessions = saveRecurringTimetableSessions;
export const removeDatedTimetableOverride = () => { throw Error('Unexpected override removal'); };
export const saveTimetableSessionBatch = () => { throw Error('Unexpected batch save'); };
let current;
function Observe() { current = useTimetableSessions(); return <output>{current.error}</output>; }
const host = document.createElement('div'); document.body.append(host);
const root = createRoot(host);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const results = [];
function check(value, message) { if (!value) throw Error(message); results.push(message); }
const lesson = { id: 'lesson', day: 0, periodId: 'period', classId: '7A', title: 'Original', notes: 'Keep' };
const snapshot = (type, revision = 10) => type === 'recurring'
  ? { revision, weeks: [{ weekId: 'A', sessions: [lesson] }] }
  : { revision, weekStartDate: '2026-09-21', sessions: [lesson] };
const sessions = type => type === 'recurring' ? current.recurring[0].sessions : current.dated.sessions;
async function run() {
  for (const type of ['recurring', 'date']) {
    calls.length = 0;
    read = async () => snapshot('recurring');
    flushSync(() => root.render(<TimetableSessionProvider key={type} user={{ id: 'admin', organisationId: 'org' }}><Observe /></TimetableSessionProvider>));
    await tick(); await tick();
    if (type === 'date') { read = async () => snapshot(type); await current.loadDate('2026-09-21'); await tick(); }
    const target = type === 'recurring' ? { type, weekId: 'A' } : { type, weekStartDate: '2026-09-21' };
    save = async () => { throw Object.assign(Error('Conflict'), { status: 409 }); };
    flushSync(() => current.edit(target, [{ ...lesson, title: 'Unsaved' }])); await tick();
    check(current.conflict && current.unsaved && !current.isSaving, `${type}: failed save retains conflict and unsaved edit`);
    check(current.edit(target, [lesson]) === false && calls.length === 1, `${type}: stopped queue rejects subsequent edit`);
    let pending = deferred(); read = () => pending.promise;
    let reloading; flushSync(() => { reloading = current.reload(); });
    check(current.unsaved && current.conflict && sessions(type)[0].title === 'Unsaved', `${type}: pending reload keeps optimistic content and unsaved/conflict state`);
    pending.reject(Error('Reload failed')); await reloading; await tick();
    check(current.unsaved && current.error === 'Reload failed', `${type}: failed reload does not discard unsaved state`);
    read = async args => { check(type === 'recurring' || args.weekStartDate === target.weekStartDate, `${type}: reload retains correct scope after failure`); return snapshot(type, 20); };
    await current.reload(); await tick();
    check(!current.unsaved && !current.conflict && !current.error && !current.isSaving, `${type}: successful reload clears stale status`);
    current.retry(); await tick();
    check(calls.length === 1, `${type}: old retry payload cannot be resent after reload`);
    save = async args => ({ revision: 21, sessions: args.sessions });
    flushSync(() => check(current.edit(target, [{ ...lesson, title: 'New edit' }]), `${type}: fresh queue accepts edit after reload`)); await tick();
    check(calls.length === 2 && calls[1].expectedRevision === 20 && current.saved, `${type}: exactly one new save uses reloaded revision`);
    check(type === 'recurring' ? calls[1].weekId === 'A' : calls[1].weekStartDate === target.weekStartDate, `${type}: save uses correct target`);
    // An old success or failure cannot overwrite the reloaded generation, even
    // while its replacement queue has an active save.
    for (const fails of [false, true]) {
      const old = deferred(); save = () => old.promise;
      flushSync(() => current.edit(target, [{ ...lesson, title: 'Old pending' }]));
      pending = deferred(); read = () => pending.promise;
      flushSync(() => { reloading = current.reload(); });
      check(!current.isSaving && current.unsaved, `${type}: reload clears stale saving without claiming success`);
      pending.resolve(snapshot(type, 30)); await reloading; await tick();
      const fresh = deferred(); save = () => fresh.promise;
      flushSync(() => current.edit(target, [{ ...lesson, title: 'Fresh pending' }]));
      if (fails) old.reject(Object.assign(Error('Old conflict'), { status: 409 }));
      else old.resolve({ revision: 999, sessions: [] });
      await tick();
      check(current.revision === 30 && current.isSaving && !current.error && sessions(type)[0].title === 'Fresh pending', `${type}: stale ${fails ? 'failure' : 'success'} cannot affect replacement queue`);
      fresh.resolve({ revision: 31, sessions: [{ ...lesson, title: 'Fresh pending' }] }); await tick();
    }
    const old = deferred(); save = () => old.promise;
    flushSync(() => current.edit(target, [lesson]));
    flushSync(() => current.clearSessions());
    old.resolve({ revision: 999, sessions: [lesson] }); await tick();
    check(current.revision === null && !current.isSaving && !current.unsaved && current.retry() == null, `${type}: cleanup invalidates pending saves and retry`);
  }
  flushSync(() => root.unmount());
}
run().then(() => { document.body.dataset.testResult = 'passed'; }, error => {
  document.body.dataset.testResult = 'failed'; results.push(error.stack);
}).finally(() => { const report = document.createElement('pre'); report.textContent = JSON.stringify(results, null, 2); document.body.append(report); });
