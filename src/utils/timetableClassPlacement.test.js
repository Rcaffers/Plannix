import { createSerializedSaveQueue } from './timetableSessionState.js';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { useClassPlacement } from '../hooks/useClassPlacement.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyClassPlacement, removeClassPlacement, classPlacementUsage, classPlacementUnavailableReason } from './timetableClassPlacement.js';

const plannedClasses = [{ id: 'maths-id', name: 'Maths', max: 2 }, { id: 'other-id', name: 'Maths', max: 3 }];
const slots = [0, 1].flatMap((day) => ['p1', 'p2'].map((periodId) => ({ weekId: 'A', day, periodId })));
const source = { id: 'session-1', classId: 'maths-id', day: 0, periodId: 'p1', title: 'Fractions', notes: 'Bring rulers' };
const other = { id: 'session-2', classId: 'other-id', day: 1, periodId: 'p2', title: 'Algebra', notes: 'Page 6' };
function run(overrides = {}) {
  return applyClassPlacement({ safe: true, weekId: 'A', slots, plannedClasses, sessions: [], frequencySessions: [],
    destination: slots[0], action: { type: 'class', classId: 'maths-id', weekId: 'A' }, ...overrides });
}
function move(sessions, destination) {
  return run({ sessions, frequencySessions: [source, source], destination,
    action: { type: 'session', weekId: 'A', source: slots[0], session: source } });
}
test('places authoritative class ID with blank details', () => {
  assert.deepEqual(run(), { ok: true, sessions: [{ day: 0, periodId: 'p1', classId: 'maths-id', title: '', notes: '' }] });
});
test('occupied slots cannot be overwritten by palette', () => assert.equal(run({ sessions: [source] }).reason, 'OCCUPIED'));
test('enforces per-week frequency limit', () => assert.equal(run({ frequencySessions: [source, source] }).reason, 'LIMIT'));
test('combined Week A and B usage enforces limit even at identical coordinates', () => {
  const weeks = [{ sessions: [source] }, { sessions: [{ ...source, id: 'week-b-session' }] }];
  assert.equal(run({ frequencySessions: weeks.flatMap((week) => week.sessions) }).reason, 'LIMIT');
  assert.equal(classPlacementUsage(plannedClasses, weeks.flatMap((week) => week.sessions))[0].used, 2);
});
test('moves complete lesson at its frequency limit, retaining identity and details', () => {
  assert.deepEqual(move([source], slots[3]).sessions, [{ ...source, day: 1, periodId: 'p2' }]);
});
test('swaps complete lessons without losing IDs, title or notes', () => {
  assert.deepEqual(move([source, other], slots[3]).sessions,
    [{ ...source, day: 1, periodId: 'p2' }, { ...other, day: 0, periodId: 'p1' }]);
});
test('same-slot move is a no-op', () => {
  const sessions = [source]; const result = move(sessions, slots[0]);
  assert.equal(result.unchanged, true); assert.equal(result.sessions, sessions);
});
for (const [name, destination] of Object.entries({ break: { ...slots[0], periodId: 'break' },
  lunch: { ...slots[0], periodId: 'lunch' }, registration: { ...slots[0], periodId: 'registration' },
  missing: { ...slots[0], periodId: undefined }, holiday: { ...slots[0], day: 4 },
  outside: { ...slots[0], weekId: 'B' }, negative: { ...slots[0], day: -1 } })) {
  test(`rejects ${name} destination absent from active teaching slots`, () => assert.equal(run({ destination }).reason, 'UNAVAILABLE'));
}
test('rejects unsafe state, absent target, wrong-week action and stale source', () => {
  assert.equal(run({ safe: false }).reason, 'UNSAFE');
  assert.equal(run({ weekId: null }).reason, 'UNSAFE');
  assert.equal(run({ action: { type: 'class', classId: 'maths-id', weekId: 'B' } }).reason, 'WRONG_WEEK');
  assert.equal(move([{ ...source }], slots[3]).reason, 'STALE');
});
test('never mutates original arrays or objects', () => {
  Object.freeze(source); Object.freeze(other);
  const sessions = Object.freeze([source, other]);
  const before = JSON.stringify(sessions); move(sessions, slots[3]);
  run({ sessions, destination: slots[1] }); assert.equal(JSON.stringify(sessions), before);
});
test('names are never used as authoritative IDs or merged for frequency', () => {
  assert.equal(run({ action: { type: 'class', classId: 'Maths', weekId: 'A' } }).reason, 'UNKNOWN_CLASS');
  assert.equal(run({ frequencySessions: [other, other, other] }).ok, true);
});

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const card = read('../components/ProjectCard.jsx');
const hook = read('../hooks/useClassPlacement.js');
const palette = read('../components/ClassPlacementPalette.jsx');
test('only Input Classes opts into placement, fixed edit mode required', () => {
  const classes = read('../pages/Classes.jsx');
  assert.match(classes, /location.pathname === '\/classes\/input'/);
  assert.match(classes, /isInputPage \? \([\s\S]*enableClassPlacement/);
  assert.match(card, /enableClassPlacement = false/);
  assert.match(card, /enableClassPlacement && enableEditing && isEditingClasses && weekMode === 'fixed'/);
  for (const file of fs.readdirSync(new URL('../pages/', import.meta.url))) {
    if (file.endsWith('.jsx') && file !== 'Classes.jsx') assert.doesNotMatch(read(`../pages/${file}`), /enableClassPlacement/);
  }
});
test('modal fallback, keyboard buttons, Escape, cancel and live announcements remain', () => {
  assert.match(card, /else openLessonModal\(dayIndex, seg.rowIndex\)/);
  assert.match(card, /onSubmit={saveLessonDetails}/);
  assert.match(card, /aria-live="polite"/);
  assert.match(card, /<button[\s\S]*placement.place\(placementSlot\)/);
  assert.match(palette, /<button[\s\S]*aria-pressed/);
  assert.match(palette, /Cancel placement/);
  assert.match(hook, /event.key === 'Escape'/);
});
test('week changes clear selection and dragging; only existing edit persistence is used', () => {
  assert.match(hook, /setMoving\(null\); setSelected\(null\); endDrag\(\); setStatus\(''\); }, \[weekId, enabled\]/);
  assert.match(hook, /selected\?\.weekId === weekId/);
  assert.match(card, /save: \(next\) => target && sessionState.edit\(target, next\)/);
  assert.doesNotMatch(hook + palette + read('./timetableClassPlacement.js'), /fetch\(|supabase|localStorage|saveRecurringTimetableSessions/);
  assert.match(card, /classPlacementUnavailableReason/);
});

for (const weekId of [undefined, null, 'A', 'B']) {
  test(`placement renders before a class is selected (week: ${weekId})`, () => {
    function PlacementProbe() {
      const placement = useClassPlacement({ enabled: true, safe: false, weekId,
        sessions: [], frequencySessions: [], plannedClasses: [], slots: [], save: () => false });
      assert.equal(placement.selectedId, null);
      assert.equal(placement.slotProps({ weekId, day: 0, periodId: 'p1' }).className, '');
      return React.createElement('span', null, 'Input classes');
    }
    assert.equal(renderToString(React.createElement(PlacementProbe)), '<span>Input classes</span>');
  });
}

test('readiness uses saved layout and permits null selection with revision zero', () => {
  assert.equal(classPlacementUnavailableReason({ target: { weekId: 'A' },
    sessionState: { scope: {}, revision: 0 }, slots, layoutDirty: true, selected: null }), '');
});
test('genuine loading, saving, errors, unsaved changes and missing targets block placement', () => {
  const ready = { target: { weekId: 'A' }, sessionState: { scope: {}, revision: 0 }, slots };
  for (const key of ['isLoading', 'isSaving', 'unsaved', 'conflict', 'error']) {
    assert.ok(classPlacementUnavailableReason({ ...ready, sessionState: { ...ready.sessionState, [key]: true } }), key);
  }
  for (const key of ['classesLoading', 'classesError', 'layoutLoading', 'layoutSaving', 'layoutError', 'modalSlot']) {
    assert.ok(classPlacementUnavailableReason({ ...ready, [key]: true }), key);
  }
  for (const patch of [{ target: null }, { slots: [] }, { sessionState: { scope: {}, revision: null } },
    { sessionState: { scope: null, revision: 0 } }]) assert.ok(classPlacementUnavailableReason({ ...ready, ...patch }));
});

function removal(overrides = {}) {
  return removeClassPlacement({ sessions: [source, other], weekId: 'A', slots, safe: true,
    classId: source.classId, action: { type: 'session', weekId: 'A', source: slots[0], session: source }, ...overrides });
}
test('return removes only matching session and its details, increasing remaining usage', () => {
  const result = removal();
  assert.equal(result.ok, true);
  assert.deepEqual(result.sessions, [other]);
  assert.equal(classPlacementUsage(plannedClasses, result.sessions)[0].remaining, 2);
  assert.equal(result.sessions.some(s => s.title === source.title || s.notes === source.notes), false);
  assert.equal(source.title, 'Fractions');
});
test('return rejects wrong class, palette origin, missing source, wrong week and unsafe state', () => {
  assert.equal(removal({ classId: other.classId }).reason, 'WRONG_CLASS');
  assert.equal(removal({ action: { type: 'class', classId: source.classId, weekId: 'A' } }).reason, 'NOT_SESSION');
  assert.equal(removal({ sessions: [] }).reason, 'STALE');
  assert.equal(removal({ weekId: 'B' }).reason, 'WRONG_WEEK');
  assert.equal(removal({ safe: false }).reason, 'UNSAFE');
});
test('modal and palette return share validated removal and the existing save callback', () => {
  assert.match(hook, /removeClassPlacement\(/);
  assert.match(hook, /if \(!save\(next.sessions\)\)/);
  assert.match(card, /onClick={removeModalPlacement}>Remove from timetable/);
  assert.match(card, /placement.removeSession\(/);
  assert.match(card, /save: \(next\) => target && sessionState.edit\(target, next\)/);
});

test('optimistic removal retains failed payload for existing conflict and retry queue', async () => {
  const next = removal().sessions;
  const calls = []; let optimistic; let failure; let failedPayload; let confirmed;
  const queue = createSerializedSaveQueue({
    save: async (sessions) => { calls.push(sessions); if (calls.length === 1) throw Object.assign(new Error('Conflict'), { status: 409 }); return sessions; },
    onOptimistic: value => { optimistic = value; }, onAuthoritative: value => { confirmed = value; },
    onError: (error, value) => { failure = error; failedPayload = value; },
  });
  queue.enqueue(next);
  assert.equal(optimistic, next);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(failure.status, 409);
  assert.equal(queue.conflicted, true);
  assert.equal(queue.enqueue([source]), false);
  queue.retry(failedPayload);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(confirmed, next);
  assert.equal(confirmed.includes(source), false);
});
