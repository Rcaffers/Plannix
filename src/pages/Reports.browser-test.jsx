import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import Reports from './Reports.jsx';
import '../styles/base.css';
import '../styles/accessibility.css';

const YEAR_A = '10000000-0000-4000-8000-000000000001';
const YEAR_B = '10000000-0000-4000-8000-000000000002';
const YEAR_LONG = '10000000-0000-4000-8000-000000000003';
const USER = '30000000-0000-4000-8000-000000000001';
const ORGANISATION = '40000000-0000-4000-8000-000000000001';
const CLASS_A = '50000000-0000-4000-8000-000000000001';
const CLASS_B = '50000000-0000-4000-8000-000000000002';
const PERIOD = '60000000-0000-4000-8000-000000000001';
const PERIOD_TWO = '60000000-0000-4000-8000-000000000002';
const WEEK = '70000000-0000-4000-8000-000000000001';
const LONG_TITLE = 'A detailed lesson title covering several concepts and an exceptionallylongunbrokentopicnameforwrapping';
const reportClock = () => new Date('2026-11-02T12:00:00Z');
let setYear, gate, failNext = false, revisionMismatch = false;
const requests = [];
const years = {
  [YEAR_A]: { id: YEAR_A, label: '2026/27', startDate: '2026-09-01', endDate: '2027-08-31', holidays: [
    { label: 'INSET Day', closureType: 'closure', startDate: '2026-09-01', endDate: '2026-09-01' },
    { label: 'Half term', startDate: '2026-10-26', endDate: '2026-10-30' },
    { label: 'Public day', holidayType: 'public', startDate: '2026-11-03', endDate: '2026-11-03' },
    { label: 'Training day', closureType: 'closure', startDate: '2026-11-10', endDate: '2026-11-10' },
  ] },
  [YEAR_B]: { id: YEAR_B, label: '2027/28', startDate: '2027-09-01', endDate: '2028-08-31', holidays: [] },
  [YEAR_LONG]: { id: YEAR_LONG, label: 'Long synthetic year', startDate: '2026-09-07', endDate: '2028-08-31', holidays: [] },
};
export function useAcademicYear() {
  const [id, update] = useState(YEAR_A); setYear = update;
  return { selectedAcademicYearId: id, academicYear: years[id], isLoading: false, error: '' };
}
export function useClasses() {
  return { isLoaded: true, authoritativeEntries: [{ id: CLASS_A, name: '7A' }, { id: CLASS_B, name: '8B' }], error: '' };
}
export function useTimetableLayout() {
  return { isPersisted: true, isLoading: false, timetableId: '80000000-0000-4000-8000-000000000001', revision: 1,
    periods: [
      { id: 'registration', type: 'registration', order: 0, startTime: '08:30', endTime: '09:00' },
      { id: PERIOD, type: 'teaching', number: 1, order: 1, startTime: '09:00', endTime: '10:00' },
      { id: 'break', type: 'break', order: 2, startTime: '10:00', endTime: '10:20' },
      { id: 'lunch', type: 'lunch', order: 3, startTime: '10:20', endTime: '10:50' },
      { id: PERIOD_TWO, type: 'teaching', number: 2, order: 4, startTime: '10:50', endTime: '11:50' },
    ], error: '' };
}
export function useTimetableSessions() { return { revision: 1 }; }
export async function fetchRecurringTimetableSessions(_scope, { signal }) {
  requests.push({ type: 'recurring', signal });
  return { revision: 1, weeks: [{ weekId: WEEK, sessions: [
    { id: 'pattern', classId: CLASS_A, periodId: PERIOD, day: 1,
      title: 'Synthetic lesson', notes: 'Private fixture notes' },
    { id: 'pattern-two', classId: CLASS_A, periodId: PERIOD_TWO, day: 1,
      title: 'Second pattern', notes: '' },
  ] }] };
}
export async function fetchDatedTimetableSessions(scope, { signal }) {
  requests.push({ type: 'date', monday: scope.weekStartDate, signal });
  const pending = gate;
  if (pending) await pending; // deliberately ignores cancellation
  if (failNext) { failNext = false; throw Object.assign(Error('Unsafe upstream detail'), { requestId: USER }); }
  return { revision: revisionMismatch ? 2 : 1, weekStartDate: scope.weekStartDate, repeatingWeekId: WEEK,
    sessions: scope.weekStartDate === '2026-09-14' ? [{ id: 'past-dated', classId: CLASS_A, periodId: PERIOD,
      day: 0, title: 'Past dated lesson', notes: 'Past notes' }]
      : scope.weekStartDate === '2026-11-02' ? [
        { id: 'dated', classId: CLASS_A, periodId: PERIOD,
          day: 0, title: 'Dated title', notes: 'Dated notes' },
        { id: 'long-dated', classId: CLASS_A, periodId: PERIOD_TWO,
          day: 0, title: LONG_TITLE, notes: 'Long-title details' },
      ] : [] };
}

const host = document.createElement('div'); document.body.append(host);
const router = createMemoryRouter([{ path: '/reports', element: <Reports user={{ id: USER, organisationId: ORGANISATION }} clock={reportClock} /> },
  { path: '/', element: <p>Home</p> }], { initialEntries: ['/reports'] });
const root = createRoot(host); flushSync(() => root.render(<RouterProvider router={router} />));
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
const checks = [];
const check = (condition, label) => { if (!condition) throw Error(label); checks.push(label); };
const input = (selector, value) => { const node = host.querySelector(selector); flushSync(() => {
  Object.getOwnPropertyDescriptor(node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set.call(node, value);
  node.dispatchEvent(new Event('change', { bubbles: true })); node.dispatchEvent(new Event('input', { bubbles: true }));
}); };
window.reportsPendingUnmountForTest = async () => {
  flushSync(() => setYear(YEAR_A)); await settle();
  let release; gate = new Promise(resolve => { release = resolve; });
  input('#report-class', CLASS_A); await settle();
  const signal = requests.at(-1).signal;
  flushSync(() => root.unmount());
  gate = null; release(); await settle();
  return signal.aborted && !host.querySelector('.reports-page');
};
async function run() {
  await settle();
  check(host.querySelector('.settings-breadcrumb')?.textContent.trim() === 'Home / Reports'
    && host.querySelector('.reports-card') && host.querySelectorAll('.settings-timetable-form').length === 1,
  'authenticated Reports view has the expected breadcrumb and one settings card');
  check(host.textContent.includes('earlier versions of the layout and pattern are not archived')
    && host.textContent.includes('unclassified ranges are not counted as missed lessons'),
  'historical pattern and closure classification limits are visible');
  check(host.querySelector('.reports-tabs button[aria-pressed="true"]')?.textContent === 'Class Monitor'
    && host.querySelector('#report-from').value === '2026-09-01'
    && host.querySelector('#report-to').value === '2027-08-31', 'selected report and year-wide defaults');
  input('#report-class', CLASS_A); await settle();
  check(host.textContent.includes('Lesson not held — INSET Day')
    && host.textContent.includes('School holiday or closure — Half term')
    && host.textContent.includes('Public day') && !host.textContent.includes('Lesson not held — Public day')
    && host.textContent.includes('Dated title') && host.textContent.includes('Dated notes'),
  'closed pattern slot, holiday separator and dated lesson render as text');
  const inset = [...host.querySelectorAll('.reports-entry')].find(node => node.textContent.includes('INSET Day'));
  const insetSlots = [...host.querySelectorAll('.reports-entry')].filter(node => node.textContent.includes('INSET Day'));
  const training = [...host.querySelectorAll('.reports-entry')].find(node => node.textContent.includes('Training day'));
  const trainingSlots = [...host.querySelectorAll('.reports-entry')].filter(node => node.textContent.includes('Training day'));
  const pastLesson = [...host.querySelectorAll('.reports-entry')].find(node => node.textContent.includes('Past dated lesson'));
  const dated = [...host.querySelectorAll('.reports-entry')].find(node => node.textContent.includes('Dated title'));
  const halfTerm = [...host.querySelectorAll('.reports-holiday')].find(node => node.textContent.includes('Half term'));
  const publicDay = [...host.querySelectorAll('.reports-holiday')].find(node => node.textContent.includes('Public day'));
  const pastTile = pastLesson?.querySelector('.reports-lesson');
  const todayTile = dated?.querySelector('.reports-lesson');
  check(insetSlots.map(node => node.querySelector('.reports-entry-date')?.textContent.split(' · ')[1]).join(',') === 'Period 1,Period 2'
    && trainingSlots.map(node => node.querySelector('.reports-entry-date')?.textContent.split(' · ')[1]).join(',') === 'Period 1,Period 2'
    && pastLesson?.querySelector('.reports-entry-date')?.textContent.endsWith('Period 1')
    && dated?.querySelector('.reports-entry-date')?.textContent.endsWith('Period 1')
    && [...host.querySelectorAll('.reports-entry-date')].every(node => !/\b\d{2}:\d{2}\b/.test(node.textContent))
    && !halfTerm?.textContent.includes('Period '),
  'lessons and missed closures display teaching-only period numbers without changing holiday labels');
  const goldReportStyle = node => {
    const style = getComputedStyle(node);
    return style.backgroundColor === 'rgba(250, 240, 220, 0.55)'
      && style.borderTopStyle === 'solid'
      && style.borderTopColor === 'rgba(200, 160, 90, 0.45)'
      && style.borderTopWidth === '1px' && style.borderTopLeftRadius === '12px';
  };
  check(pastTile?.classList.contains('reports-lesson--past')
    && !todayTile?.classList.contains('reports-lesson--past')
    && getComputedStyle(pastTile).backgroundColor === 'rgb(244, 214, 202)'
    && getComputedStyle(todayTile).backgroundColor === 'rgb(232, 246, 232)'
    && getComputedStyle(pastTile.querySelector('.session-lesson-notes')).color === 'rgb(61, 41, 36)'
    && getComputedStyle(pastLesson).borderLeftWidth === '1px'
    && goldReportStyle(inset) && goldReportStyle(training) && goldReportStyle(halfTerm) && goldReportStyle(publicDay)
    && inset.textContent.includes('Lesson not held — INSET Day')
    && training.textContent.includes('Lesson not held — Training day')
    && halfTerm.textContent.includes('School holiday or closure — Half term'),
  'past lesson tiles retain orange; closures and school/public ranges use solid gold report borders and original labels');
  input('#report-from', '2026-10-28'); input('#report-to', '2026-10-29'); await settle();
  check(host.textContent.includes('portion in selected dates') && !host.textContent.includes('Lesson not held — INSET Day'),
    'inclusive date filter clips overlapping holiday and clears old rows');
  input('#report-from', '2026-09-01'); input('#report-to', '2026-09-02'); await settle();
  check(host.textContent.includes('Lesson not held — INSET Day') && !host.textContent.includes('Dated title'),
    'date filter returns only its local dates');
  revisionMismatch = true; input('#report-to', '2026-09-03'); await settle();
  check(host.querySelector('.reports-error button')?.textContent === 'Retry report' && !host.querySelector('.reports-results'),
    'mixed recurring and dated revisions are rejected instead of combined');
  revisionMismatch = false; flushSync(() => host.querySelector('.reports-error button').click()); await settle();
  failNext = true; input('#report-to', '2026-09-04'); await settle();
  check(host.querySelector('.reports-error button')?.textContent === 'Retry report'
    && !host.querySelector('.reports-results') && !host.textContent.includes('Unsafe upstream detail'),
  'failed read shows safe error and Retry without a false empty report');
  flushSync(() => host.querySelector('.reports-error button').click()); await settle();
  check(host.querySelector('.reports-results') && !host.querySelector('.reports-error'), 'Retry loads a complete report');
  let release; gate = new Promise(resolve => { release = resolve; });
  input('#report-to', '2026-09-05'); await settle();
  const oldSignal = requests.at(-1).signal;
  gate = null; input('#report-class', CLASS_B); await settle(); release(); await settle();
  check(oldSignal.aborted && !host.textContent.includes('Lesson not held — INSET Day')
    && host.querySelector('.reports-results')?.textContent.includes('No scheduled lessons'),
  'class change aborts and rejects a non-cooperative old success');
  let rejectLate; gate = new Promise((_, reject) => { rejectLate = reject; });
  input('#report-class', CLASS_A); await settle();
  const lateErrorSignal = requests.at(-1).signal;
  flushSync(() => setYear(YEAR_B)); await settle();
  gate = null; rejectLate(Error('Late private failure')); await settle();
  check(host.querySelector('#report-class').value === '' && host.querySelector('#report-from').value === '2027-09-01'
    && host.querySelector('#report-to').value === '2028-08-31' && !host.querySelector('.reports-results')
    && !host.querySelector('.reports-error') && lateErrorSignal.aborted,
  'year change resets class and dates, aborts requests and ignores late errors');
  flushSync(() => setYear(YEAR_LONG)); await settle();
  const beforeOversize = requests.length;
  input('#report-class', CLASS_A); await settle();
  check(host.querySelector('[role="alert"]')?.textContent.includes('shorter From/To range')
    && !host.querySelector('.reports-results') && requests.length === beforeOversize,
  'oversized selected-year range is visible and sends no timetable requests');
  input('#report-to', '2027-10-31'); await settle();
  check(requests.slice(beforeOversize).filter(item => item.type === 'date').length === 60
    && host.querySelector('.reports-results') && !host.querySelector('[role="alert"]'),
  'exactly 60 dated weeks produce one complete report');
  let releaseQueued; gate = new Promise(resolve => { releaseQueued = resolve; });
  const beforeQueued = requests.length;
  input('#report-to', '2027-10-24'); await settle();
  const queued = requests.slice(beforeQueued).filter(item => item.type === 'date');
  check(queued.length === 4 && queued.every(item => !item.signal.aborted),
    'only four dated reads start while the remainder are queued');
  input('#report-class', ''); await settle();
  gate = null; releaseQueued(); await settle();
  check(queued.every(item => item.signal.aborted)
    && requests.slice(beforeQueued).filter(item => item.type === 'date').length === 4
    && !host.querySelector('.reports-results'),
  'scope cancellation aborts active reads and prevents queued reads from starting');
  input('#report-to', '2026-09-20'); failNext = true;
  input('#report-class', CLASS_A); await settle();
  check(host.querySelector('.reports-error button')?.textContent === 'Retry report'
    && !host.querySelector('.reports-results'), 'one failed week prevents a partial report');
  const beforeRetry = requests.length;
  flushSync(() => host.querySelector('.reports-error button').click()); await settle();
  check(requests.slice(beforeRetry).filter(item => item.type === 'date').length === 2
    && host.querySelector('.reports-results'), 'retry rechecks the bounded range and loads complete weeks');
  flushSync(() => setYear(YEAR_A)); await settle();
  input('#report-class', CLASS_A); await settle();
  document.body.dataset.testResult = 'passed'; document.body.append(Object.assign(document.createElement('pre'), { textContent: `${checks.length} Reports browser assertions passed` }));
}
run().catch(error => { document.body.dataset.testResult = 'failed'; document.body.append(Object.assign(document.createElement('pre'), { textContent: error.stack })); });
