import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import ProjectCard from './ProjectCard.jsx';

const entries = [{ id: '7a', name: '7A', frequency: 3 }];
const periods = [{ id: 'p1', type: 'teaching', number: 1 }, { id: 'p2', type: 'teaching', number: 2 }];
const rowSegments = periods.map((p, i) => ({ kind: 'lesson', rowIndex: i, timeLabel: i ? '10:00' : '09:00', rangeLabel: i ? '10:00 – 11:00' : '09:00 – 10:00' }));
export const useAcademicYear = () => ({ academicYear: null });
export const useClasses = () => ({ authoritativeEntries: entries });
export const useTimetableLayout = () => ({ layout: { cycle: 'weekly' }, dayLabels: ['Mon'], rowSegments });
let state;
export const useTimetableSessions = () => state;
const initial = { id: 'lesson', day: 0, periodId: 'p1', classId: '7a', title: 'Fractions', notes: 'Rulers' };
let calls = [];
function Harness() {
  const [sessions, setSessions] = useState([initial]);
  state = { scope: {}, revision: 1, periods, recurring: [{ code: 'A', weekId: 'A', sessions }],
    edit(target, next) { calls.push({ target, sessions: next }); setSessions(next); return true; } };
  return <ProjectCard project={{ title: 'Test' }} weekMode="fixed" enableClassPlacement />;
}
const root = createRoot(document.body.appendChild(document.createElement('div')));
const results = [];
function check(value, message) { if (!value) throw Error(message); results.push(message); }
const click = el => flushSync(() => el.click());
const button = text => [...document.querySelectorAll('.lesson-modal button')].find(el => el.textContent.trim() === text);
function mount() { calls = []; flushSync(() => root.render(<Harness key={Math.random()} />)); }
function open() { const source = document.querySelector('.lesson-card-action'); source.focus(); click(source); }
function layout() {
  const modal = document.querySelector('.lesson-modal');
  const r = modal.getBoundingClientRect();
  check(r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, 'Modal fits viewport');
  check(modal.scrollWidth <= modal.clientWidth, 'Modal has no horizontal overflow');
  check(getComputedStyle(modal).overflowY === 'auto', 'Modal scrolls internally on short screens');
  for (const el of modal.querySelectorAll('button,input,select,textarea')) {
    const b = el.getBoundingClientRect();
    check(b.left >= r.left && b.right <= r.right, 'Control fits modal width');
  }
  const a = button('Move lesson').getBoundingClientRect(), b = button('Remove from timetable').getBoundingClientRect();
  check(a.right <= b.left || a.bottom <= b.top, 'Secondary buttons do not overlap');
}
try {
  mount(); click(document.querySelector('.lesson-card--empty'));
  check(document.querySelector('#lesson-modal-title').textContent === 'Assign class', 'Empty slot heading is Assign class');
  check(!document.querySelector('.lesson-modal-secondary-actions'), 'Empty slot has no placement actions');
  click(button('Cancel')); open();
  check(document.querySelector('#lesson-modal-title').textContent === 'Edit lesson', 'Populated heading is Edit lesson');
  check([...document.querySelectorAll('.lesson-modal-actions button')].map(e => e.textContent.trim()).join(',') === 'Cancel,Save', 'Main footer contains only Cancel and Save');
  check(document.querySelector('.lesson-modal-secondary-actions').contains(button('Move lesson')) && document.querySelector('.lesson-modal-secondary-actions').contains(button('Remove from timetable')), 'Move and Remove occupy separate secondary group');
  check(!document.querySelector('.lesson-modal-secondary-actions').contains(document.querySelector('.lesson-modal-bump')), 'Detail shift controls remain separate');
  check(document.querySelector('#lesson-title-input').value === 'Fractions' && document.querySelector('#lesson-notes-input').value === 'Rulers', 'Title and notes remain editable with existing values');
  button('Move lesson').focus(); check(document.activeElement === button('Move lesson'), 'Move action receives keyboard focus');
  layout();
  click(button('Move lesson'));
  check(!document.querySelector('.lesson-modal') && calls.length === 0, 'Move closes modal without prematurely saving');
  click(document.querySelector('.lesson-card--empty'));
  check(calls.length === 1 && calls[0].target.weekId === 'A' && calls[0].sessions[0].periodId === 'p2' && calls[0].sessions[0].notes === initial.notes, 'Move uses existing atomic placement save and preserves details');
  mount(); open(); click(button('Remove from timetable'));
  check(calls.length === 1 && calls[0].sessions.length === 0 && calls[0].target.weekId === 'A', 'Remove uses existing validated removal save');
  mount(); open(); click(button('Cancel')); check(!document.querySelector('.lesson-modal') && calls.length === 0, 'Cancel closes without saving');
  open(); click(document.querySelector('.lesson-modal-backdrop')); check(!document.querySelector('.lesson-modal'), 'Backdrop cancellation preserved');
  open(); check(document.activeElement.id === 'lesson-class-input', 'Modal focuses class field');
  button('Save').focus();
  flushSync(() => button('Save').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
  check(document.activeElement.classList.contains('lesson-modal-close'), 'Tab stays inside modal');
  flushSync(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  check(!document.querySelector('.lesson-modal') && document.activeElement.classList.contains('lesson-card-action'), 'Escape cancels and restores lesson focus');
  parent.document.body.dataset.testResult = 'passed';
} catch (error) { parent.document.body.dataset.testResult = 'failed'; results.push(error.stack); }
const report = parent.document.createElement('pre'); report.textContent = JSON.stringify({ viewport: [innerWidth, innerHeight], results }, null, 2); parent.document.body.append(report);
