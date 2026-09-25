import { useEffect, useRef, useState } from 'react';
import { applyClassPlacement, classPlacementUsage, removeClassPlacement } from '../utils/timetableClassPlacement.js';

const messages = {
  OCCUPIED: 'This slot already has a lesson. Open the lesson to change its class.',
  LIMIT: 'This class has reached its frequency limit.',
  UNSAFE: 'Placement is unavailable until the timetable is ready. Resolve any save error first.',
};

export function useClassPlacement({ enabled, safe, removalSafe = safe, weekId, sessions, frequencySessions, plannedClasses, slots, save }) {
  const [selected, setSelected] = useState(null);
  const [moving, setMoving] = useState(null);
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const [status, setStatusText] = useState('');
  const [statusIsError, setStatusIsError] = useState(false);
  function setStatus(message, isError = false) { setStatusText(message); setStatusIsError(isError); }
  const dragRef = useRef(null);
  const entries = classPlacementUsage(plannedClasses, frequencySessions);
  const selectedId = enabled && selected && weekId && selected?.weekId === weekId ? selected.classId : null;
  const activeDrag = enabled && drag && weekId && drag.weekId === weekId ? drag : null;
  const activeMove = enabled && moving?.weekId === weekId ? moving : null;
  const action = activeDrag || activeMove || (selectedId ? selected : null);
  function endDrag() {
    if (dragRef.current) { setSelected(null); setMoving(null); }
    dragRef.current = null; setDrag(null); setOver(null);
  }
  function cancel() { setMoving(null); setSelected(null); endDrag(); setStatus('Placement cancelled.'); }
  useEffect(() => { setMoving(null); setSelected(null); endDrag(); setStatus(''); }, [weekId, enabled]);
  useEffect(() => {
    if (!safe) endDrag();
    if (selectedId && !entries.some((entry) => entry.id === selectedId && entry.remaining)) setSelected(null);
  }, [safe, selectedId, frequencySessions, plannedClasses]);
  useEffect(() => {
    if (!enabled) return undefined;
    const escape = (event) => { if (event.key === 'Escape') cancel(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [enabled]);
  function result(destination, candidate = action) {
    return applyClassPlacement({ sessions, frequencySessions, plannedClasses, weekId, slots,
      safe: enabled && safe, destination, action: candidate });
  }
  function place(destination, candidate = action) {
    if (activeMove && candidate === activeMove && sessions.some((entry) => entry.day === destination.day && entry.periodId === destination.periodId)) {
      setStatus('Choose an empty lesson slot to move this lesson.', true); return;
    }
    const next = result(destination, candidate);
    if (!next.ok) { setStatus(messages[next.reason] || 'This is not an available lesson destination.', true); return; }
    if (next.unchanged) return;
    if (!save(next.sessions)) { setStatus(messages.UNSAFE, true); return; }
    setMoving(null);
    setStatus(candidate.type === 'class' ? 'Class placed. Saving changes.' : 'Lesson moved or swapped. Saving changes.');
    if (candidate.type === 'class' && entries.find((entry) => entry.id === candidate.classId)?.remaining <= 1) setSelected(null);
  }
  function startDrag(event, candidate) {
    if (!enabled || !safe) { event.preventDefault(); return; }
    // Keep existing instruction rows in place until dragend/drop: changing their
    // height during native dragstart can move the source out from under the mouse.
    dragRef.current = candidate; setDrag(candidate);
    event.dataTransfer.effectAllowed = candidate.type === 'class' ? 'copy' : 'move';
    // Native metadata contains identity only; validation uses our in-memory drag.
    const metadata = JSON.stringify({
      type: candidate.type, weekId: candidate.weekId, source: candidate.source,
      sessionId: candidate.session?.id, classId: candidate.session?.classId || candidate.classId,
    });
    event.dataTransfer.setData('text/plain', metadata);
    event.dataTransfer.setData('application/x-plannix-placement', metadata);
  }
  function removalResult(classId, candidate, allowed = safe) {
    return removeClassPlacement({ sessions, weekId, slots, safe: enabled && allowed, action: candidate, classId });
  }
  function remove(classId, candidate, allowed = safe) {
    const next = removalResult(classId, candidate, allowed);
    endDrag();
    if (!next.ok) { setStatus(messages[next.reason] || 'Return the lesson to its matching class card.', true); return false; }
    if (!save(next.sessions)) { setStatus(messages.UNSAFE, true); return false; }
    setSelected(null);
    const name = plannedClasses.find((entry) => entry.id === classId)?.name || 'Lesson';
    const slot = slots.find((entry) => entry.day === next.removed.day && entry.periodId === next.removed.periodId);
    setStatus(`${name} removed from ${slot?.label || 'the timetable'}. Saving changes.`);
    return true;
  }
  function paletteDropProps(classId) {
    const valid = activeDrag && removalResult(classId, activeDrag).ok;
    return {
      className: activeDrag ? ` class-placement-return--${valid ? 'valid' : 'invalid'}${over === classId ? ' class-placement-return--over' : ''}` : '',
      hint: valid ? 'Drop here to remove from timetable' : '',
      onDragOver(event) {
        if (!dragRef.current) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = removalResult(classId, dragRef.current).ok ? 'move' : 'none';
        setOver(classId);
      },
      onDragLeave(event) { if (!event.currentTarget.contains(event.relatedTarget)) setOver(null); },
      onDrop(event) {
        if (!dragRef.current) return;
        event.preventDefault();
        remove(classId, dragRef.current);
      },
    };
  }
  function slotProps(slot) {
    if (!enabled) return {};
    const valid = action && result(slot).ok && (!activeMove || !sessions.some((entry) => entry.day === slot.day && entry.periodId === slot.periodId));
    const current = over === `${slot.day}:${slot.periodId}`;
    return {
      className: action ? ` placement-${valid ? 'valid' : 'invalid'}${current ? ' placement-over' : ''}` : '',
      onDragOver(event) {
        if (!dragRef.current) return;
        event.preventDefault();
        const validation = result(slot, dragRef.current);
        if (!validation.ok) setStatus(messages[validation.reason] || 'This is not an available lesson destination.', true);
        event.dataTransfer.dropEffect = validation.ok
          ? dragRef.current.type === 'class' ? 'copy' : 'move' : 'none';
        setOver(`${slot.day}:${slot.periodId}`);
      },
      onDragLeave(event) { if (!event.currentTarget.contains(event.relatedTarget)) setOver(null); },
      onDrop(event) {
        if (!dragRef.current) return;
        event.preventDefault();
        const candidate = dragRef.current;
        try { place(slot, candidate); } finally { endDrag(); }
      },
    };
  }
  return { entries, selectedId, moving: activeMove, status, statusIsError,
    isDragging(slot) { return Boolean(activeDrag?.type === 'session' && activeDrag.source.day === slot.day && activeDrag.source.periodId === slot.periodId); },
    beginMove(source) {
      const session = sessions.find((entry) => entry.day === source.day && entry.periodId === source.periodId);
      const candidate = { type: 'session', weekId, source, session };
      if (!removalResult(session?.classId, candidate, removalSafe).ok) return false;
      endDrag(); setSelected(null); setMoving(candidate);
      setStatus('Choose an empty lesson slot to move this lesson.');
      return true;
    }, cancel, endDrag, slotProps, paletteDropProps, place,
    removeSession(source) {
      const session = sessions.find((entry) => entry.day === source.day && entry.periodId === source.periodId);
      return remove(session?.classId, { type: 'session', weekId, source, session }, removalSafe);
    },
    select(classId) { if (safe) { setMoving(null); endDrag(); setSelected({ type: 'class', classId, weekId }); setStatus('Class selected. Choose an empty lesson slot.'); } },
    dragClass(event, classId) { startDrag(event, { type: 'class', classId, weekId }); },
    dragSession(event, source) { startDrag(event, { type: 'session', weekId, source,
      session: sessions.find((session) => session.day === source.day && session.periodId === source.periodId) }); },
  };
}
