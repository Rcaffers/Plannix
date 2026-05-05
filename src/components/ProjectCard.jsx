import { useEffect, useMemo, useState } from 'react';
import { useTimetableLayout } from '../context/TimetableLayoutContext';
import { lessonAriaLabel } from '../utils/lessonModal';
import { loadClassesPlanFromStorage } from '../utils/classesPlanner';
import { findSessionAt } from '../utils/timetable';
import {
  buildDefaultSessions,
  getDayCount,
  loadSessionsForLayoutKey,
  makeLayoutKey,
  pruneSessionsToGrid,
  saveSessionsForLayoutKey,
} from '../utils/timetableLayout';
import { loadTimetableEditModeFromStorage, saveTimetableEditModeToStorage } from '../utils/timetableEditModeStorage';
import {
  computeAvailableClassOptions,
  getPlannedClassEntries,
  mapsFromPlannedClasses,
  resolveSessionClassDisplay,
} from '../utils/timetablePlannedClasses';
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
  const [classDraft, setClassDraft] = useState('');
  const [titleDraft, setTitleDraft] = useState('');
  const [availableClasses, setAvailableClasses] = useState([]);
  const [isEditingClasses, setIsEditingClasses] = useState(() => loadTimetableEditModeFromStorage());

  const modalSession =
    modalSlot == null ? null : findSessionAt(sessions, modalSlot.day, modalSlot.time) ?? null;
  const modalRowSegment = modalSlot == null ? null : rowSegments[modalSlot.time] ?? null;
  const modalDayLabel = modalSlot == null ? '' : dayLabels[modalSlot.day] ?? '';
  const classesPlan = useMemo(() => loadClassesPlanFromStorage(), [modalSlot, sessions]);
  const plannedClasses = useMemo(() => getPlannedClassEntries(classesPlan), [classesPlan]);
  const { byId: plannedClassById, byName: plannedClassByName } = useMemo(
    () => mapsFromPlannedClasses(plannedClasses),
    [plannedClasses],
  );

  useEffect(() => {
    saveTimetableEditModeToStorage(isEditingClasses);
  }, [isEditingClasses]);

  function toggleEditMode() {
    setIsEditingClasses((current) => !current);
  }

  function resolveSessionClass(session) {
    return resolveSessionClassDisplay(session, plannedClassById, plannedClassByName);
  }

  function loadClassOptions(dayIndex, rowIndex) {
    setAvailableClasses(
      computeAvailableClassOptions({
        plannedClasses,
        sessions,
        dayIndex,
        rowIndex,
        plannedClassById,
        plannedClassByName,
      }),
    );
  }

  function openLessonModal(dayIndex, rowIndex) {
    const seg = rowSegments[rowIndex];
    if (!seg || seg.kind !== 'lesson') return;
    const session = findSessionAt(sessions, dayIndex, rowIndex);
    if (!isEditingClasses && !session) {
      return;
    }
    loadClassOptions(dayIndex, rowIndex);
    setModalSlot({ day: dayIndex, time: rowIndex });
    setClassDraft(
      (session?.classId && plannedClassById.get(session.classId)?.id) ||
        plannedClassByName.get(String(session?.class || '').trim())?.id ||
        '',
    );
    setTitleDraft(session?.title ?? '');
  }

  function closeLessonModal() {
    setModalSlot(null);
    setClassDraft('');
    setTitleDraft('');
    setAvailableClasses([]);
  }

  function saveLessonDetails(event) {
    event.preventDefault();
    if (modalSlot == null) return;
    const selectedClass = classDraft.trim();
    const selectedTitle = titleDraft.trim();

    setSessions((prev) => {
      const existing = findSessionAt(prev, modalSlot.day, modalSlot.time);
      const base = prev.filter((s) => !(s.day === modalSlot.day && s.time === modalSlot.time));

      if (!selectedClass) {
        saveSessionsForLayoutKey(layoutKey, base);
        return base;
      }

      const selectedClassEntry = plannedClassById.get(selectedClass);
      const nextSession = {
        day: modalSlot.day,
        time: modalSlot.time,
        classId: selectedClass,
        class: selectedClassEntry?.name ?? selectedClass,
        teacher: existing?.teacher ?? '',
        title: selectedTitle,
        meta: modalRowSegment?.rangeLabel ?? '',
      };

      const next = [...base, nextSession];
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
    <article className={`project-card${isEditingClasses ? ' project-card--editing' : ''}`}>
      <div className="schedule-card">
        <div className="schedule-titlebar">
          <div className="schedule-titlebar-main">
            <strong>{project.title}</strong>
            <span>{project.subtitle}</span>
          </div>
          <button
            type="button"
            className="schedule-edit-toggle"
            onClick={toggleEditMode}
          >
            {isEditingClasses ? 'Save class positions' : 'Edit classes'}
          </button>
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
                      const sessionClassName = resolveSessionClass(session);
                      const trimmedTitle = session ? session.title.trim() : '';
                      const teacher = session ? session.teacher?.trim() : '';
                      const ariaLabel =
                        lessonAriaLabel(session ? { ...session, class: sessionClassName } : session) ??
                        `Assign class for ${day} at ${seg.rangeLabel}`;

                      return (
                        <div key={seg.rowIndex} className="slot">
                          {session || isEditingClasses ? (
                            <button
                              type="button"
                              className={`lesson-card${session ? '' : ' lesson-card--empty'}`}
                              onClick={() => openLessonModal(dayIndex, seg.rowIndex)}
                              aria-label={ariaLabel}
                            >
                              {session ? (
                                <>
                                  <span className="session-class">{sessionClassName}</span>
                                  <span>{session.meta}</span>
                                  {teacher ? <span>{teacher}</span> : null}
                                  {trimmedTitle ? (
                                    <span className="session-lesson-title">{trimmedTitle}</span>
                                  ) : null}
                                </>
                              ) : (
                                <span className="session-empty-label">+ Add class</span>
                              )}
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

      {modalSlot ? (
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
            <h2 id="lesson-modal-title">Assign class</h2>
            <p className="lesson-modal-context">
              <span className="lesson-modal-class">{modalDayLabel}</span>
              <span className="lesson-modal-meta">{modalRowSegment?.rangeLabel ?? ''}</span>
              {modalSession ? (
                <span className="lesson-modal-teacher">{resolveSessionClass(modalSession)}</span>
              ) : null}
            </p>
            <form className="lesson-modal-form" onSubmit={saveLessonDetails}>
              {isEditingClasses ? (
                <>
                  <label htmlFor="lesson-class-input">Class</label>
                  <select
                    id="lesson-class-input"
                    value={classDraft}
                    onChange={(event) => setClassDraft(event.target.value)}
                  >
                    <option value="">No class selected</option>
                    {availableClasses.map((classOption) => (
                      <option key={classOption.id} value={classOption.id}>
                        {classOption.label} ({classOption.used}/{classOption.max})
                      </option>
                    ))}
                  </select>
                  {availableClasses.length === 0 ? (
                    <p className="lesson-modal-note">
                      No classes found yet. Add classes in <a href="/classes">Classes</a> first.
                    </p>
                  ) : null}
                </>
              ) : (
                <>
                  <label htmlFor="lesson-title-input">Title</label>
                  <input
                    id="lesson-title-input"
                    type="text"
                    value={titleDraft}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    placeholder="e.g. Introduction to fractions"
                    autoComplete="off"
                  />
                </>
              )}
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
