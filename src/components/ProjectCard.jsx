import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAcademicYear } from '../context/AcademicYearContext';
import { useTimetableLayout } from '../context/TimetableLayoutContext';
import { lessonAriaLabel } from '../utils/lessonModal';
import { normalizeClassesPlan } from '../utils/classesPlanner';
import { findSessionAt } from '../utils/timetable';
import { pushLessonDetailsForwardAlongSameClassAhead } from '../utils/timetablePushClassForward';
import { countFullHolidayWeeksBeforeMonday, holidayLabelForLocalDate } from '../utils/academicYear';
import {
  buildDefaultSessions,
  makeLayoutKey,
  pruneSessionsToGrid,
  TIMETABLE_CYCLE,
} from '../utils/timetableLayout';
import { loadTimetableEditModeFromStorage, saveTimetableEditModeToStorage } from '../utils/timetableEditModeStorage';
import { fetchClassesPlan, fetchTimetableSessions, saveTimetableSessions } from '../utils/api';
import {
  computeAvailableClassOptions,
  getPlannedClassEntries,
  mapsFromPlannedClasses,
  resolveSessionClassDisplay,
} from '../utils/timetablePlannedClasses';
import './ProjectCard.css';

function startOfWeek(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  const day = result.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  result.setDate(result.getDate() + diff);
  return result;
}

function formatWeekCommencing(date) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function getIsoWeekNumber(date) {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return Math.ceil(((utc - yearStart) / 86400000 + 1) / 7);
}

export default function ProjectCard({
  project,
  enableEditing = true,
  weekMode = 'date',
  fixedWeekKey = 'cycle-1',
  fixedWeekLabel = '',
}) {
  const { layout, dayLabels, rowSegments } = useTimetableLayout();
  const { academicYear } = useAcademicYear();
  const isTwoWeekCycle = layout.cycle === TIMETABLE_CYCLE.TWO_WEEK;
  const displayDayLabels = useMemo(() => {
    if (!isTwoWeekCycle) return dayLabels;
    return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  }, [dayLabels, isTwoWeekCycle]);
  const dayCount = displayDayLabels.length;
  const layoutKey = useMemo(() => makeLayoutKey(layout), [layout]);
  const [weekStartDate, setWeekStartDate] = useState(() => startOfWeek(new Date()));
  const isoWeekNumber = useMemo(() => getIsoWeekNumber(weekStartDate), [weekStartDate]);
  const repeatingWeekKey = useMemo(() => {
    if (layout.cycle !== TIMETABLE_CYCLE.TWO_WEEK) return 'cycle-1';
    const fullHolidayWeeksBefore =
      weekMode === 'date' ? countFullHolidayWeeksBeforeMonday(academicYear, weekStartDate) : 0;
    const adjustedIso = isoWeekNumber + fullHolidayWeeksBefore;
    return adjustedIso % 2 === 0 ? 'cycle-2' : 'cycle-1';
  }, [layout.cycle, isoWeekNumber, weekMode, academicYear, weekStartDate]);
  const activeWeekKey = weekMode === 'date' ? repeatingWeekKey : fixedWeekKey;
  const weekCommencingLabel = useMemo(() => {
    if (weekMode !== 'date') return fixedWeekLabel;
    if (layout.cycle === TIMETABLE_CYCLE.TWO_WEEK) {
      const weekName = repeatingWeekKey === 'cycle-2' ? 'Week B' : 'Week A';
      return `${formatWeekCommencing(weekStartDate)} (${weekName})`;
    }
    return formatWeekCommencing(weekStartDate);
  }, [fixedWeekLabel, layout.cycle, repeatingWeekKey, weekMode, weekStartDate]);

  const todayColumnIndex = useMemo(() => {
    if (weekMode !== 'date') {
      return -1;
    }
    const now = new Date();
    now.setHours(12, 0, 0, 0);
    const monday = new Date(weekStartDate);
    monday.setHours(12, 0, 0, 0);
    const diffDays = Math.floor((now.getTime() - monday.getTime()) / 86400000);
    if (diffDays < 0 || diffDays >= dayCount) {
      return -1;
    }
    return diffDays;
  }, [weekMode, weekStartDate, dayCount]);

  const columnHolidayLabels = useMemo(() => {
    if (weekMode !== 'date') {
      return Array.from({ length: dayCount }, () => null);
    }
    return Array.from({ length: dayCount }, (_, dayIndex) => {
      const d = new Date(weekStartDate);
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() + dayIndex);
      return holidayLabelForLocalDate(academicYear, d);
    });
  }, [weekMode, weekStartDate, academicYear, dayCount]);

  const [sessions, setSessions] = useState(() => {
    return buildDefaultSessions(layout);
  });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const loaded = await fetchTimetableSessions({ layoutKey, weekKey: activeWeekKey });
        if (cancelled) return;
        if (loaded && loaded.length) {
          setSessions(pruneSessionsToGrid(loaded, layout));
          return;
        }
        setSessions(buildDefaultSessions(layout));
      } catch {
        if (!cancelled) {
          setSessions(buildDefaultSessions(layout));
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [layoutKey, layout, activeWeekKey]);

  const [modalSlot, setModalSlot] = useState(null);
  const [classDraft, setClassDraft] = useState('');
  const [titleDraft, setTitleDraft] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const [availableClasses, setAvailableClasses] = useState([]);
  const [classLimitError, setClassLimitError] = useState('');
  const [isEditingClasses, setIsEditingClasses] = useState(() =>
    enableEditing ? loadTimetableEditModeFromStorage() : false,
  );

  const modalSession =
    modalSlot == null ? null : findSessionAt(sessions, modalSlot.day, modalSlot.time) ?? null;
  const modalRowSegment = modalSlot == null ? null : rowSegments[modalSlot.time] ?? null;
  const modalDayLabel = modalSlot == null ? '' : dayLabels[modalSlot.day] ?? '';

  const [lessonPushForwardError, setLessonPushForwardError] = useState('');

  useEffect(() => {
    if (!modalSlot) {
      return undefined;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [modalSlot]);

  useEffect(() => {
    setLessonPushForwardError('');
  }, [modalSlot]);

  const [classesPlan, setClassesPlan] = useState(() => normalizeClassesPlan({ cadence: 'week', entries: [] }));
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const data = await fetchClassesPlan();
        if (!cancelled) {
          setClassesPlan(
            normalizeClassesPlan({
              cadence: layout.cycle === TIMETABLE_CYCLE.TWO_WEEK ? 'two-weeks' : 'week',
              entries: Array.isArray(data?.entries) ? data.entries : [],
            }),
          );
        }
      } catch {
        if (!cancelled) {
          setClassesPlan(normalizeClassesPlan({ cadence: 'week', entries: [] }));
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [layout.cycle]);
  const plannedClasses = useMemo(() => getPlannedClassEntries(classesPlan), [classesPlan]);
  const { byId: plannedClassById, byName: plannedClassByName } = useMemo(
    () => mapsFromPlannedClasses(plannedClasses),
    [plannedClasses],
  );

  useEffect(() => {
    if (!enableEditing) return;
    saveTimetableEditModeToStorage(isEditingClasses);
  }, [isEditingClasses, enableEditing]);

  function toggleEditMode() {
    if (!enableEditing) return;
    setIsEditingClasses((current) => !current);
  }

  function handleClearTimetable() {
    if (!enableEditing || sessions.length === 0) {
      return;
    }
    const clearsBothWeeks = layout.cycle === TIMETABLE_CYCLE.TWO_WEEK && weekMode === 'fixed';
    const confirmMessage = clearsBothWeeks
      ? 'Clear all classes from both Week A and Week B timetables?'
      : 'Clear all classes from this timetable?';
    if (!window.confirm(confirmMessage)) {
      return;
    }
    const emptySessions = [];
    setSessions(emptySessions);
    saveTimetableSessions({ layoutKey, weekKey: activeWeekKey, sessions: emptySessions }).catch(() => {});
    if (clearsBothWeeks) {
      const otherWeekKey = activeWeekKey === 'cycle-1' ? 'cycle-2' : 'cycle-1';
      saveTimetableSessions({ layoutKey, weekKey: otherWeekKey, sessions: emptySessions }).catch(() => {});
    }
    closeLessonModal();
  }

  function moveWeek(offset) {
    setWeekStartDate((current) => {
      const next = new Date(current);
      next.setDate(next.getDate() + offset * 7);
      return next;
    });
  }

  function jumpToCurrentWeek() {
    setWeekStartDate(startOfWeek(new Date()));
  }

  function resolveSessionClass(session) {
    return resolveSessionClassDisplay(session, plannedClassById, plannedClassByName);
  }

  function sessionsForCadenceLimit() {
    return sessions;
  }

  function buildClassOptions(dayIndex, rowIndex, currentSession = null) {
    return computeAvailableClassOptions({
      plannedClasses,
      sessions: sessionsForCadenceLimit(),
      dayIndex,
      rowIndex,
      plannedClassById,
      plannedClassByName,
      currentSession,
    });
  }

  function loadClassOptions(dayIndex, rowIndex) {
    const currentSession = findSessionAt(sessions, dayIndex, rowIndex) ?? null;
    setAvailableClasses(buildClassOptions(dayIndex, rowIndex, currentSession));
  }

  function openLessonModal(dayIndex, rowIndex) {
    if (weekMode === 'date' && columnHolidayLabels[dayIndex]) return;
    const seg = rowSegments[rowIndex];
    if (!seg || seg.kind !== 'lesson') return;
    const session = findSessionAt(sessions, dayIndex, rowIndex);
    if (!enableEditing && !session) {
      return;
    }
    if (!isEditingClasses && !session) {
      return;
    }
    if (isEditingClasses) {
      loadClassOptions(dayIndex, rowIndex);
    } else {
      setAvailableClasses([]);
    }
    setClassLimitError('');
    setModalSlot({ day: dayIndex, time: rowIndex });
    setClassDraft(
      (session?.classId && plannedClassById.get(session.classId)?.id) ||
        plannedClassByName.get(String(session?.class || '').trim())?.id ||
        '',
    );
    setTitleDraft(session?.title ?? '');
    setNotesDraft(session?.notes ?? '');
  }

  function closeLessonModal() {
    setModalSlot(null);
    setClassDraft('');
    setTitleDraft('');
    setNotesDraft('');
    setAvailableClasses([]);
    setClassLimitError('');
  }

  function saveLessonDetails(event) {
    event.preventDefault();
    if (modalSlot == null) return;
    const currentSession = findSessionAt(sessions, modalSlot.day, modalSlot.time) ?? null;
    const selectedTitle = titleDraft.trim();
    const selectedNotes = notesDraft.trim().slice(0, 4000);

    if (!isEditingClasses) {
      if (!currentSession) {
        closeLessonModal();
        return;
      }
      setSessions((prev) => {
        const next = prev.map((session) =>
          session.day === modalSlot.day && session.time === modalSlot.time
            ? { ...session, title: selectedTitle, notes: selectedNotes }
            : session,
        );
        saveTimetableSessions({ layoutKey, weekKey: activeWeekKey, sessions: next }).catch(() => {});
        return next;
      });
      closeLessonModal();
      return;
    }

    const selectedClass = classDraft.trim();

    if (selectedClass) {
      const allowedOptions = buildClassOptions(modalSlot.day, modalSlot.time, currentSession);
      const isAllowed = allowedOptions.some((option) => option.id === selectedClass);
      if (!isAllowed) {
        setClassLimitError('This class has reached its allowed frequency for the selected period.');
        setAvailableClasses(allowedOptions);
        return;
      }
    }

    setSessions((prev) => {
      const existing = findSessionAt(prev, modalSlot.day, modalSlot.time);
      const base = prev.filter((s) => !(s.day === modalSlot.day && s.time === modalSlot.time));

      if (!selectedClass) {
        saveTimetableSessions({ layoutKey, weekKey: activeWeekKey, sessions: base }).catch(() => {});
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
        notes: selectedNotes,
        meta: modalRowSegment?.rangeLabel ?? '',
      };

      const next = [...base, nextSession];
      saveTimetableSessions({ layoutKey, weekKey: activeWeekKey, sessions: next }).catch(() => {});
      return next;
    });
    closeLessonModal();
  }

  const stopLessonModalCloseFromInnerClick = (event) => {
    event.stopPropagation();
  };

  function handlePushLessonsForwardForClass() {
    if (modalSlot == null || !modalSession) {
      setLessonPushForwardError('Assign a class on this slot first.');
      return;
    }
    setLessonPushForwardError('');
    const result = pushLessonDetailsForwardAlongSameClassAhead({
      sessions,
      pivotDayIndex: modalSlot.day,
      pivotTime: modalSlot.time,
      pivotSessionRef: modalSession,
      rowSegments,
      dayCount,
    });
    if (!result.ok) {
      const copy =
        result.reason === 'PIVOT_NOTHING_TO_SHIFT'
          ? 'There’s nothing on this card to move (add a title, notes, or teacher first).'
          : result.reason === 'LAST_DETAIL_WOULD_DROP'
          ? 'The last matching slot already has title, notes, or teacher — clear those first or extend the chain (add another lesson for this class) so nothing need be dropped.'
          : result.reason === 'NO_FURTHER_SAME_CLASS_SLOT'
          ? 'There isn’t a later slot in this timetable where this class is already assigned (next days first, then later periods on the same day).'
          : result.reason === 'NOT_LESSON_ROW'
              ? 'This row is not a teaching period.'
              : result.reason === 'NO_CLASS'
                ? 'This slot has no class to match against.'
              : 'Could not shift lesson details forward.';
      setLessonPushForwardError(copy);
      return;
    }
    setSessions(result.sessions);
    saveTimetableSessions({ layoutKey, weekKey: activeWeekKey, sessions: result.sessions }).catch(() => {});
    closeLessonModal();
  }

  const scheduleVars = {
    '--timetable-days': dayCount,
    '--timetable-periods': rowSegments.length,
  };

  return (
    <article
      className={`project-card${enableEditing && isEditingClasses ? ' project-card--editing' : ''}`}
    >
      <div className="schedule-card">
        <div className="schedule-titlebar">
          <div className="schedule-titlebar-main">
            <strong>{project.title}</strong>
            <span>{project.subtitle}</span>
          </div>
          {weekMode === 'date' ? (
            <div className="schedule-week-nav" aria-label="Week navigation">
              <button
                type="button"
                className="schedule-week-arrow"
                onClick={() => moveWeek(-1)}
                aria-label="Go to previous week"
              >
                ←
              </button>
              <span className="schedule-week-label">Week commencing {weekCommencingLabel}</span>
              <button
                type="button"
                className="schedule-week-today"
                onClick={jumpToCurrentWeek}
                aria-label="Jump to current week"
              >
                This week
              </button>
              <button
                type="button"
                className="schedule-week-arrow"
                onClick={() => moveWeek(1)}
                aria-label="Go to next week"
              >
                →
              </button>
            </div>
          ) : (
            <div className="schedule-week-nav">
              <span className="schedule-week-label">{weekCommencingLabel}</span>
            </div>
          )}
          {enableEditing ? (
            <div className="schedule-titlebar-actions">
              <button type="button" className="schedule-edit-toggle" onClick={toggleEditMode}>
                {isEditingClasses ? 'Save class positions' : 'Edit classes'}
              </button>
              <button
                type="button"
                className="schedule-edit-toggle schedule-edit-toggle--danger"
                onClick={handleClearTimetable}
                disabled={sessions.length === 0}
              >
                Clear timetable
              </button>
            </div>
          ) : null}
        </div>
        <div className="schedule-dynamic" style={scheduleVars}>
          <div className="schedule-scroll">
            <div className={`schedule-head${dayLabels.length > 5 ? ' schedule-head--compact' : ''}`}>
              <span className="time-head">Time</span>
              {displayDayLabels.map((day, dayIndex) => (
                <span
                  key={day}
                  className={`day-head${columnHolidayLabels[dayIndex] ? ' day-head--holiday' : ''}${todayColumnIndex === dayIndex ? ' day-head--today' : ''}`}
                  title={
                    columnHolidayLabels[dayIndex]
                      ? `Holiday: ${columnHolidayLabels[dayIndex]}`
                      : undefined
                  }
                >
                  <span className="day-head-label">{day}</span>
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

              {displayDayLabels.map((day, dayIndex) => {
                const holidayLabel = columnHolidayLabels[dayIndex];
                return (
                <div
                  key={day}
                  className={`day-col${holidayLabel ? ' day-col--holiday' : ''}${todayColumnIndex === dayIndex ? ' day-col--today' : ''}`}
                >
                  {rowSegments.map((seg) => {
                    if (holidayLabel) {
                      return (
                        <div key={seg.rowIndex} className="slot slot--holiday">
                          <div
                            className="schedule-block-holiday"
                            aria-label={`School closed, ${holidayLabel}`}
                          >
                            <span className="schedule-block-holiday-title">Holiday</span>
                            <span className="schedule-block-holiday-name">{holidayLabel}</span>
                          </div>
                        </div>
                      );
                    }
                    if (seg.kind === 'lesson') {
                      const session = findSessionAt(sessions, dayIndex, seg.rowIndex);
                      const sessionClassName = resolveSessionClass(session);
                      const trimmedTitle = session ? String(session.title ?? '').trim() : '';
                      const trimmedNotes = session ? String(session.notes ?? '').trim() : '';
                      const teacher = session ? session.teacher?.trim() : '';
                      const ariaLabel =
                        lessonAriaLabel(session ? { ...session, class: sessionClassName } : session) ??
                        `Assign class for ${day} at ${seg.rangeLabel}`;

                      return (
                        <div key={seg.rowIndex} className="slot">
                          {session || (enableEditing && isEditingClasses) ? (
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
                                  {trimmedNotes ? (
                                    <span className="session-lesson-notes">{trimmedNotes}</span>
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
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {modalSlot && typeof document !== 'undefined'
        ? createPortal(
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
                            {classOption.label}{' '}
                            ({classOption.used}/{classOption.max}
                            {layout.cycle === TIMETABLE_CYCLE.TWO_WEEK ? ' over 2 weeks' : ' this week'})
                          </option>
                        ))}
                      </select>
                      {availableClasses.length === 0 ? (
                        <p className="lesson-modal-note">
                          No classes found yet. Add classes in <a href="/classes">Classes</a> first.
                        </p>
                      ) : null}
                      {classLimitError ? <p className="lesson-modal-note">{classLimitError}</p> : null}
                    </>
                  ) : null}

                  <label htmlFor="lesson-title-input">Title</label>
                  <input
                    id="lesson-title-input"
                    type="text"
                    value={titleDraft}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    placeholder="e.g. Introduction to fractions"
                    autoComplete="off"
                  />

                  <label htmlFor="lesson-notes-input">Notes</label>
                  <textarea
                    id="lesson-notes-input"
                    className="lesson-modal-notes"
                    rows={4}
                    value={notesDraft}
                    onChange={(event) => setNotesDraft(event.target.value)}
                    placeholder="Room, equipment, reminders for this slot…"
                    maxLength={4000}
                  />

                  <div className="lesson-modal-bump-row">
                    <button
                      type="button"
                      className="lesson-modal-bump"
                      onClick={() => handlePushLessonsForwardForClass()}
                      disabled={!modalSession}
                    >
                      Push lesson details down one step
                    </button>
                    <p className="lesson-modal-bump-help">
                      Title, notes, and teacher move to the next slot that already has this class, scanning forward across
                      the timetable (later days first, then later periods on the same day). This slot clears. The final
                      matching slot must be empty so nothing is overwritten without warning.
                    </p>
                    {lessonPushForwardError ? (
                      <p className="lesson-modal-note lesson-modal-note--warn" role="alert">
                        {lessonPushForwardError}
                      </p>
                    ) : null}
                  </div>

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
            </div>,
            document.body,
          )
        : null}
    </article>
  );
}
