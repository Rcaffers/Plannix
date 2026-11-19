import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { pickerAddDays, pickerClamp, pickerDate, pickerDays, pickerMonday, pickerShiftMonth } from '../utils/timetableWeekPicker.js';

export default function TimetableWeekPicker({ displayedWeek, min, max, onChoose, onClose }) {
  const dialog = useRef(null);
  const id = useId();
  const [focusedDay, setFocusedDay] = useState(() => pickerClamp(displayedWeek, min, max));
  const days = pickerDays(focusedDay);
  const week = pickerMonday(displayedWeek);
  const monthLabel = new Intl.DateTimeFormat('en-GB', { month:'long', year:'numeric' }).format(pickerDate(focusedDay));
  useEffect(() => {
    const previousFocus = document.activeElement;
    const node = dialog.current;
    node.showModal();
    return () => {
      node.close();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll:true });
    };
  }, []);
  useEffect(() => {
    dialog.current?.querySelector(`[data-date="${focusedDay}"]`)?.focus();
  }, [focusedDay]);
  const focus = value => setFocusedDay(pickerClamp(value, min, max));
  function onDayKey(event) {
    const offsets = { ArrowLeft:-1, ArrowRight:1, ArrowUp:-7, ArrowDown:7 };
    let next;
    if (event.key in offsets) next = pickerAddDays(focusedDay, offsets[event.key]);
    else if (event.key === 'Home') next = pickerMonday(focusedDay);
    else if (event.key === 'End') next = pickerAddDays(pickerMonday(focusedDay), 6);
    else if (event.key === 'PageUp' || event.key === 'PageDown') next = pickerShiftMonth(focusedDay, event.key === 'PageUp' ? -1 : 1);
    if (next) { event.preventDefault(); focus(next); }
  }
  function trapFocus(event) {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...dialog.current.querySelectorAll('button:not(:disabled)')]
      .filter(button => button.tabIndex >= 0);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  return createPortal(<dialog ref={dialog} className="lesson-modal timetable-week-picker" aria-labelledby={`${id}-title`}
    aria-describedby={`${id}-help`} onKeyDown={trapFocus} onCancel={event => { event.preventDefault(); onClose(); }}>
    <h2 id={`${id}-title`}>Choose week</h2>
    <p id={`${id}-help`}>Choose a date to open its week. The displayed week is highlighted. Use arrow keys to move between dates.</p>
    <div className="timetable-calendar-month">
      <button type="button" className="settings-reset" aria-label="Previous month"
        disabled={focusedDay.slice(0, 7) <= min.slice(0, 7)} onClick={() => focus(pickerShiftMonth(focusedDay, -1))}>←</button>
      <strong aria-live="polite">{monthLabel}</strong>
      <button type="button" className="settings-reset" aria-label="Next month"
        disabled={focusedDay.slice(0, 7) >= max.slice(0, 7)} onClick={() => focus(pickerShiftMonth(focusedDay, 1))}>→</button>
    </div>
    <div role="grid" aria-label={monthLabel} className="timetable-calendar-grid">
      <div role="row">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day => <span role="columnheader" key={day}>{day}</span>)}</div>
      {Array.from({ length:6 }, (_, row) => <div role="row" key={row}>
        {days.slice(row * 7, row * 7 + 7).map(day => {
          const selected = pickerMonday(day) === week;
          return <div role="gridcell" aria-selected={selected} key={day} className={selected ? 'is-displayed-week' : ''}>
            <button type="button" data-date={day} tabIndex={day === focusedDay ? 0 : -1}
              disabled={day < min || day > max} onKeyDown={onDayKey}
              aria-label={new Intl.DateTimeFormat('en-GB', {weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(pickerDate(day))}
              onClick={() => onChoose(day)}>{Number(day.slice(-2))}</button>
          </div>;
        })}
      </div>)}
    </div>
    <button type="button" className="settings-reset" onClick={onClose}>Close</button>
  </dialog>, document.body);
}
