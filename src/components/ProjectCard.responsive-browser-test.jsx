import { assertHiddenStatuses } from './routineStatus.browser-assertions.js';
import '../styles/accessibility.css';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import ProjectCard from './ProjectCard.jsx';
import Timetable from '../pages/Timetable.jsx';
import { writeWeekendEventsPreference } from '../utils/weekendEventPreference.js';
import '../App.css';

const entries = [{ id: '7a', name: '7A', frequency: 3 }];
const periods = [{ id: 'p1', type: 'teaching', number: 1 }, { id: 'p2', type: 'teaching', number: 2 }];
const rowSegments = periods.map((p, i) => ({ kind: 'lesson', rowIndex: i, timeLabel: i ? '10:00' : '09:00', rangeLabel: i ? '10:00 – 11:00' : '09:00 – 10:00' }));
let fixtureAcademicYear = null;
export const useAcademicYear = () => ({ academicYear: fixtureAcademicYear, selectedAcademicYearId: fixtureAcademicYear?.id });
let eventRequests = [], eventResponder = () => Promise.resolve({ events: [] });
export const eventApi = { list(yearId, options) {
  eventRequests.push({ yearId, ...options });
  return eventResponder(yearId, options);
} };
export const useClasses = () => ({ authoritativeEntries: entries });
export const useTimetableLayout = () => ({ layout: { cycle: mode === 'fixed' ? 'two-week' : 'weekly' }, dayLabels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], rowSegments });
let state;
export const useTimetableSessions = () => state;
const initial = { id: 'lesson', day: 0, periodId: 'p1', classId: '7a', title: 'Fractions', notes: 'Rulers' };
let calls = [];
let allowEditing = true, testPageSpacing = false, fixtureUserId = null;
let feedbackUpdate, observeSave = false, retryCalls = 0, reloadCalls = 0;
const scope = {}; const loadedDates = []; let mode = 'date';
function Harness() {
  const [feedback, setFeedback] = useState({}); feedbackUpdate = setFeedback;
  const [sessions, setSessions] = useState([initial]);
  const [weekB, setWeekB] = useState([]);
  const [selectedWeek, setSelectedWeek] = useState('A');
  state = { ...feedback, retry() { retryCalls++; }, reload() { reloadCalls++; }, scope, revision: 1, periods, dated: { sessions, overrideExists: feedback.overrideExists }, loadDate(date) { loadedDates.push(date); }, recurring: [{ code: 'A', weekId: 'A', sessions }, { code: 'B', weekId: 'B', sessions: weekB }],
    edit(target, next) { if (observeSave) setFeedback({ isSaving: true }); calls.push({ target, sessions: next }); if (target.weekId === 'B') setWeekB(next); else setSessions(next); return true; } };
  if (testPageSpacing) return <>
    <header id="site-header-fixture" style={{ height: 64 }}>Site navigation</header>
    {mode === 'date' ? <Timetable /> : <section className="classes-input-timetable"><ProjectCard project={{ title: 'Input Classes' }} weekMode="fixed" enableFixedPhoneSingleDay enableClassPlacement /></section>}
  </>;
  return <>
    {mode === 'fixed' ? <div><button id="week-a" onClick={() => setSelectedWeek('A')}>Week A</button><button id="week-b" onClick={() => setSelectedWeek('B')}>Week B</button></div> : null}
    <ProjectCard project={{ title: 'Test' }} weekMode={mode} enableEditing={allowEditing} enableClassPlacement enableFixedPhoneSingleDay
      weekendEventsUserId={fixtureUserId}
      fixedWeekKey={selectedWeek === 'B' ? 'cycle-2' : 'cycle-1'} fixedWeekLabel={`Week ${selectedWeek}`} />
  </>;
}
const root = createRoot(document.body.appendChild(document.createElement('div')));
const results = [];
function check(value, message) { if (!value) throw Error(message); assertHiddenStatuses(); results.push(message); }
const tick = () => new Promise(resolve => setTimeout(resolve, 100));
const click = el => flushSync(() => el.click());
async function width(value) { frameElement.style.width = `${value}px`; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); await tick(); }
function mount() { flushSync(() => root.render(<Harness key={Math.random()} />)); }
function hiddenAnnouncement(selector) {
  const el = document.querySelector(selector), style = getComputedStyle(el);
  check(el.getAttribute('aria-live') === 'polite' && style.position === 'absolute' && style.clipPath === 'inset(50%)' && el.getBoundingClientRect().height <= 1, `${selector}: live announcement is visually hidden and out of flow`);
}
function noRoutineStrip() {
  hiddenAnnouncement('.timetable-save-status');
  const card = document.querySelector('.schedule-card').getBoundingClientRect();
  const header = document.querySelector('.schedule-titlebar').getBoundingClientRect();
  check(Math.abs(header.top-card.top) <= 1, 'No routine status strip above green header');
  check(!/Inherited from the repeating timetable|Explicit date override|Intentionally empty date override/.test(document.body.textContent), 'No inheritance or override implementation banner');
}
function noRestoreControls() {
  check(!/Set restore point|Undo to restore point/.test(document.body.textContent), 'No restore-point controls');
}
function fullWeek(label) {
  noRestoreControls(); noRoutineStrip();
  const cols = [...document.querySelectorAll('.day-col')];
  check(cols.length === 5 && document.querySelectorAll('.day-head').length === 5, `${label}: five weekdays mounted`);
  check(!document.querySelector('.schedule-compact-nav') && document.querySelector('[aria-label="Go to next week"]') || mode === 'fixed', `${label}: standard week navigation`);
  check(cols.every((el,i) => el.getBoundingClientRect().width >= 100 && (!i || cols[i-1].getBoundingClientRect().right <= el.getBoundingClientRect().left + 1)), `${label}: readable columns without overlap`);
  const bar = document.querySelector('.schedule-titlebar').getBoundingClientRect();
  const grid = document.querySelector('.schedule-grid').getBoundingClientRect();
  const scroll = document.querySelector('.schedule-scroll');
  const headings = [...document.querySelectorAll('.schedule-head > *')];
  const bodies = [...document.querySelectorAll('.schedule-grid > *')];
  const friday = cols.at(-1).getBoundingClientRect();
  const boundaryError = Math.max(...headings.map((el, i) => {
    const h = el.getBoundingClientRect(), b = bodies[i].getBoundingClientRect();
    return Math.max(Math.abs(h.left-b.left), Math.abs(h.right-b.right));
  }));
  check(Math.abs(grid.width - scroll.clientWidth) <= 1, `${label}: grid fills available width`);
  check(Math.abs(friday.right - bar.right) <= 1, `${label}: Friday aligns with green header`);
  check(boundaryError <= 1, `${label}: Time and weekday heading/body boundaries align`);
  check(scroll.scrollWidth <= scroll.clientWidth + 1, `${label}: no unnecessary horizontal overflow`);
  results.push({ label, available: scroll.clientWidth, grid: grid.width,
    headerRight: bar.right, fridayRight: friday.right, boundaryError });

  check([...document.querySelectorAll('.schedule-titlebar button')].every(el => { const r=el.getBoundingClientRect(); return r.left >= bar.left && r.right <= bar.right; }), `${label}: controls fit titlebar`);
}
function singleDay(label) {
  noRestoreControls();
  const rect = selector => document.querySelector(selector).getBoundingClientRect();
  const timeHead = rect('.time-head'), timeBody = rect('.time-col');
  const dayHead = rect('.day-head'), dayBody = rect('.day-col');
  const heading = rect('.schedule-head'), grid = rect('.schedule-grid');
  const scroll = document.querySelector('.schedule-scroll');
  const timeError = Math.abs(timeHead.right - timeBody.right);
  const dayError = Math.max(Math.abs(dayHead.left-dayBody.left), Math.abs(dayHead.right-dayBody.right));
  check(document.querySelectorAll('.day-col').length === 1, `${label}: one weekday`);
  check(timeError <= 1 && Math.abs(timeBody.width-72) <= 1, `${label}: matching 72px Time columns`);
  check([...document.querySelectorAll('.time-label')].every(el => Math.abs(el.getBoundingClientRect().right-timeHead.right) <= 1), `${label}: time cells align with heading`);
  check(dayError <= 1 && Math.abs(heading.width-grid.width) <= 1, `${label}: weekday heading and body edges align`);
  check(Math.abs(grid.width-scroll.clientWidth) <= 1 && Math.abs(dayBody.right-rect('.schedule-titlebar').right) <= 1, `${label}: fills container without blank strip`);
  check(scroll.scrollWidth <= scroll.clientWidth+1, `${label}: no horizontal overflow`);
  results.push({ label, timeHeaderRight: timeHead.right, timeBodyRight: timeBody.right,
    timeError, dayError, headingWidth: heading.width, gridWidth: grid.width });
}
async function run() {
  check(Intl.DateTimeFormat().resolvedOptions().timeZone === 'Europe/London', 'Rendered browser uses Europe/London timezone');
  mount(); await tick();
  check(innerWidth === 430 && document.querySelectorAll('.day-col').length === 1, '430px single-day mode');
  check(document.querySelector('[aria-label="Previous day"]') && document.querySelector('[aria-label="Next day"]') && document.querySelector('.schedule-date-input').value, 'Phone retains day navigation, date selector and bootstrap');
  for (const size of [320, 375, 390, 430, 767]) { await width(size); singleDay(`${size}px`); }
  for (const size of [768, 820, 1024, 1366]) { await width(size); fullWeek(`${size}px`); }
  // A narrow embedded card must scroll instead of shrinking unreadable tracks.
  const card = document.querySelector('.project-card');
  card.style.width = '500px'; await tick();
  const narrowScroll = document.querySelector('.schedule-scroll');
  check(narrowScroll.scrollWidth > narrowScroll.clientWidth && document.querySelector('.schedule-grid').getBoundingClientRect().width >= 662, 'Narrow container retains minimum width and permits scrolling');
  card.style.width = ''; await tick();
  await width(820);
  check(window.matchMedia('(pointer: coarse)').matches, 'Chrome touch emulation supplies a real coarse pointer');
  fullWeek('820px coarse pointer');
  click(document.querySelector('[aria-label="Go to next week"]')); await tick();
  const chosenWeek = loadedDates.at(-1), before = loadedDates.length;
  click(document.querySelector('.lesson-card:not(.lesson-card--empty)'));
  const title = document.querySelector('#lesson-title-input');
  check(Boolean(title), 'Lesson editing available on tablet');
  flushSync(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(title, 'Unsaved tablet draft');
    title.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await width(430);
  check(document.querySelectorAll('.day-col').length === 1 && loadedDates.length === before, `Phone resize keeps chosen week without reloading (columns=${document.querySelectorAll('.day-col').length}, loads=${loadedDates.length}/${before})`);
  check(document.querySelector('#lesson-title-input').value === 'Unsaved tablet draft', 'Phone resize preserves unsaved modal draft');
  await width(768); fullWeek('Resized tablet');
  check(document.querySelector('#lesson-title-input').value === 'Unsaved tablet draft' && loadedDates.at(-1) === chosenWeek && calls.length === 0, 'Tablet resize preserves week and draft without saving');
  click(document.querySelector('.lesson-modal-cancel'));
  check(document.querySelectorAll('.lesson-card:not(.lesson-card--empty)').length === 1, 'Resize preserves lesson');
  mode = 'fixed'; mount(); await tick(); fullWeek('Input Classes tablet');
  const palette = document.querySelector('.class-placement-chip');
  check(palette && !palette.disabled && palette.draggable, 'Tablet palette remains interactive and draggable');
  palette.focus(); check(document.activeElement === palette, 'Tablet palette can receive keyboard focus');
  click(palette); click(document.querySelector('.lesson-card--empty'));
  check(calls.length === 1 && calls[0].sessions.length === 2, 'Tablet tap placement makes one edit');
  hiddenAnnouncement('.class-placement-status');
  check(document.querySelector('.class-placement-status').textContent.includes('Class placed'), 'Placement success still announced');
  const paletteBottom = document.querySelector('.class-placement-palette').getBoundingClientRect().bottom;
  check(Math.abs(document.querySelector('.schedule-dynamic').getBoundingClientRect().top-paletteBottom) <= 1, 'No placement status strip between palette and grid');
  // Selecting a class then choosing an occupied destination requires action.
  click(document.querySelector('.class-placement-chip'));
  const occupied = document.querySelector('.lesson-card--placed').closest('.slot');
  const transfer = new DataTransfer();
  flushSync(() => document.querySelector('.class-placement-chip').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer })));
  flushSync(() => occupied.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })));
  check(!document.querySelector('.class-placement-status').classList.contains('timetable-announcement') && document.querySelector('.class-placement-status').getBoundingClientRect().height > 1, 'Invalid placement feedback remains visible');

  for (const size of [320, 375, 390, 430]) {
    await width(size); mount(); await tick(); calls = [];
    singleDay(`Input Classes ${size}px`);
    check(document.querySelector('.schedule-day-label').textContent === 'Monday', 'Fixed phone starts on Monday');
    check(!document.querySelector('.schedule-date-input') && !document.querySelector('.schedule-day-today') && !document.body.textContent.includes('Week commencing'), 'Fixed phone has no calendar controls');
    const next = () => click(document.querySelector('[aria-label="Next day"]'));
    click(document.querySelector('[aria-label="Previous day"]'));
    check(document.querySelector('.schedule-day-label').textContent === 'Friday', 'Previous wraps Monday to Friday');
    next(); check(document.querySelector('.schedule-day-label').textContent === 'Monday', 'Next wraps Friday to Monday');
    for (const day of ['Tuesday', 'Wednesday', 'Thursday', 'Friday']) { next(); check(document.querySelector('.schedule-day-label').textContent === day, `Navigates to ${day}`); }
    next(); next(); // Tuesday
    check(calls.length === 0, 'Day navigation does not save or change week');
    click(document.querySelector('.class-placement-chip')); click(document.querySelector('.lesson-card--empty'));
    check(calls.length === 1 && calls[0].target.weekId === 'A' && calls[0].sessions.some(s => s.day === 1), 'Phone placement targets visible Tuesday in Week A');
    check(document.querySelector('.schedule-day-label').textContent === 'Tuesday', 'Saving preserves selected weekday');
    click(document.querySelector('.lesson-card-action'));
    check(document.querySelector('.lesson-modal-class').textContent === 'Tue', 'Modal edits visible weekday');
    click(document.querySelector('.lesson-modal-cancel'));
    check(document.querySelector('.schedule-day-label').textContent === 'Tuesday', 'Modal cancellation preserves weekday');
    click(document.querySelector('#week-b')); await tick();
    check(document.querySelector('.schedule-week-label').textContent === 'Week B' && !document.querySelector('.lesson-card--placed'), 'Week B displays its own empty Tuesday');
    click(document.querySelector('.class-placement-chip')); click(document.querySelector('.lesson-card--empty'));
    check(calls.length === 2 && calls[1].target.weekId === 'B' && calls[1].sessions.length === 1 && calls[1].sessions[0].day === 1, 'Week B saves independently');
    check(document.querySelector('.class-placement-chip').disabled, 'Combined A/B frequency limit remains enforced');
    click(document.querySelector('#week-a')); await tick();
    check(state.recurring[0].sessions.length === 2 && state.recurring[1].sessions.length === 1 && document.querySelector('.lesson-card--placed'), 'Week A/B placements remain separate and intact');
  }
  for (const size of [768, 820, 1024, 1366]) { await width(size); fullWeek(`Input Classes ${size}px`); }

  // These tests drive the actual toolbar against session-state boundary states;
  // the provider browser suite separately exercises real queue success/recovery.
  for (const view of ['date', 'fixed']) {
    mode = view; mount(); await tick(); calls = []; observeSave = true;
    noRestoreControls();
    const getButton = label => [...document.querySelectorAll('button')].find(e => e.textContent.trim() === label);
    click(document.querySelector('.lesson-card-action') || document.querySelector('.lesson-card:not(.lesson-card--empty)'));
    const title = document.querySelector('#lesson-title-input');
    flushSync(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(title, 'Edited lesson'); title.dispatchEvent(new Event('input', { bubbles: true })); });
    click(document.querySelector('.lesson-modal-save'));
    check(calls.length === 1 && calls[0].sessions[0].title === 'Edited lesson' && document.body.textContent.includes('Saving…'), `${view}: lesson edit starts autosave with Saving announcement`);
    check(!getButton('Save'), `${view}: no timetable manual Save button`);
    noRoutineStrip();
    flushSync(() => feedbackUpdate({ saved: true, overrideExists: view === 'date', requestReference: 'test-reference' }));
    check(document.querySelector('.timetable-save-status').textContent.trim() === 'Saved', `${view}: successful save announces Saved`);
    noRoutineStrip();
    check(!document.body.textContent.includes('Support reference:'), 'No support reference without an error');
    if (view === 'date') check(Boolean(getButton('Restore repeating timetable')), 'Dated override restore control retained without banner');
    flushSync(() => feedbackUpdate({ error: 'Save failed', conflict: true, unsaved: true, requestReference: 'test-reference' }));
    check(document.body.textContent.includes('Save failed') && document.body.textContent.includes('The timetable changed elsewhere.'), `${view}: save error and conflict remain visible`);
    check([...document.querySelectorAll('.classes-hint--error')].every(el => el.getBoundingClientRect().height > 1 && getComputedStyle(el).position !== 'absolute'), `${view}: actionable errors occupy visible layout`);
    check(document.body.textContent.includes('Support reference: test-reference'), `${view}: support reference accompanies error`);
    const retries = retryCalls, reloads = reloadCalls;
    click(getButton('Retry save')); click(getButton('Reload'));
    check(retryCalls === retries+1 && reloadCalls === reloads+1, `${view}: recovery buttons call retry and reload`);
    flushSync(() => feedbackUpdate({})); observeSave = false;
    if (view === 'date') {
      check(!getButton('Clear this week'), 'Dated timetable has no Clear this week control');
      click(document.querySelector('.lesson-card:not(.lesson-card--empty)'));
      const select = document.querySelector('#lesson-class-input');
      flushSync(() => { select.value = ''; select.dispatchEvent(new Event('change', { bubbles: true })); });
      const beforeRemove = calls.length; click(document.querySelector('.lesson-modal-save'));
      check(calls.length === beforeRemove+1 && calls.at(-1).sessions.length === 0, 'Dated individual lesson removal still saves');
      continue;
    }
    const clear = getButton('Clear timetable');
    check(Boolean(clear), 'Input Classes retains Clear timetable');
    let confirmations = 0; const originalConfirm = window.confirm;
    window.confirm = () => { confirmations++; return false; };
    const beforeClear = calls.length; click(clear);
    check(confirmations === 1 && calls.length === beforeClear, `${view}: cancelled Clear makes no edit`);
    window.confirm = () => { confirmations++; return true; }; click(clear);
    check(confirmations === 2 && calls.length === beforeClear+1 && calls.at(-1).sessions.length === 0, `${view}: confirmed Clear saves empty collection`);
    window.confirm = originalConfirm;
  }
  mode = 'date'; allowEditing = false; mount(); await tick();
  noRestoreControls();
  check(!document.querySelector('.schedule-titlebar-actions') && !document.body.textContent.includes('Clear this week'), 'Main read-only toolbar has no empty action gap or Clear this week');


  testPageSpacing = true;
  for (const size of [375, 820, 1366]) {
    await width(size); mode = 'date'; mount(); await tick();
    const section = document.querySelector('.main-timetable-section');
    const card = document.querySelector('.project-card').getBoundingClientRect();
    const nav = document.querySelector('#site-header-fixture').getBoundingClientRect();
    const gap = card.top-nav.bottom;
    const expected = Math.min(52, Math.max(36, size*.04));
    check(Math.abs(gap-expected) <= 1, `${size}px: main timetable spacing is outside card`);
    noRoutineStrip();
    check(Math.abs(card.width-section.getBoundingClientRect().width) <= 1, `${size}px: wrapper preserves container width`);
    results.push({ viewport: size, mainTimetableGap: gap });
    mode = 'fixed'; mount(); await tick();
    check(!document.querySelector('.main-timetable-section') && Math.abs(document.querySelector('.project-card').getBoundingClientRect().top-document.querySelector('#site-header-fixture').getBoundingClientRect().bottom) <= 1, `${size}px: no additional spacing on Input Classes`);
  }

  testPageSpacing = false; allowEditing = true; mode = 'fixed'; observeSave = true; mount(); await tick(); calls = [];
  const placementStatus = () => document.querySelector('.class-placement-status');
  const saveStatus = () => document.querySelector('.timetable-save-status');
  const lessonSlot = (day, row) => document.querySelectorAll('.day-col')[day].querySelectorAll('.slot')[row];
  const completeSave = () => flushSync(() => feedbackUpdate({ saved: true }));
  const dragLesson = (source, target) => {
    const transfer = new DataTransfer();
    flushSync(() => source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer })));
    flushSync(() => target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer })));
    flushSync(() => target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })));
    flushSync(() => source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer })));
  };
  click(document.querySelector('.class-placement-chip')); click(lessonSlot(0, 1).querySelector('.lesson-card--empty'));
  check(placementStatus().textContent.includes('Class placed') && !placementStatus().textContent.includes('Saving') && saveStatus().textContent.trim() === 'Saving…', 'Placement and persistence have separate live-region ownership while pending');
  hiddenAnnouncement('.class-placement-status'); completeSave();
  check(saveStatus().textContent.trim() === 'Saved' && !placementStatus().textContent.includes('Saving'), 'Placement announcement remains accurate after successful save');
  const firstPlacementAnnouncement = placementStatus().textContent;
  click(lessonSlot(1, 1).querySelector('.lesson-card--empty'));
  check(placementStatus().textContent !== firstPlacementAnnouncement && placementStatus().textContent.includes('Tuesday at 10:00')
    && saveStatus().textContent.trim() === 'Saving…', 'Rapid second placement replaces the older announcement with its own destination');
  completeSave();
  dragLesson(lessonSlot(0, 0).querySelector('.lesson-card--placed'), lessonSlot(1, 0));
  check(placementStatus().textContent.includes('Lesson moved') && saveStatus().textContent.trim() === 'Saving…', 'Move announces interaction and one persistence region announces saving');
  completeSave(); check(!placementStatus().textContent.includes('Saving') && saveStatus().textContent.trim() === 'Saved', 'Move status stays accurate after settlement');
  dragLesson(lessonSlot(1, 0).querySelector('.lesson-card--placed'), lessonSlot(0, 1));
  check(placementStatus().textContent.includes('Lessons swapped') && saveStatus().textContent.trim() === 'Saving…', 'Swap announces interaction without stale persistence wording');
  completeSave();
  dragLesson(lessonSlot(0, 1).querySelector('.lesson-card--placed'), document.querySelector('.class-placement-return'));
  check(placementStatus().textContent.includes('removed from') && !placementStatus().textContent.includes('Saving') && saveStatus().textContent.trim() === 'Saving…', 'Return-to-palette removal keeps persistence wording in save region only');
  flushSync(() => feedbackUpdate({ error: 'Save failed', conflict: true, unsaved: true, requestReference: 'test-reference' }));
  check(document.querySelector('.classes-hint--error')?.getBoundingClientRect().height > 1
    && document.querySelector('.class-placement-instructions[role="status"]')?.getBoundingClientRect().height > 1
    && !placementStatus().textContent.includes('Saving'),
  'Pending removal to failed save exposes error and blocked placement guidance without stale progress');
  const recoveryButton = label => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === label);
  const retryBefore = retryCalls, reloadBefore = reloadCalls;
  click(recoveryButton('Retry save')); click(recoveryButton('Reload'));
  check(retryCalls === retryBefore + 1 && reloadCalls === reloadBefore + 1, 'Failed placement recovery retains Retry and Reload actions');
  completeSave(); check(saveStatus().textContent.trim() === 'Saved' && placementStatus().textContent.includes('removed from'), 'Removal announcement does not become stale after successful save');
  click(document.querySelector('.class-placement-chip'));
  check(placementStatus().textContent.includes('Class selected'), 'New selection supersedes prior removal announcement');
  flushSync(() => feedbackUpdate({ saved: true }));
  check(placementStatus().textContent.includes('Class selected') && saveStatus().textContent.trim() === 'Saved',
    'Later selection survives an earlier save-status completion');
  click([...document.querySelectorAll('.class-placement-instructions button')].find(button => button.textContent === 'Cancel placement'));
  check(placementStatus().textContent.includes('cancelled') && !placementStatus().textContent.includes('Class selected'), 'Cancellation clears obsolete selection instruction');
  check(saveStatus().textContent.trim() === 'Saved' && !placementStatus().textContent.includes('Saving'), 'Recovery does not reintroduce stale placement saving text');
  click(document.querySelector('#week-b')); await tick();
  check(!placementStatus().textContent.trim(), 'Week change clears obsolete placement announcement');
  observeSave = false;

  // The same ProjectCard fixture now exercises the saved Events row with a mocked,
  // abort-aware API. No authenticated or production service is contacted.
  mode = 'date'; allowEditing = false;
  fixtureUserId = '30000000-0000-4000-8000-000000000001';
  fixtureAcademicYear = { id: '00000000-0000-4000-8000-000000000001', startDate: '2026-01-01', endDate: '2027-12-31', holidays: [] };
  const nextDate = (day, offset) => {
    const value = new Date(`${day}T12:00:00`); value.setDate(value.getDate() + offset);
    return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
  };
  const event = (id, date, title, startTime = null, endTime = null, location = '', notes = '') =>
    ({ id, date, title, startTime, endTime, location, notes });
  let responseMode = 'ready', pendingResolve, pendingReject;
  eventResponder = (_year, request) => {
    if (responseMode === 'pending') return new Promise((resolve, reject) => { pendingResolve = resolve; pendingReject = reject; });
    if (responseMode === 'error') return Promise.reject({ requestId: '00000000-0000-4000-8000-000000000099' });
    return Promise.resolve({ events: [
      event('holiday', nextDate(request.from, 4), 'Half-term activity'),
      event('saturday-late', nextDate(request.from, 5), 'Museum trip', '14:00', '16:00', 'Very long location '.repeat(25), '<script>Plain notes</script>'),
      event('saturday-all', nextDate(request.from, 5), 'All-day community fair'),
      event('saturday-early', nextDate(request.from, 5), 'Morning event', '09:00', '10:00'),
      event('sunday', nextDate(request.from, 6), 'Sunday event'),
    ] });
  };
  eventRequests = []; mount(); await tick();
  check(!document.querySelector('.schedule-events-weekend')
    && document.querySelector('.schedule-events-day[aria-label="Fri events"]').textContent.includes('Half-term activity'),
  'Unsaved preference hides weekend rows while retaining weekday events');
  for (const size of [320, 375, 390, 430]) {
    await width(size);
    const fridayDate = nextDate(eventRequests.at(-1).from, 4);
    const dateInput = document.querySelector('.schedule-date-input');
    flushSync(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(dateInput, fridayDate);
      dateInput.dispatchEvent(new Event('input', { bubbles: true })); dateInput.dispatchEvent(new Event('change', { bubbles: true })); });
    await tick();
    check(document.querySelector('.schedule-day-label').textContent.includes('Friday')
      && !document.querySelector('.schedule-events-weekend-only'), `${size}px: unsaved preference shows weekdays only`);
    click(document.querySelector('[aria-label="Next day"]')); await tick();
    check(document.querySelector('.schedule-day-label').textContent.includes('Monday')
      && !document.querySelector('.schedule-events-weekend-only'), `${size}px: next day skips weekend when not enabled`);
    const saturdayDate = nextDate(eventRequests.at(-1).from, 5);
    flushSync(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(dateInput, saturdayDate);
      dateInput.dispatchEvent(new Event('input', { bubbles: true })); dateInput.dispatchEvent(new Event('change', { bubbles: true })); });
    await tick();
    check(document.querySelector('.schedule-day-label').textContent.includes('Friday')
      && !document.querySelector('.schedule-events-weekend-only'), `${size}px: date picker cannot expose weekend without opt-in`);
  }
  check(writeWeekendEventsPreference(fixtureUserId, true), 'Explicit opt-in enables weekend cards');
  await tick(); await width(820);
  check(eventRequests.length >= 1 && eventRequests.at(-1).yearId === fixtureAcademicYear.id
    && nextDate(eventRequests.at(-1).from, 6) === eventRequests.at(-1).to, 'Dated timetable requests an authenticated week range, Monday through Sunday');
  check(document.querySelector('.schedule-events-day[aria-label="Fri events"]').textContent.includes('Half-term activity'), 'Events display on holiday dates');
  check(!document.querySelector('.schedule-events-day[aria-label="Fri events"]').querySelector('.lesson-card'), 'Holiday event is separate from lesson slots');
  const saturdayCards = [...document.querySelectorAll('.schedule-events-weekend-day')][0].querySelectorAll('.schedule-event-card');
  check([...saturdayCards].map(card => card.querySelector('strong').textContent).join('|') === 'All-day community fair|Morning event|Museum trip', 'Weekend events sort all-day first, then local time');
  check(saturdayCards[0].textContent.includes('All day') && saturdayCards[1].textContent.includes('09:00–10:00')
    && saturdayCards[2].textContent.includes('Very long location'), 'Cards show all-day, timed and location details');
  check([...document.querySelectorAll('.schedule-events-weekend-day')].every((row, index) =>
    row.querySelector('strong').textContent === ['Saturday', 'Sunday'][index]),
  'Saturday and Sunday row labels contain only weekday names');
  const notes = saturdayCards[2].querySelector('summary'); notes.focus();
  check(document.activeElement === notes && !saturdayCards[2].querySelector('script'), 'Notes are keyboard accessible and rendered as text');
  notes.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); click(notes);
  check(saturdayCards[2].querySelector('details').open && saturdayCards[2].textContent.includes('<script>Plain notes</script>'), 'Notes can be revealed without HTML execution');
  check(document.querySelector('.schedule-events-manage').getAttribute('href') === '/settings/events', 'Manage Events link opens Settings Events');
  document.querySelector('.schedule-events-manage').focus();
  check(document.activeElement === document.querySelector('.schedule-events-manage'), 'Manage Events link accepts keyboard focus');
  for (const size of [320, 375, 390, 430, 768, 820, 1024, 1366]) {
    await width(size);
    const scroll = document.querySelector('.schedule-scroll');
    const eventRow = document.querySelector('.schedule-events-row');
    const scheduleGrid = document.querySelector('.schedule-grid');
    const headings = [...document.querySelectorAll('.schedule-head > *')];
    const eventCells = [...eventRow.children];
    const columnError = Math.max(...eventCells.map((cell, index) => {
      const heading = headings[index].getBoundingClientRect(), event = cell.getBoundingClientRect();
      return Math.max(Math.abs(heading.left - event.left), Math.abs(heading.right - event.right));
    }));
    check(eventRow.getBoundingClientRect().top >= scheduleGrid.getBoundingClientRect().bottom - 1
      && columnError <= 1, `${size}px: event cells follow final period and align with weekday headings`);
    check(document.documentElement.scrollWidth <= innerWidth + 1, `${size}px: event text does not cause page overflow`);
    if (size < 768) {
      check(Math.abs(eventRow.getBoundingClientRect().left - document.querySelector('.schedule-grid').getBoundingClientRect().left) <= 1
        && Math.abs(eventRow.getBoundingClientRect().right - document.querySelector('.schedule-grid').getBoundingClientRect().right) <= 1,
      `${size}px: event row aligns with single-day lesson grid`);
    } else {
      check(Math.abs(eventRow.getBoundingClientRect().left - document.querySelector('.schedule-grid').getBoundingClientRect().left) <= 1
        && Math.abs(eventRow.getBoundingClientRect().right - document.querySelector('.schedule-grid').getBoundingClientRect().right) <= 1
        && scroll.scrollWidth <= scroll.clientWidth + 1, `${size}px: event row aligns with full-week grid without overflow`);
      const [saturdayRow, sundayRow] = document.querySelectorAll('.schedule-events-weekend-day');
      const cards = [...saturdayRow.querySelectorAll('.schedule-event-card')];
      check(sundayRow.getBoundingClientRect().top >= saturdayRow.getBoundingClientRect().bottom - 1
        && Math.abs(cards[0].getBoundingClientRect().top - cards[1].getBoundingClientRect().top) <= 1
        && (size <= 820 ? cards[2].getBoundingClientRect().top > cards[0].getBoundingClientRect().top + 1
          : Math.abs(cards[2].getBoundingClientRect().top - cards[0].getBoundingClientRect().top) <= 1)
        && cards.every(card => card.getBoundingClientRect().right <= saturdayRow.getBoundingClientRect().right + 1),
      `${size}px: stacked weekend rows contain horizontal cards that wrap within the viewport`);
    }
  }
  for (const size of [320, 375, 390, 430]) {
    await width(size);
    const saturdayDate = nextDate(eventRequests.at(-1).from, 5);
    const picker = document.querySelector('.schedule-date-input');
    flushSync(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(picker, saturdayDate);
      picker.dispatchEvent(new Event('input', { bubbles: true })); picker.dispatchEvent(new Event('change', { bubbles: true })); });
    await tick();
    check(document.querySelector('.schedule-day-label').textContent.includes('Saturday')
      && document.querySelector('.schedule-events-weekend-only')?.textContent.includes('Museum trip')
      && !document.querySelector('.schedule-grid'), `${size}px: explicit opt-in shows Saturday events without teaching slots`);
    click(document.querySelector('[aria-label="Next day"]'));
    check(document.querySelector('.schedule-day-label').textContent.includes('Sunday')
      && document.querySelector('.schedule-events-weekend-only')?.textContent.includes('Sunday event'),
    `${size}px: explicit opt-in navigates to Sunday events`);
    check(document.documentElement.scrollWidth <= innerWidth + 1, `${size}px: opted-in weekend has no horizontal overflow`);
  }
  await width(820);
  check(writeWeekendEventsPreference(fixtureUserId, false), 'Weekend preference can be stored for first user');
  await tick();
  check(!document.querySelector('.schedule-events-weekend')
    && document.querySelector('.schedule-events-day[aria-label="Fri events"]').textContent.includes('Half-term activity'),
  'Hiding weekend cards leaves weekday events and lessons intact');
  await width(430);
  const hiddenWeekendDate = nextDate(eventRequests.at(-1).from, 5);
  const hiddenWeekendInput = document.querySelector('.schedule-date-input');
  flushSync(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(hiddenWeekendInput, hiddenWeekendDate);
    hiddenWeekendInput.dispatchEvent(new Event('input', { bubbles: true })); hiddenWeekendInput.dispatchEvent(new Event('change', { bubbles: true })); });
  await tick();
  check(document.querySelector('.schedule-day-label').textContent.includes('Friday')
    && !document.querySelector('.schedule-events-weekend-only') && document.querySelector('.schedule-grid'),
  'Explicitly disabled preference keeps phone on weekday teaching slots');
  check(writeWeekendEventsPreference(fixtureUserId, true), 'Weekend preference can be restored');
  await tick(); await width(820);
  check(document.querySelectorAll('.schedule-events-weekend-day').length === 2, 'Restoring preference shows both weekend rows');
  const firstUser = fixtureUserId;
  fixtureUserId = '30000000-0000-4000-8000-000000000002'; mount(); await tick();
  check(!document.querySelector('.schedule-events-weekend'), 'Second user has no inherited weekend opt-in');
  check(writeWeekendEventsPreference(fixtureUserId, true), 'Second user can opt in independently');
  await tick(); check(document.querySelectorAll('.schedule-events-weekend-day').length === 2, 'Second user opt-in shows weekend rows');
  check(writeWeekendEventsPreference(fixtureUserId, false), 'Second user preference persists separately');
  await tick(); check(!document.querySelector('.schedule-events-weekend'), 'Second user can hide weekend cards');
  fixtureUserId = firstUser; mount(); await tick();
  check(document.querySelectorAll('.schedule-events-weekend-day').length === 2, 'First user keeps their own enabled preference');
  await width(430);
  const today = document.querySelector('.schedule-date-input').value;
  const saturday = nextDate(eventRequests.at(-1).from, 5);
  const input = document.querySelector('.schedule-date-input');
  flushSync(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, saturday); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
  await tick();
  check(document.querySelector('.schedule-day-label').textContent.includes('Saturday')
    && !document.querySelector('.schedule-grid') && document.querySelector('.schedule-events-weekend-only').textContent.includes('Museum trip'),
  'Phone date picker reaches Saturday and shows its events without teaching slots');
  click(document.querySelector('[aria-label="Next day"]'));
  check(document.querySelector('.schedule-day-label').textContent.includes('Sunday') && document.querySelector('.schedule-events-weekend-only').textContent.includes('Sunday event'),
    'Phone next-day navigation reaches Sunday');
  click(document.querySelector('[aria-label="Next day"]')); await tick();
  check(document.querySelector('.schedule-day-label').textContent.includes('Monday') && eventRequests.at(-1).from !== eventRequests[0].from,
    'Phone navigation rolls from Sunday into next week');
  check(!document.querySelector('.class-placement-palette'), 'Dated Events view does not add Input Classes palette');
  check(today !== document.querySelector('.schedule-date-input').value, 'Weekend navigation changes the selected date');

  await width(820);
  responseMode = 'pending'; click(document.querySelector('[aria-label="Go to next week"]')); await tick();
  const staleResolve = pendingResolve, staleRequest = eventRequests.at(-1);
  check(!document.querySelector('.schedule-events').textContent.includes('Museum trip')
    && getComputedStyle(document.querySelector('.schedule-events [role="status"]')).position === 'absolute',
  'Pending week clears previous events immediately and hides routine loading status');
  responseMode = 'error'; click(document.querySelector('[aria-label="Go to next week"]')); await tick();
  check(staleRequest.signal.aborted && document.querySelector('.schedule-events-error')?.textContent.includes('Could not load events')
    && document.querySelector('.schedule-events-error')?.textContent.includes('Support reference'), 'Scope change aborts old request and displays safe visible error');
  staleResolve({ events: [event('stale', staleRequest.from, 'Stale event')] }); await tick();
  check(!document.body.textContent.includes('Stale event') && document.querySelector('.schedule-events-error'), 'Late success cannot replace newer-scope error');
  document.querySelector('.schedule-events-error button').focus();
  check(document.activeElement === document.querySelector('.schedule-events-error button'), 'Visible Retry button accepts keyboard focus');
  responseMode = 'ready'; click(document.querySelector('.schedule-events-error button')); await tick();
  check(!document.querySelector('.schedule-events-error') && document.querySelector('.schedule-events-row')
    && getComputedStyle(document.querySelector('.schedule-events [role="status"]')).position === 'absolute',
  'Retry recovers events and routine status remains visually hidden');
  responseMode = 'pending'; click(document.querySelector('[aria-label="Go to next week"]')); await tick();
  const oldYearReject = pendingReject, oldYearRequest = eventRequests.at(-1);
  fixtureAcademicYear = { ...fixtureAcademicYear, id: '00000000-0000-4000-8000-000000000002' };
  responseMode = 'ready'; flushSync(() => root.render(<Harness key={Math.random()} />)); await tick();
  check(oldYearRequest.signal.aborted && eventRequests.at(-1).yearId === fixtureAcademicYear.id
    && !document.body.textContent.includes('Could not load events'), 'Year change aborts old scope and loads the selected year');
  oldYearReject(new Error('synthetic old-year error')); await tick();
  check(!document.body.textContent.includes('Could not load events'), 'Late old-year failure cannot replace new-year events');
  responseMode = 'pending'; click(document.querySelector('[aria-label="Go to next week"]')); await tick();
  const lateReject = pendingReject, abandoned = eventRequests.at(-1);
  mode = 'fixed'; mount(); await tick();
  lateReject(new Error('synthetic late error')); await tick();
  check(abandoned.signal.aborted && !document.querySelector('.schedule-events'), 'Unmount aborts event request and Input Classes renders no dated events');
  mode = 'date'; fixtureAcademicYear = {
    id: '00000000-0000-4000-8000-000000000003', startDate: '2027-03-28', endDate: '2027-10-31', holidays: [],
  };
  responseMode = 'ready'; eventRequests = []; await width(430); mount(); await tick();
  const chooseLocalDate = value => {
    const field = document.querySelector('.schedule-date-input');
    flushSync(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  chooseLocalDate('2027-03-28'); await tick();
  check(document.querySelector('.schedule-date-input').value === '2027-03-28'
    && document.querySelector('.schedule-day-label').textContent.includes('Sunday')
    && document.querySelector('.schedule-events-weekend-only').textContent.includes('Sunday event')
    && eventRequests.at(-1).from === '2027-03-22',
  'Spring DST Sunday at academic-year start selects index 6 and the correct week/event');
  click(document.querySelector('[aria-label="Previous day"]'));
  check(document.querySelector('.schedule-date-input').value === '2027-03-27'
    && document.querySelector('.schedule-events-weekend-only').textContent.includes('Museum trip')
    && !document.querySelector('.schedule-events-weekend-only').textContent.includes('Sunday event'),
  'Spring DST Saturday and Sunday events remain distinct');
  chooseLocalDate('2027-10-31'); await tick();
  check(document.querySelector('.schedule-date-input').value === '2027-10-31'
    && document.querySelector('.schedule-day-label').textContent.includes('Sunday')
    && document.querySelector('.schedule-events-weekend-only').textContent.includes('Sunday event')
    && eventRequests.at(-1).from === '2027-10-25',
  'Autumn DST Sunday at academic-year end selects index 6 and the correct week/event');
  click(document.querySelector('[aria-label="Previous day"]'));
  check(document.querySelector('.schedule-date-input').value === '2027-10-30'
    && document.querySelector('.schedule-events-weekend-only').textContent.includes('Museum trip'),
  'Autumn DST Saturday stays distinct from Sunday');
  fixtureAcademicYear = null;

}
run().then(() => { parent.document.body.dataset.testResult='passed'; }, error => { parent.document.body.dataset.testResult='failed'; results.push(error.stack); }).finally(() => {
  const report=parent.document.createElement('pre'); report.textContent=JSON.stringify(results,null,2); parent.document.body.append(report);
});
