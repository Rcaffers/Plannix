import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import ProjectCard from './ProjectCard.jsx';

const entries = [{ id: '7a', name: '7A', frequency: 3 }];
const periods = [{ id: 'p1', type: 'teaching', number: 1 }, { id: 'p2', type: 'teaching', number: 2 }];
const rowSegments = periods.map((p, i) => ({ kind: 'lesson', rowIndex: i, timeLabel: i ? '10:00' : '09:00', rangeLabel: i ? '10:00 – 11:00' : '09:00 – 10:00' }));
export const useAcademicYear = () => ({ academicYear: null });
export const useClasses = () => ({ authoritativeEntries: entries });
export const useTimetableLayout = () => ({ layout: { cycle: 'weekly' }, dayLabels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], rowSegments });
let state;
export const useTimetableSessions = () => state;
const initial = { id: 'lesson', day: 0, periodId: 'p1', classId: '7a', title: 'Fractions', notes: 'Rulers' };
let calls = [];
const scope = {}; const loadedDates = []; let mode = 'date';
function Harness() {
  const [sessions, setSessions] = useState([initial]);
  state = { scope, revision: 1, periods, dated: { sessions }, loadDate(date) { loadedDates.push(date); }, recurring: [{ code: 'A', weekId: 'A', sessions }],
    edit(target, next) { calls.push({ target, sessions: next }); setSessions(next); return true; } };
  return <ProjectCard project={{ title: 'Test' }} weekMode={mode} enableClassPlacement />;
}
const root = createRoot(document.body.appendChild(document.createElement('div')));
const results = [];
function check(value, message) { if (!value) throw Error(message); results.push(message); }
const tick = () => new Promise(resolve => setTimeout(resolve, 100));
const click = el => flushSync(() => el.click());
async function width(value) { frameElement.style.width = `${value}px`; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); await tick(); }
function mount() { flushSync(() => root.render(<Harness key={Math.random()} />)); }
function fullWeek(label) {
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
}
run().then(() => { parent.document.body.dataset.testResult='passed'; }, error => { parent.document.body.dataset.testResult='failed'; results.push(error.stack); }).finally(() => {
  const report=parent.document.createElement('pre'); report.textContent=JSON.stringify(results,null,2); parent.document.body.append(report);
});
