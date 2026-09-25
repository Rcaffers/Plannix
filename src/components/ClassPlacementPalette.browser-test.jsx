import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import PlacedLessonCard from './PlacedLessonCard.jsx';
import './ProjectCard.css';
import ClassPlacementPalette from './ClassPlacementPalette.jsx';
import { classPlacementUnavailableReason } from '../utils/timetableClassPlacement.js';
import { assertUniqueSessionSlots } from '../utils/timetableSessionState.js';
import { useClassPlacement } from '../hooks/useClassPlacement.js';

const results = [];
function check(condition, message) {
  if (!condition) throw new Error(message);
  results.push(message);
}
const host = document.createElement('div');
document.body.append(host);
const root = createRoot(host);
let selected = null;
let dragged = null;
let transfer = null;
const entries = [{ id: 'class-7a', name: '7A', max: 1, used: 0, remaining: 1 },
  { id: 'full', name: 'Full', max: 1, used: 1, remaining: 0 }];
function Harness({ blocked = false }) {
  const reason = classPlacementUnavailableReason({ target: { weekId: 'A' },
    sessionState: { scope: {}, revision: 0, isSaving: blocked }, layoutDirty: true,
    slots: [{ weekId: 'A', day: 0, periodId: 'p1' }] });
  blocked = Boolean(reason);
  const placement = useClassPlacement({ enabled: true, safe: !blocked, weekId: 'A',
    sessions: [], frequencySessions: [], plannedClasses: entries, slots: [], save: () => true });
  return <ClassPlacementPalette entries={entries} selectedId={placement.selectedId} disabled={blocked}
    onSelect={(id) => { selected = id; placement.select(id); }}
    onDragStart={(event, id) => { dragged = id; placement.dragClass(event, id); }}
    onDragEnd={placement.endDrag} onCancel={placement.cancel} />;
}
const initialLesson = { id: 'lesson-7a', day: 0, periodId: 'p1', classId: 'class-7a', title: 'Fractions', notes: 'Rulers' };
let saves = [];
function ReturnHarness({ weekId = 'A', rejectSave = false, safe = true, modalOpen = false }) {
  const [sessions, setSessions] = useState([initialLesson]);
  const slots = [{ weekId, day: 0, periodId: 'p1', label: 'Monday at 09:00' }];
  const p = useClassPlacement({ enabled: true, safe: safe && !modalOpen, removalSafe: safe, weekId, sessions,
    frequencySessions: sessions, plannedClasses: entries, slots,
    save: (next) => { saves.push({ weekId, sessions: next }); if (rejectSave) return false; setSessions(next); return true; } });
  return <>
    <ClassPlacementPalette entries={p.entries} selectedId={p.selectedId} disabled={!safe}
      onSelect={p.select} onDragStart={p.dragClass} onDragEnd={p.endDrag} onCancel={p.cancel} dropProps={p.paletteDropProps} />
    <button id="placed" draggable onDragStart={(e) => p.dragSession(e, slots[0])} onDragEnd={p.endDrag}>Lesson</button>
    <button id="remove" onClick={() => p.removeSession(slots[0])}>Remove from timetable</button>
    <span role="status">{p.status}</span><span id="count">{sessions.length}</span>
  </>;
}
const fireDrag = (el, name) => flushSync(() => el.dispatchEvent(new DragEvent(name, { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() })));
let returnKey = 0;
function mountReturn(props = {}) { saves = []; returnKey += 1; flushSync(() => root.render(<ReturnHarness key={returnKey} {...props} />)); }
function startReturn() { fireDrag(host.querySelector('#placed'), 'dragstart'); }
function returnTarget(index = 0) { return host.querySelectorAll('.class-placement-return')[index]; }
const otherLesson = { id: 'lesson-other', day: 1, periodId: 'p2', classId: 'full', title: 'Algebra', notes: 'Page 7' };
let editCalls = [];
let modalOpens = 0;
const moveSlots = [{ weekId: 'A', day: 0, periodId: 'p1' }, { weekId: 'A', day: 0, periodId: 'p2' }, { weekId: 'A', day: 1, periodId: 'p2' }];
function MoveHarness() {
  const [sessions, setSessions] = useState([initialLesson, otherLesson]);
  const sessionState = { edit(target, next) { assertUniqueSessionSlots(next); editCalls.push({ target, sessions: structuredClone(next) }); setSessions(next); return true; } };
  const p = useClassPlacement({ enabled: true, safe: true, weekId: 'A', sessions,
    frequencySessions: sessions, plannedClasses: entries, slots: moveSlots,
    save: next => sessionState.edit({ type: 'recurring', weekId: 'A' }, next) });
  return <>
    <ClassPlacementPalette entries={p.entries} selectedId={p.selectedId} onSelect={p.select}
      onDragStart={p.dragClass} onDragEnd={p.endDrag} onCancel={p.cancel} dropProps={p.paletteDropProps} />
    {moveSlots.map((slot, i) => {
      const session = sessions.find(s => s.day === slot.day && s.periodId === slot.periodId);
      return <div key={i} id={`slot-${i}`} {...p.slotProps(slot)}>
        {session ? <PlacedLessonCard draggable dragging={p.isDragging(slot)} label="Edit lesson"
          onDragStart={e => p.dragSession(e, slot)} onDragEnd={p.endDrag} onOpen={() => { modalOpens += 1; }}>
          <span>{session.title}</span>
        </PlacedLessonCard> : <button className="empty-destination" onClick={() => p.place(slot)}>Empty</button>}
      </div>;
    })}
    <button id="move-fallback" onClick={() => p.beginMove(moveSlots[0])}>Move lesson</button>
    <button id="cancel-move" onClick={p.cancel}>Cancel move</button>
    <span role="status">{p.status}</span>
  </>;
}
function mountMove() { editCalls = []; modalOpens = 0; flushSync(() => root.render(<MoveHarness key={Math.random()} />)); }
function dragMove(from, to) {
  const source = host.querySelector(`#slot-${from} .lesson-card--placed`);
  const transfer = new DataTransfer();
  flushSync(() => source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer })));
  const payload = JSON.parse(transfer.getData('application/x-plannix-placement'));
  check(payload.type === 'session' && payload.sessionId === initialLesson.id && payload.classId === initialLesson.classId
    && payload.weekId === 'A' && payload.source.day === initialLesson.day && payload.source.periodId === initialLesson.periodId,
    'Existing lesson drag metadata has session type, IDs and canonical source');
  const destination = host.querySelector(`#slot-${to}`);
  const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer });
  flushSync(() => destination.dispatchEvent(over));
  check(over.defaultPrevented && destination.className.includes('placement-valid'), 'Valid lesson destination allows drop and highlights');
  flushSync(() => destination.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer })));
  flushSync(() => source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer })));
}
try {
  flushSync(() => root.render(<Harness />));
  let [card, full] = host.querySelectorAll('.class-placement-chip');
  check(!card.disabled && !card.hasAttribute('disabled'), 'One remaining and null selection: no disabled attribute');
  check(card.getAttribute('aria-disabled') === null, 'No aria-disabled');
  check(getComputedStyle(card).pointerEvents !== 'none', 'Pointer events enabled');
  const rect = card.getBoundingClientRect();
  check(card.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)), 'No overlay above card');
  check(card.type === 'button' && card.draggable, 'Native button is draggable');
  card.focus();
  check(document.activeElement === card, 'Card receives keyboard focus');
  flushSync(() => card.click());
  check(selected === 'class-7a' && card.getAttribute('aria-pressed') === 'true', 'Click selects the authoritative class ID');
  transfer = new DataTransfer();
  flushSync(() => card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer })));
  check(dragged === 'class-7a', 'Drag starts with authoritative class ID');
  check(JSON.parse(transfer.getData('text/plain')).classId === 'class-7a', 'Hook initializes native drag payload');
  check(full.disabled && !full.draggable, 'Zero remaining is disabled and cannot drag');
  full.focus();
  check(document.activeElement !== full, 'Exhausted card cannot receive focus');
  selected = null;
  full.click();
  check(selected === null, 'Exhausted card cannot select');
  flushSync(() => root.render(<Harness blocked />));
  card = host.querySelector('.class-placement-chip');
  check(card.disabled && !card.draggable, 'Blocking save/loading disables card');
  flushSync(() => root.render(<Harness />));
  check(!host.querySelector('.class-placement-chip').disabled, 'Card re-enables when ready');
  mountReturn();
  check(returnTarget().querySelector('button').disabled, 'Exhausted return card cannot create a new placement');
  startReturn();
  check(returnTarget().textContent.includes('Drop here to remove'), 'Matching exhausted card exposes return hint');
  check(getComputedStyle(returnTarget().querySelector('button')).pointerEvents === 'none', 'Disabled inner button cannot intercept return events');
  fireDrag(returnTarget(1), 'dragover'); fireDrag(returnTarget(1), 'drop');
  check(saves.length === 0 && host.querySelector('#count').textContent === '1', 'Wrong-class drop does not save or remove');
  startReturn(); fireDrag(returnTarget(), 'dragover'); fireDrag(returnTarget(), 'drop');
  check(saves.length === 1 && saves[0].weekId === 'A' && saves[0].sessions.length === 0, 'Return saves empty collection to active week');
  check(returnTarget().textContent.includes('1 remaining') && !returnTarget().querySelector('button').disabled, 'Return immediately restores remaining count and selection');
  check(host.querySelector('[role="status"]').textContent.includes('7A removed from Monday at 09:00'), 'Removal announces class and source slot');
  check(!host.querySelector('.class-placement-return--valid'), 'Successful return clears drag state');
  mountReturn(); startReturn(); fireDrag(host.querySelector('#placed'), 'dragend');
  check(saves.length === 0 && !host.querySelector('.class-placement-return--valid'), 'Outside drop/drag end preserves session and clears highlight');
  startReturn(); flushSync(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  check(!host.querySelector('.class-placement-return--valid') && saves.length === 0, 'Escape cancels return without saving');
  startReturn(); flushSync(() => root.render(<ReturnHarness key={returnKey} weekId="B" />));
  check(!host.querySelector('.class-placement-return--valid'), 'Week change clears drag state');
  mountReturn(); fireDrag(returnTarget(1).querySelector('button'), 'dragstart'); fireDrag(returnTarget(), 'drop');
  check(saves.length === 0, 'Palette-origin drag cannot remove a lesson');
  mountReturn({ rejectSave: true }); startReturn(); fireDrag(returnTarget(), 'drop');
  check(host.querySelector('#count').textContent === '1', 'Rejected persistence leaves lesson present');
  check(!host.querySelector('.class-placement-return--valid'), 'Rejected save clears drag state');
  mountReturn({ modalOpen: true }); flushSync(() => host.querySelector('#remove').click());
  check(saves.length === 1 && saves[0].sessions.length === 0, 'Accessible removal uses same persistence callback');
  mountMove(); dragMove(0, 1);
  check(editCalls.length === 1 && editCalls[0].target.weekId === 'A', 'Move calls sessionState.edit exactly once on active collection');
  check(JSON.stringify(editCalls[0].sessions) === JSON.stringify([{ ...initialLesson, periodId: 'p2' }, otherLesson]), 'Move final payload preserves all identities and details, vacates source');
  check(!host.querySelector('.placement-valid'), 'Dragend clears move state after processing drop');
  mountMove(); dragMove(0, 2);
  check(editCalls.length === 1, 'Swap calls sessionState.edit exactly once, not return/remove logic');
  const swap = editCalls[0].sessions;
  assertUniqueSessionSlots(swap);
  check(JSON.stringify(swap) === JSON.stringify([{ ...initialLesson, day: 1, periodId: 'p2' }, { ...otherLesson, day: 0, periodId: 'p1' }]), 'Swap payload exchanges coordinates only and preserves both complete lessons');
  mountMove(); fireDrag(host.querySelector('#slot-0 .lesson-card--placed'), 'dragstart');
  flushSync(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  fireDrag(host.querySelector('#slot-1'), 'drop');
  check(editCalls.length === 0, 'Escape clears drag; later drop cannot persist stale payload');
  mountMove(); fireDrag(host.querySelector('#slot-0 .lesson-card--placed'), 'dragstart');
  fireDrag(returnTarget(1), 'drop');
  check(editCalls.length === 0, 'Wrong palette target never becomes a slot move');
  mountMove();
  const nativeSource = host.querySelector('#slot-0 .lesson-card--placed');
  check(nativeSource.tagName === 'DIV' && nativeSource.draggable && !nativeSource.hasAttribute('disabled'), 'Native lesson source is a non-disabled draggable wrapper');
  check(nativeSource.querySelector('.lesson-drag-handle') && nativeSource.querySelector('button').type === 'button', 'Visible handle and accessible modal button remain separate');
  flushSync(() => nativeSource.querySelector('button').click());
  check(modalOpens === 1 && editCalls.length === 0, 'Ordinary modal-button click opens details without saving');
  flushSync(() => host.querySelector('#move-fallback').click());
  flushSync(() => host.querySelector('#slot-1 button').click());
  check(editCalls.length === 1 && editCalls[0].sessions[0].periodId === 'p2', 'Move lesson fallback uses one atomic edit to empty slot');
  mountMove(); flushSync(() => host.querySelector('#move-fallback').click());
  flushSync(() => host.querySelector('#cancel-move').click());
  check(editCalls.length === 0, 'Cancel move makes no persistence call');
  window.__nativeLessonTest = {
    mount() { mountMove(); host.style.cssText = 'width:700px;margin:30px';
      for (const el of host.querySelectorAll('[id^="slot-"]')) el.style.cssText = 'display:inline-block;vertical-align:top;width:180px;height:100px;margin:12px'; },
    snapshot() { return { edits: editCalls, modalOpens, dragging: Boolean(host.querySelector('.lesson-card--dragging')) }; },
  };
  document.body.dataset.testResult = 'passed';
} catch (error) {
  document.body.dataset.testResult = 'failed';
  results.push(error.stack);
}
const report = document.createElement('pre');
report.textContent = JSON.stringify(results, null, 2);
document.body.append(report);
