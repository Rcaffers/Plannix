import { useEffect, useMemo, useState } from 'react';
import { useTimetableLayout } from '../context/TimetableLayoutContext';
import { lessonAriaLabel } from '../utils/lessonModal';
import { findSessionAt } from '../utils/timetable';
import {
  buildDefaultSessions,
  getDayCount,
  loadSessionsForLayoutKey,
  makeLayoutKey,
  pruneSessionsToGrid,
  saveSessionsForLayoutKey,
} from '../utils/timetableLayout';
import './ProjectCard.css';

export default function ProjectCard({ project }) {
  const { layout, dayLabels, rowSegments } = useTimetableLayout();
  const dayCount = getDayCount(layout);
  const layoutKey = useMemo(() => makeLayoutKey(layout), [layout]);

  const [sessions, setSessions] = useState(() => {
    const saved = loadSessionsForLayoutKey(layoutKey);
    if (saved && saved.length) {
      return pruneSessionsToGrid(saved, layout);
    }
    return buildDefaultSessions(layout);
  });

  useEffect(() => {
    const saved = loadSessionsForLayoutKey(layoutKey);
    if (saved && saved.length) {
      setSessions(pruneSessionsToGrid(saved, layout));
      return;
    }
    const defaults = buildDefaultSessions(layout);
    setSessions(defaults);
    saveSessionsForLayoutKey(layoutKey, defaults);
  }, [layoutKey, layout]);

  const [modalSlot, setModalSlot] = useState(null);
  const [titleDraft, setTitleDraft] = useState('');

  const modalSession =
    modalSlot == null ? null : findSessionAt(sessions, modalSlot.day, modalSlot.time) ?? null;

  function openLessonModal(dayIndex, rowIndex) {
    const session = findSessionAt(sessions, dayIndex, rowIndex);
    if (!session) return;
    setModalSlot({ day: dayIndex, time: rowIndex });
    setTitleDraft(session.title);
  }

  function closeLessonModal() {
    setModalSlot(null);
    setTitleDraft('');
  }

  function saveLessonTitle(event) {
    event.preventDefault();
    if (modalSlot == null) return;
    setSessions((prev) => {
      const next = prev.map((s) =>
        s.day === modalSlot.day && s.time === modalSlot.time ? { ...s, title: titleDraft.trim() } : s,
      );
      saveSessionsForLayoutKey(layoutKey, next);
      return next;
    });
    closeLessonModal();
  }

  const stopLessonModalCloseFromInnerClick = (event) => {
    event.stopPropagation();
  };

  const scheduleVars = {
    '--timetable-days': dayCount,
    '--timetable-periods': rowSegments.length,
  };

  return (
    <article className="project-card">
      <div className="schedule-card">
        <div className="schedule-titlebar">
          <strong>{project.title}</strong>
          <span>{project.subtitle}</span>
        </div>
        <div className="schedule-dynamic" style={scheduleVars}>
          <div className="schedule-scroll">
            <div className={`schedule-head${dayLabels.length > 5 ? ' schedule-head--compact' : ''}`}>
              <span className="time-head">Time</span>
              {dayLabels.map((day) => (
                <span key={day} className="day-head">
                  {day}
                </span>
              ))}
            </div>

            <div className="schedule-grid">
              <div className="time-col">
                {rowSegments.map((seg) => (
                  <span key={seg.rowIndex} className="time-label">
                    <span className="time-label-start">{seg.timeLabel}</span>
                    {seg.kind !== 'lesson' ? (
                      <span className="time-label-kind">
                        {seg.kind === 'lunch'
                          ? 'Lunch'
                          : seg.kind === 'registration'
                            ? 'Reg'
                            : 'Break'}
                      </span>
                    ) : null}
                  </span>
                ))}
              </div>

              {dayLabels.map((day, dayIndex) => (
                <div key={day} className="day-col">
                  {rowSegments.map((seg) => {
                    if (seg.kind === 'lesson') {
                      const session = findSessionAt(sessions, dayIndex, seg.rowIndex);
                      const trimmedTitle = session ? session.title.trim() : '';
                      const ariaLabel = lessonAriaLabel(session);

                      return (
                        <div key={seg.rowIndex} className="slot">
                          {session ? (
                            <button
                              type="button"
                              className="lesson-card"
                              onClick={() => openLessonModal(dayIndex, seg.rowIndex)}
                              aria-label={ariaLabel}
                            >
                              <span className="session-class">{session.class}</span>
                              <span>{session.meta}</span>
                              <span>{session.teacher}</span>
                              {trimmedTitle ? (
                                <span className="session-lesson-title">{trimmedTitle}</span>
                              ) : null}
                            </button>
                          ) : null}
                        </div>
                      );
                    }

                    return (
                      <div key={seg.rowIndex} className="slot slot--nonlesson">
                        <div className={`schedule-block-muted schedule-block-muted--${seg.kind}`}>
                          <span className="schedule-block-muted-title">
                            {seg.kind === 'lunch'
                              ? 'Lunch'
                              : seg.kind === 'registration'
                                ? 'Registration'
                                : 'Break'}
                          </span>
                          <span className="schedule-block-muted-range">{seg.rangeLabel}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {modalSession && modalSlot ? (
        <div className="lesson-modal-backdrop" onClick={closeLessonModal}>
          <div
            className="lesson-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lesson-modal-title"
            onClick={stopLessonModalCloseFromInnerClick}
          >
            <button type="button" className="lesson-modal-close" aria-label="Close" onClick={closeLessonModal}>
              ×
            </button>
            <p className="lesson-modal-kicker">Lesson details</p>
            <h2 id="lesson-modal-title">Lesson title</h2>
            <p className="lesson-modal-context">
              <span className="lesson-modal-class">{modalSession.class}</span>
              <span className="lesson-modal-meta">{modalSession.meta}</span>
              <span className="lesson-modal-teacher">{modalSession.teacher}</span>
            </p>
            <form className="lesson-modal-form" onSubmit={saveLessonTitle}>
              <label htmlFor="lesson-title-input">Title</label>
              <input
                id="lesson-title-input"
                type="text"
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                placeholder="e.g. Introduction to fractions"
                autoComplete="off"
              />
              <div className="lesson-modal-actions">
                <button type="button" className="lesson-modal-cancel" onClick={closeLessonModal}>
                  Cancel
                </button>
                <button type="submit" className="lesson-modal-save">
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </article>
  );
}
