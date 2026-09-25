import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAcademicYear } from '../context/AcademicYearContext';
import { useClasses } from '../context/ClassContext';
import { useTimetableLayout } from '../context/TimetableLayoutContext';
import { useTimetableSessions } from '../context/TimetableSessionContext';
import { lessonAriaLabel } from '../utils/lessonModal';
import { findSessionAt } from '../utils/timetable';
import {
  pullLessonDetailsBackwardAlongSameClassAhead,
  pullLessonDetailsBackwardAcrossWeeks,
  pushLessonDetailsForwardAlongSameClassAhead,
  pushLessonDetailsForwardAcrossWeeks,
} from '../utils/timetablePushClassForward';
import { countFullHolidayWeeksBeforeMonday, getAcademicTimetableMondayBounds, holidayLabelForLocalDate } from '../utils/academicYear';
import { TIMETABLE_CYCLE } from '../utils/timetableLayout';
import { loadTimetableEditModeFromStorage, saveTimetableEditModeToStorage } from '../utils/timetableEditModeStorage';
import { displayToSession, sameSessions, sessionToDisplay } from '../utils/timetableSessionState';
import {
  computeAvailableClassOptions,
  getPlannedClassEntries,
  mapsFromPlannedClasses,
  resolveSessionClassDisplay,
} from '../utils/timetablePlannedClasses';
import ClassPlacementPalette from './ClassPlacementPalette';
import PlacedLessonCard from './PlacedLessonCard';
import { classPlacementUnavailableReason } from '../utils/timetableClassPlacement';
import { useClassPlacement } from '../hooks/useClassPlacement';
import './ProjectCard.css';

/** Single-day navigation is reserved for phone widths, regardless of pointer type. */
const COMPACT_TIMETABLE_QUERY = '(max-width: 767px)';

function startOfWeek(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  const day = result.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  result.setDate(result.getDate() + diff);
  return result;
}

function formatDateKeyPart(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function clampWeekStartForDateMode(weekMonday, bounds) {
  const w = startOfWeek(new Date(weekMonday));
  if (!bounds?.minMonday && !bounds?.maxMonday) {
    return w;
  }
  if (bounds.minMonday) {
    const minT = startOfWeek(new Date(bounds.minMonday)).getTime();
    if (w.getTime() < minT) {
      return new Date(minT);
    }
  }
  if (bounds.maxMonday) {
    const maxT = startOfWeek(new Date(bounds.maxMonday)).getTime();
    if (w.getTime() > maxT) {
      return new Date(maxT);
    }
  }
  return w;
}

function formatWeekCommencing(date) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function formatVisibleCalendarDay(date) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
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

/** Calendar “today” as a column index (0 = Monday of `weekStartDate`) or -1 if today is outside that teaching week. */
function getTodayColumnIndexForWeek({ weekStartDate, dayCount, weekMode }) {
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
}

/**
 * First visible day on phone when “today” does not map to a column (e.g. weekend with Mon–Fri grid).
 * If today is still the same calendar week as `weekStartDate` but after the last teaching day, use that last day (e.g. Friday).
 * Otherwise fall back to Monday (0) for other weeks.
 */
function getCompactBootstrapDayIndex({ weekStartDate, dayCount, weekMode }) {
  const inWeek = getTodayColumnIndexForWeek({ weekStartDate, dayCount, weekMode });
  if (inWeek >= 0) {
    return inWeek;
  }
  if (weekMode !== 'date' || dayCount < 1) {
    return 0;
  }
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  const monday = new Date(weekStartDate);
  monday.setHours(12, 0, 0, 0);
  const diffDays = Math.floor((now.getTime() - monday.getTime()) / 86400000);

  const displayedMonday = startOfWeek(weekStartDate);
  displayedMonday.setHours(12, 0, 0, 0);
  const thisMonday = startOfWeek(now);
  thisMonday.setHours(12, 0, 0, 0);
  const sameCalendarWeek = displayedMonday.getTime() === thisMonday.getTime();

  if (sameCalendarWeek && diffDays >= dayCount) {
    return Math.max(0, dayCount - 1);
  }
  return 0;
}

export default function ProjectCard({
  project,
  enableEditing = true,
  enableClassPlacement = false,
  weekMode = 'date',
  enableFixedPhoneSingleDay = false,
  fixedWeekKey = 'cycle-1',
  fixedWeekLabel = '',
}) {
  const { layout, dayLabels, rowSegments, isLoading: layoutLoading, isSaving: layoutSaving, error: layoutError } = useTimetableLayout();
  const { academicYear } = useAcademicYear();
  const {
    authoritativeEntries: classEntries,
    isLoading: classesLoading,
    error: classesError,
  } = useClasses();
  const sessionState = useTimetableSessions();
  const timetableMondayBounds = useMemo(
    () => getAcademicTimetableMondayBounds(academicYear),
    [academicYear],
  );
  const isTwoWeekCycle = layout.cycle === TIMETABLE_CYCLE.TWO_WEEK;
  const displayDayLabels = useMemo(() => {
    if (!isTwoWeekCycle) return dayLabels;
    return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  }, [dayLabels, isTwoWeekCycle]);
  const dayCount = displayDayLabels.length;
  const [weekStartDate, setWeekStartDate] = useState(() => startOfWeek(new Date()));

  useEffect(() => {
    if (weekMode !== 'date') {
      return;
    }
    setWeekStartDate((cur) => clampWeekStartForDateMode(cur, timetableMondayBounds));
  }, [weekMode, timetableMondayBounds]);
  const isoWeekNumber = useMemo(() => getIsoWeekNumber(weekStartDate), [weekStartDate]);
  const repeatingWeekKey = useMemo(() => {
    if (layout.cycle !== TIMETABLE_CYCLE.TWO_WEEK) return 'cycle-1';
    const fullHolidayWeeksBefore =
      weekMode === 'date' ? countFullHolidayWeeksBeforeMonday(academicYear, weekStartDate) : 0;
    const adjustedIso = isoWeekNumber + fullHolidayWeeksBefore;
    return adjustedIso % 2 === 0 ? 'cycle-2' : 'cycle-1';
  }, [layout.cycle, isoWeekNumber, weekMode, academicYear, weekStartDate]);
  const weekCommencingLabel = useMemo(() => {
    if (weekMode !== 'date') return fixedWeekLabel;
    if (layout.cycle === TIMETABLE_CYCLE.TWO_WEEK) {
      const weekName = repeatingWeekKey === 'cycle-2' ? 'Week B' : 'Week A';
      return `${formatWeekCommencing(weekStartDate)} (${weekName})`;
    }
    return formatWeekCommencing(weekStartDate);
  }, [fixedWeekLabel, layout.cycle, repeatingWeekKey, weekMode, weekStartDate]);

  const todayColumnIndex = useMemo(
    () => getTodayColumnIndexForWeek({ weekStartDate, dayCount, weekMode }),
    [weekMode, weekStartDate, dayCount],
  );

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

  const [isCompactTimetable, setIsCompactTimetable] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(COMPACT_TIMETABLE_QUERY).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(COMPACT_TIMETABLE_QUERY);
    const onChange = () => setIsCompactTimetable(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const isSingleDayTimetable = isCompactTimetable && (weekMode === 'date' || enableFixedPhoneSingleDay);
  const [compactDayIndex, setCompactDayIndex] = useState(0);
  const compactDayBootstrappedRef = useRef(false);
  const weekStartRef = useRef(weekStartDate);
  const dayCountRef = useRef(dayCount);
  weekStartRef.current = weekStartDate;
  dayCountRef.current = dayCount;

  useLayoutEffect(() => {
    if (!isSingleDayTimetable) {
      compactDayBootstrappedRef.current = false;
      return;
    }
    if (compactDayBootstrappedRef.current) {
      return;
    }

    const pickIndex = () =>
      getCompactBootstrapDayIndex({
        weekStartDate: weekStartRef.current,
        dayCount: dayCountRef.current,
        weekMode,
      });

    const finish = (idx) => {
      if (compactDayBootstrappedRef.current) return;
      const maxIdx = Math.max(0, dayCountRef.current - 1);
      setCompactDayIndex(Math.min(maxIdx, Math.max(0, idx)));
      compactDayBootstrappedRef.current = true;
    };

    if (todayColumnIndex >= 0) {
      finish(pickIndex());
      return;
    }

    const rafId = requestAnimationFrame(() => finish(pickIndex()));
    return () => cancelAnimationFrame(rafId);
  }, [isSingleDayTimetable, todayColumnIndex, weekMode]);

  useEffect(() => {
    setCompactDayIndex((i) => (i >= dayCount ? Math.max(0, dayCount - 1) : i));
  }, [dayCount]);

  const visibleCalendarDay = useMemo(() => {
    if (weekMode !== 'date') {
      return null;
    }
    const d = new Date(weekStartDate);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + compactDayIndex);
    return d;
  }, [weekMode, weekStartDate, compactDayIndex]);

  const repeatingDayLabel = displayDayLabels[compactDayIndex] || '';
  const visibleDayTitle = weekMode === 'date'
    ? (visibleCalendarDay && isSingleDayTimetable ? formatVisibleCalendarDay(visibleCalendarDay) : '')
    : ({ Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' }[repeatingDayLabel] || repeatingDayLabel);

  const scheduleDateInputValue = useMemo(() => {
    if (!visibleCalendarDay) return '';
    return formatDateKeyPart(visibleCalendarDay);
  }, [visibleCalendarDay]);

  const dayIndicesToRender = useMemo(() => {
    if (isSingleDayTimetable) {
      return [compactDayIndex];
    }
    return displayDayLabels.map((_, i) => i);
  }, [isSingleDayTimetable, compactDayIndex, displayDayLabels]);

  const gridDayCount = isSingleDayTimetable ? 1 : dayCount;

  // Use a literal repeat count for WebKit and the same sizing for heading/body.
  // The minimum protects narrow containers; fractional tracks fill wider ones.
  const fullWeekGridStyle = useMemo(() => {
    if (isSingleDayTimetable || gridDayCount < 1) return null;
    const dayPx = 118;
    const timePx = 72;
    return {
      gridTemplateColumns: `${timePx}px repeat(${gridDayCount}, minmax(${dayPx}px, 1fr))`,
      width: '100%',
      minWidth: `${timePx + gridDayCount * dayPx}px`,
      boxSizing: 'border-box',
    };
  }, [isSingleDayTimetable, gridDayCount]);

  const teachingPeriods = useMemo(() => sessionState.periods
    .filter((period) => period.type === 'teaching')
    .sort((left, right) => (left.number ?? left.order) - (right.number ?? right.order)), [sessionState.periods]);
  const lessonRows = useMemo(() => rowSegments.filter((row) => row.kind === 'lesson'), [rowSegments]);
  const periodIndexById = useMemo(() => new Map(teachingPeriods.map((period, index) =>
    [period.id, lessonRows[index]?.rowIndex])), [teachingPeriods, lessonRows]);
  const periodIdByIndex = useMemo(() => new Map(teachingPeriods.map((period, index) =>
    [lessonRows[index]?.rowIndex, period.id])), [teachingPeriods, lessonRows]);
  const classNameById = useMemo(() => new Map((classEntries || []).map((entry) => [entry.id, entry.name])), [classEntries]);
  const fixedCode = fixedWeekKey === 'cycle-2' ? 'B' : 'A';
  const activeCollection = weekMode === 'date'
    ? sessionState.dated
    : sessionState.recurring.find((week) => week.code === fixedCode) || null;
  const target = weekMode === 'date'
    ? { type: 'date', weekStartDate: formatDateKeyPart(weekStartDate) }
    : activeCollection ? { type: 'recurring', weekId: activeCollection.weekId } : null;
  const sessions = useMemo(() => (activeCollection?.sessions || []).map((session, index) =>
    sessionToDisplay(session, periodIndexById, classNameById, `temporary-${index}`)).filter(Boolean),
  [activeCollection?.sessions, periodIndexById, classNameById]);

  useEffect(() => {
    if (weekMode === 'date' && sessionState.scope) void sessionState.loadDate(formatDateKeyPart(weekStartDate));
  }, [weekMode, weekStartDate, sessionState.scope]);

  function persistDisplaySessions(next) {
    if (!target) return false;
    try { return sessionState.edit(target, next.map((entry) => displayToSession(entry, periodIdByIndex))); }
    catch { return false; }
  }

  function updateSessions(update) {
    const next = typeof update === 'function' ? update(sessions) : update;
    persistDisplaySessions(next);
    return next;
  }

  const [modalSlot, setModalSlot] = useState(null);
  const lessonModalRef = useRef(null);
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
  const [lessonPushForwardSuccess, setLessonPushForwardSuccess] = useState('');

  useEffect(() => {
    if (!modalSlot) {
      return undefined;
    }
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement;
    const dialog = lessonModalRef.current;
    document.body.style.overflow = 'hidden';
    dialog?.querySelector('select, input')?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); closeLessonModal();
      } else if (event.key === 'Tab') {
        const controls = [...dialog.querySelectorAll('button:not(:disabled), input, select, textarea, a[href]')];
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    dialog?.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      dialog?.removeEventListener('keydown', handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [modalSlot]);

  useEffect(() => {
    setLessonPushForwardError('');
    setLessonPushForwardSuccess('');
  }, [modalSlot]);

  const plannedClasses = useMemo(
    () => getPlannedClassEntries({ entries: classEntries || [] }),
    [classEntries],
  );
  const { byId: plannedClassById } = useMemo(
    () => mapsFromPlannedClasses(plannedClasses),
    [plannedClasses],
  );

  useEffect(() => {
    if (!enableEditing) return;
    saveTimetableEditModeToStorage(isEditingClasses);
  }, [isEditingClasses, enableEditing]);

  const placementEnabled = enableClassPlacement && enableEditing && isEditingClasses && weekMode === 'fixed';
  const placementWeekId = activeCollection?.weekId;
  const placementSlots = useMemo(() => displayDayLabels.flatMap((_, day) =>
    columnHolidayLabels[day] ? [] : lessonRows.flatMap((row) => {
      const periodId = periodIdByIndex.get(row.rowIndex);
      return periodId ? [{ weekId: placementWeekId, day, periodId,
        label: `${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'][day % 5]} at ${row.timeLabel}` }] : [];
    })), [displayDayLabels, columnHolidayLabels, lessonRows, periodIdByIndex, placementWeekId]);
  const placementUnavailableReason = classPlacementUnavailableReason({ target, sessionState,
    classesLoading, classesError, layoutLoading, layoutSaving, layoutError, modalSlot, slots: placementSlots });
  const placementSafe = !placementUnavailableReason;
  const removalSafe = !classPlacementUnavailableReason({ target, sessionState,
    classesLoading, classesError, layoutLoading, layoutSaving, layoutError, slots: placementSlots });
  const placementFrequencySessions = useMemo(() => sessionState.recurring
    .filter((week) => isTwoWeekCycle || week.code === 'A').flatMap((week) => week.sessions),
  [sessionState.recurring, isTwoWeekCycle]);
  const placement = useClassPlacement({ enabled: placementEnabled, safe: placementSafe, removalSafe,
    weekId: placementWeekId, sessions: activeCollection?.sessions || [],
    frequencySessions: placementFrequencySessions, plannedClasses, slots: placementSlots,
    save: (next) => target && sessionState.edit(target, next),
  });

  function moveModalPlacement() {
    if (!modalSlot) return;
    if (placement.beginMove({ weekId: placementWeekId, day: modalSlot.day,
      periodId: periodIdByIndex.get(modalSlot.time) })) closeLessonModal();
  }

  function removeModalPlacement() {
    if (!modalSlot) return;
    if (placement.removeSession({ weekId: placementWeekId, day: modalSlot.day,
      periodId: periodIdByIndex.get(modalSlot.time) })) closeLessonModal();
  }

  function toggleEditMode() {
    if (!enableEditing) return;
    setIsEditingClasses((current) => !current);
  }

  function handleClearTimetable() {
    if (!enableEditing && weekMode !== 'date') {
      return;
    }
    if (sessions.length === 0 && !(weekMode === 'date' && sessionState.dated?.overrideExists)) {
      return;
    }
    if (!window.confirm('Clear all classes from this timetable?')) {
      return;
    }
    updateSessions([]);
    closeLessonModal();
  }

  function moveWeek(offset) {
    if (window.__plannixConfirmSessionDiscard?.() === false) return;
    setWeekStartDate((current) => {
      const next = new Date(current);
      next.setDate(next.getDate() + offset * 7);
      if (weekMode !== 'date') {
        return next;
      }
      return clampWeekStartForDateMode(next, timetableMondayBounds);
    });
  }

  function jumpToCurrentWeek() {
    if (window.__plannixConfirmSessionDiscard?.() === false) return;
    const mon = startOfWeek(new Date());
    setWeekStartDate(weekMode === 'date' ? clampWeekStartForDateMode(mon, timetableMondayBounds) : mon);
  }

  function moveCompactDay(delta) {
    if (!isSingleDayTimetable || delta === 0) return;
    compactDayBootstrappedRef.current = true;
    if (weekMode === 'fixed') {
      setCompactDayIndex((index) => (index + delta + dayCount) % dayCount);
      return;
    }
    const nextIndex = compactDayIndex + delta;
    if (nextIndex < 0) {
      moveWeek(-1);
      setCompactDayIndex(dayCount - 1);
      return;
    }
    if (nextIndex >= dayCount) {
      moveWeek(1);
      setCompactDayIndex(0);
      return;
    }
    setCompactDayIndex(nextIndex);
  }

  function jumpToToday() {
    if (window.__plannixConfirmSessionDiscard?.() === false) return;
    let monday = startOfWeek(new Date());
    if (weekMode === 'date') {
      monday = clampWeekStartForDateMode(monday, timetableMondayBounds);
    }
    setWeekStartDate(monday);
    const idx = getCompactBootstrapDayIndex({ weekStartDate: monday, dayCount, weekMode });
    const maxIdx = Math.max(0, dayCount - 1);
    setCompactDayIndex(Math.min(maxIdx, Math.max(0, idx)));
    if (isSingleDayTimetable) {
      compactDayBootstrappedRef.current = true;
    }
  }

  function handleScheduleDateChange(event) {
    if (window.__plannixConfirmSessionDiscard?.() === false) return;
    const raw = event.target.value;
    if (!raw || !isSingleDayTimetable) return;
    const parts = raw.split('-').map((n) => parseInt(n, 10));
    const [y, mo, d] = parts;
    if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return;
    const pickedNoon = new Date(y, mo - 1, d, 12, 0, 0, 0);
    let monday = startOfWeek(pickedNoon);
    if (weekMode === 'date') {
      monday = clampWeekStartForDateMode(monday, timetableMondayBounds);
    }
    const mondayNoon = new Date(monday);
    mondayNoon.setHours(12, 0, 0, 0);
    const diffDays = Math.floor((pickedNoon.getTime() - mondayNoon.getTime()) / 86400000);
    setWeekStartDate(monday);
    let idx = diffDays;
    if (idx < 0) idx = 0;
    if (idx >= dayCount) idx = dayCount - 1;
    setCompactDayIndex(idx);
    compactDayBootstrappedRef.current = true;
  }

  function resolveSessionClass(session) {
    return resolveSessionClassDisplay(session, plannedClassById);
  }

  function sessionsForCadenceLimit() {
    if (weekMode === 'date') return sessionState.recurring.flatMap((week) => week.sessions)
      .map((entry, index) => sessionToDisplay(entry, periodIndexById, classNameById, `frequency-${index}`))
      .filter(Boolean);
    return sessionState.recurring.flatMap((week) => week.sessions)
      .map((entry, index) => sessionToDisplay(entry, periodIndexById, classNameById, `frequency-${index}`))
      .filter(Boolean);
  }

  function buildClassOptions(dayIndex, rowIndex, currentSession = null) {
    return computeAvailableClassOptions({
      plannedClasses,
      sessions: sessionsForCadenceLimit(),
      dayIndex,
      rowIndex,
      plannedClassById,
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
      (session?.classId && plannedClassById.get(session.classId)?.id) || '',
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
    setLessonPushForwardError('');
    setLessonPushForwardSuccess('');
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
      updateSessions((prev) => {
        const next = prev.map((session) =>
          session.day === modalSlot.day && session.time === modalSlot.time
            ? { ...session, title: selectedTitle, notes: selectedNotes }
            : session,
        );
        return next;
      });
      closeLessonModal();
      return;
    }

    const selectedClass = classDraft.trim();
    if (placementEnabled && currentSession && !selectedClass) {
      removeModalPlacement();
      return;
    }

    if (selectedClass) {
      const allowedOptions = buildClassOptions(modalSlot.day, modalSlot.time, currentSession);
      const isAllowed = allowedOptions.some((option) => option.id === selectedClass);
      if (!isAllowed) {
        setClassLimitError('This class has reached its allowed frequency for the selected period.');
        setAvailableClasses(allowedOptions);
        return;
      }
    }

    updateSessions((prev) => {
      const existing = findSessionAt(prev, modalSlot.day, modalSlot.time);
      const base = prev.filter((s) => !(s.day === modalSlot.day && s.time === modalSlot.time));

      if (!selectedClass) {
        return base;
      }

      const selectedClassEntry = plannedClassById.get(selectedClass);
      const nextSession = {
        day: modalSlot.day,
        time: modalSlot.time,
        classId: selectedClass,
        class: selectedClassEntry?.name ?? '',
        title: selectedTitle,
        notes: selectedNotes,
      };

      const next = [...base, nextSession];
      return next;
    });
    closeLessonModal();
  }

  const stopLessonModalCloseFromInnerClick = (event) => {
    event.stopPropagation();
  };

  async function shiftLessonDetailsAcrossDatedWeeks(direction) {
    const dates = Array.from({ length: 8 }, (_, offset) => {
      const date = new Date(weekStartDate); date.setDate(date.getDate() + offset * 7);
      return formatDateKeyPart(date);
    });
    let snapshots;
    try { snapshots = await sessionState.loadDateSnapshots(dates); }
    catch { setLessonPushForwardError('Could not load the upcoming weeks.'); return null; }
    const byWeekKey = {};
    snapshots.forEach((snapshot, index) => {
      byWeekKey[dates[index]] = snapshot.sessions.map((session, sessionIndex) =>
        sessionToDisplay(session, periodIndexById, classNameById, `batch-${index}-${sessionIndex}`)).filter(Boolean);
    });
    byWeekKey[dates[0]] = sessions;
    const args = { byWeekKey, orderedWeekKeys: dates, pivotWeekKey: dates[0], pivotDayIndex: modalSlot.day,
      pivotTime: modalSlot.time, pivotSessionRef: modalSession, rowSegments, dayCount };
    const result = direction === 'forward'
      ? pushLessonDetailsForwardAcrossWeeks(args)
      : pullLessonDetailsBackwardAcrossWeeks(args);
    if (!result.ok) return result;
    const mutations = Object.entries(result.byWeekKey)
      .filter(([date, items]) => !sameSessions(items, byWeekKey[date]))
      .map(([weekStartDate, items]) => ({ type: 'date_override', weekStartDate,
        sessions: items.map((entry) => displayToSession(entry, periodIdByIndex)) }));
    if (!mutations.length) return result;
    const savedResult = await sessionState.saveBatch(mutations);
    return savedResult ? result : { ok: false, reason: 'SAVE_FAILED' };
  }

  async function handlePushLessonsForwardForClass() {
    if (modalSlot == null || !modalSession) {
      setLessonPushForwardError('Assign a class on this slot first.');
      setLessonPushForwardSuccess('');
      return;
    }
    setLessonPushForwardError('');
    setLessonPushForwardSuccess('');

    if (weekMode !== 'date') {
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
            ? 'There’s nothing on this card to move (add a title or notes first).'
            : result.reason === 'LAST_DETAIL_WOULD_DROP'
              ? 'The last matching slot already has title or notes — clear those first or extend the chain (add another lesson for this class) so nothing need be dropped.'
              : result.reason === 'NO_FURTHER_SAME_CLASS_SLOT'
                ? 'There isn’t a later slot in this timetable where this class is already assigned (next days first, then later periods on the same day).'
                : result.reason === 'NOT_LESSON_ROW'
                    ? 'This row is not a teaching period.'
                    : result.reason === 'NO_CLASS'
                      ? 'This slot has no class to match against.'
                      : 'Could not shift lesson details forward.';
        setLessonPushForwardError(copy);
        setLessonPushForwardSuccess('');
        return;
      }
      updateSessions(result.sessions);
      setTitleDraft('');
      setNotesDraft('');
      setLessonPushForwardSuccess(
        `Lesson details pushed to ${result.movedCount === 1 ? '1 next slot' : `${result.movedCount} next slots`}.`,
      );
      return;
    }

    const result = await shiftLessonDetailsAcrossDatedWeeks('forward');
    if (!result.ok) {
      const copy =
        result.reason === 'PIVOT_NOTHING_TO_SHIFT'
          ? 'There’s nothing on this card to move (add a title or notes first).'
          : result.reason === 'LAST_DETAIL_WOULD_DROP'
            ? 'The last matching slot already has title or notes — clear those first or extend the chain (add another lesson for this class) so nothing need be dropped.'
            : result.reason === 'NO_FURTHER_SAME_CLASS_SLOT'
              ? 'There isn’t a later slot in any of the upcoming weeks where this class is already assigned.'
              : result.reason === 'NOT_LESSON_ROW'
                  ? 'This row is not a teaching period.'
                  : result.reason === 'NO_CLASS'
                    ? 'This slot has no class to match against.'
                    : 'Could not save shifted lesson details.';
      setLessonPushForwardError(copy);
      setLessonPushForwardSuccess('');
      return;
    }

    const currentWeekSessions = result.byWeekKey[formatDateKeyPart(weekStartDate)] || [];
    setTitleDraft('');
    setNotesDraft('');
    setLessonPushForwardSuccess(
      `Lesson details pushed to ${result.movedCount === 1 ? '1 next slot' : `${result.movedCount} next slots`}.`,
    );
  }

  async function handlePullLessonsBackwardForClass() {
    if (modalSlot == null || !modalSession) {
      setLessonPushForwardError('Assign a class on this slot first.');
      setLessonPushForwardSuccess('');
      return;
    }
    setLessonPushForwardError('');
    setLessonPushForwardSuccess('');

    if (weekMode !== 'date') {
      const result = pullLessonDetailsBackwardAlongSameClassAhead({
        sessions,
        pivotDayIndex: modalSlot.day,
        pivotTime: modalSlot.time,
        pivotSessionRef: modalSession,
        rowSegments,
        dayCount,
      });
      if (!result.ok) {
        const copy =
          result.reason === 'NO_LATER_DETAIL_TO_PULL'
            ? 'There are no later title or notes entries to pull back.'
            : result.reason === 'NO_FURTHER_SAME_CLASS_SLOT'
              ? 'There isn’t a later slot in this timetable where this class is already assigned.'
              : result.reason === 'NOT_LESSON_ROW'
                ? 'This row is not a teaching period.'
                : result.reason === 'NO_CLASS'
                  ? 'This slot has no class to match against.'
                  : 'Could not pull lesson details back.';
        setLessonPushForwardError(copy);
        setLessonPushForwardSuccess('');
        return;
      }
      updateSessions(result.sessions);
      const updatedPivot = findSessionAt(result.sessions, modalSlot.day, modalSlot.time);
      setTitleDraft(updatedPivot?.title ?? '');
      setNotesDraft(updatedPivot?.notes ?? '');
      setLessonPushForwardSuccess(
        `Lesson details pulled back from ${result.movedCount === 1 ? '1 later slot' : `${result.movedCount} later slots`}.`,
      );
      return;
    }

    const result = await shiftLessonDetailsAcrossDatedWeeks('backward');
    if (!result.ok) {
      const copy =
        result.reason === 'NO_LATER_DETAIL_TO_PULL'
          ? 'There are no later title or notes entries in upcoming weeks to pull back.'
          : result.reason === 'NO_FURTHER_SAME_CLASS_SLOT'
            ? 'There isn’t a later slot in any upcoming week where this class is already assigned.'
            : result.reason === 'NOT_LESSON_ROW'
              ? 'This row is not a teaching period.'
              : result.reason === 'NO_CLASS'
                ? 'This slot has no class to match against.'
                : 'Could not save pulled lesson details.';
      setLessonPushForwardError(copy);
      setLessonPushForwardSuccess('');
      return;
    }

    const currentWeekSessions = result.byWeekKey[formatDateKeyPart(weekStartDate)] || [];
    const updatedPivot = findSessionAt(currentWeekSessions, modalSlot.day, modalSlot.time);
    setTitleDraft(updatedPivot?.title ?? '');
    setNotesDraft(updatedPivot?.notes ?? '');
    setLessonPushForwardSuccess(
      `Lesson details pulled back from ${result.movedCount === 1 ? '1 later slot' : `${result.movedCount} later slots`}.`,
    );
  }

  const scheduleVars = {
    '--timetable-days': gridDayCount,
    '--timetable-periods': rowSegments.length,
  };

  const scheduleHeadClass = [
    'schedule-head',
    dayLabels.length > 5 && !isSingleDayTimetable ? 'schedule-head--compact' : '',
    isSingleDayTimetable ? 'schedule-head--single-day' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article
      className={`project-card${enableEditing && isEditingClasses ? ' project-card--editing' : ''}${
        isSingleDayTimetable ? ' project-card--compact-day' : ''
      }`}
    >
      <div className="schedule-card">
        {classesLoading ? <p className="classes-hint" role="status">Loading classes…</p> : null}
        {classesError ? <p className="classes-hint classes-hint--error" role="alert">{classesError}</p> : null}
        {sessionState.isLoading ? <p className="classes-hint" role="status">Loading timetable…</p> : null}
        {sessionState.isSaving ? <p className="classes-hint" role="status">Saving…</p> : null}
        {sessionState.saved && !sessionState.isSaving ? <p className="classes-hint" role="status">Saved</p> : null}
        {sessionState.error ? <p className="classes-hint classes-hint--error" role="alert">{sessionState.error}</p> : null}
        {sessionState.conflict ? <p className="classes-hint classes-hint--error">The timetable changed elsewhere. Reload before retrying.</p> : null}
        {sessionState.error && sessionState.requestReference ? <p className="classes-hint">Support reference: {sessionState.requestReference}</p> : null}
        {weekMode === 'date' && sessionState.dated ? (
          <p className="classes-hint">{sessionState.dated.overrideExists
            ? sessionState.dated.sessions.length ? 'Explicit date override' : 'Intentionally empty date override'
            : 'Inherited from the repeating timetable'}</p>
        ) : null}
        <div className={`schedule-titlebar${isSingleDayTimetable ? ' schedule-titlebar--stack' : ''}`}>
          <div className="schedule-titlebar-main">
            <strong>{project.title}</strong>
            <span>{project.subtitle}</span>
          </div>
          {isSingleDayTimetable ? (
              <div className="schedule-compact-nav">
                {weekMode === 'fixed' ? <span className="schedule-week-label">{fixedWeekLabel}</span> : null}
                <div className="schedule-day-nav-row" aria-label="Day navigation">
                  <button
                    type="button"
                    className="schedule-day-arrow"
                    onClick={() => moveCompactDay(-1)}
                    aria-label="Previous day"
                  >
                    ←
                  </button>
                  <p className="schedule-day-label">{visibleDayTitle}</p>
                  <button
                    type="button"
                    className="schedule-day-arrow"
                    onClick={() => moveCompactDay(1)}
                    aria-label="Next day"
                  >
                    →
                  </button>
                </div>
                {weekMode === 'date' ? <div className="schedule-compact-toolbar">
                  <button
                    type="button"
                    className="schedule-day-today"
                    onClick={jumpToToday}
                    aria-label="Jump to today"
                  >
                    Today
                  </button>
                  <label className="schedule-date-picker">
                    <input
                      type="date"
                      className="schedule-date-input"
                      value={scheduleDateInputValue}
                      onChange={handleScheduleDateChange}
                      aria-label="Choose a date on the timetable"
                    />
                  </label>
                </div> : null}
              </div>
            ) : weekMode === 'date' ? (
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
          {target && (enableEditing || sessionState.error || (weekMode === 'date' && sessionState.dated?.overrideExists)) ? (
            <div className="schedule-titlebar-actions">
              {weekMode === 'date' && sessionState.dated?.overrideExists ? (
                <button type="button" className="schedule-edit-toggle" disabled={sessionState.isSaving}
                  onClick={() => sessionState.removeOverride()}>Restore repeating timetable</button>
              ) : null}
              {sessionState.error ? (
                <><button type="button" className="schedule-edit-toggle" onClick={sessionState.retry}>Retry save</button>
                <button type="button" className="schedule-edit-toggle" onClick={sessionState.reload}>Reload</button></>
              ) : null}
              {enableEditing ? <><button type="button" className="schedule-edit-toggle" onClick={toggleEditMode}>
                {isEditingClasses ? 'Finish editing' : 'Edit classes'}
              </button>
              <button
                type="button"
                className="schedule-edit-toggle schedule-edit-toggle--danger"
                onClick={handleClearTimetable}
                disabled={weekMode !== 'fixed' && sessions.length === 0}
              >
                Clear timetable
              </button>
              </> : null}
            </div>
          ) : null}
        </div>
        {placementEnabled ? <>
          <ClassPlacementPalette entries={placement.entries} selectedId={placement.selectedId}
            disabled={!placementSafe} disabledReason={placementUnavailableReason} onSelect={placement.select} onDragStart={placement.dragClass}
            onDragEnd={placement.endDrag} onCancel={placement.cancel} dropProps={placement.paletteDropProps} />
          {placement.moving ? <div className="class-placement-move">
            Choose an empty slot to move the lesson.
            <button type="button" onClick={placement.cancel}>Cancel move</button>
          </div> : null}
          <p className="class-placement-status" role="status" aria-live="polite" aria-atomic="true">{placement.status}</p>
        </> : null}
        <div className="schedule-dynamic" style={scheduleVars}>
          <div className={`schedule-scroll${isSingleDayTimetable ? ' schedule-scroll--single-day' : ''}`}>
            <div
              className={`schedule-scroll-track${isSingleDayTimetable ? ' schedule-scroll-track--single-day' : ''}`}
            >
              <div className={scheduleHeadClass} style={fullWeekGridStyle ?? undefined}>
                <span className="time-head">Time</span>
                {dayIndicesToRender.map((dayIndex) => {
                  const day = displayDayLabels[dayIndex];
                  return (
                  <span
                    key={`${day}-${dayIndex}`}
                    className={`day-head${columnHolidayLabels[dayIndex] ? ' day-head--holiday' : ''}${todayColumnIndex === dayIndex ? ' day-head--today' : ''}`}
                    title={
                      columnHolidayLabels[dayIndex]
                        ? `Holiday: ${columnHolidayLabels[dayIndex]}`
                        : undefined
                    }
                  >
                    <span className="day-head-label">{day}</span>
                  </span>
                  );
                })}
              </div>

              <div
                className={`schedule-grid${isSingleDayTimetable ? ' schedule-grid--single-day' : ''}`}
                style={fullWeekGridStyle ?? undefined}
              >
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

              {dayIndicesToRender.map((dayIndex) => {
                const day = displayDayLabels[dayIndex];
                const holidayLabel = columnHolidayLabels[dayIndex];
                return (
                <div
                  key={`col-${day}-${dayIndex}`}
                  className={`day-col${holidayLabel ? ' day-col--holiday' : ''}${todayColumnIndex === dayIndex ? ' day-col--today' : ''}`}
                >
                  {rowSegments.map((seg) => {
                    const placementSlot = { weekId: placementWeekId, day: dayIndex,
                      periodId: periodIdByIndex.get(seg.rowIndex) };
                    const { className: placementStyle = '', ...placementEvents } = placement.slotProps(placementSlot);
                    if (holidayLabel) {
                      return (
                        <div key={seg.rowIndex} className={`slot slot--holiday${placementStyle}`} {...placementEvents}>
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
                      const ariaLabel =
                        lessonAriaLabel(session ? { ...session, class: sessionClassName } : session) ??
                        `Assign class for ${day} at ${seg.rangeLabel}`;

                      return (
                        <div key={seg.rowIndex} className={`slot${placementStyle}`} {...placementEvents}>
                          {session || (enableEditing && isEditingClasses) ? (
                            session && placementEnabled ? (
                              <PlacedLessonCard draggable={placementSafe && Boolean(placementSlot.periodId)}
                                dragging={placement.isDragging(placementSlot)} label={ariaLabel}
                                onDragStart={(event) => placement.dragSession(event, placementSlot)}
                                onDragEnd={placement.endDrag} onOpen={() => openLessonModal(dayIndex, seg.rowIndex)}>
                                <span className="session-class">{sessionClassName}</span>
                                <span>{seg.rangeLabel}</span>
                                {trimmedTitle ? <span className="session-lesson-title">{trimmedTitle}</span> : null}
                                {trimmedNotes ? <span className="session-lesson-notes">{trimmedNotes}</span> : null}
                              </PlacedLessonCard>
                            ) : (
                            <button
                              type="button"
                              className={`lesson-card${session ? '' : ' lesson-card--empty'}`}
                              draggable={Boolean(placementEnabled && placementSafe && session && placementSlot.periodId)}
                              onDragStart={placementEnabled ? (event) => placement.dragSession(event, placementSlot) : undefined}
                              onDragEnd={placementEnabled ? placement.endDrag : undefined}
                              onClick={() => {
                                if (placementEnabled && (placement.selectedId || placement.moving) && !session) placement.place(placementSlot);
                                else openLessonModal(dayIndex, seg.rowIndex);
                              }}
                              aria-label={ariaLabel}
                            >
                              {session ? (
                                <>
                                  <span className="session-class">{sessionClassName}</span>
                                  <span>{seg.rangeLabel}</span>
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
                            )
                          ) : null}
                        </div>
                      );
                    }

                    return (
                      <div key={seg.rowIndex} className={`slot slot--nonlesson${placementStyle}`} {...placementEvents}>
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
      </div>

      {modalSlot && typeof document !== 'undefined'
        ? createPortal(
            <div className="lesson-modal-backdrop" onClick={closeLessonModal}>
              <div
                ref={lessonModalRef}
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
                <h2 id="lesson-modal-title">{modalSession ? 'Edit lesson' : 'Assign class'}</h2>
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
                          No classes available. Add classes in <a href="/classes">Classes</a> and set each class
                          frequency to at least 1.
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
                    <div className="lesson-modal-bump-actions">
                      <button
                        type="button"
                        className="lesson-modal-bump lesson-modal-bump--danger"
                        onClick={() => handlePullLessonsBackwardForClass()}
                        disabled={!modalSession}
                        aria-label="Pull lesson details left one step"
                      >
                        ×
                      </button>
                      <button
                        type="button"
                        className="lesson-modal-bump"
                        onClick={() => handlePushLessonsForwardForClass()}
                        disabled={!modalSession}
                        aria-label="Push lesson details right one step"
                      >
                        →
                      </button>
                    </div>
                    {lessonPushForwardError ? (
                      <p className="lesson-modal-note lesson-modal-note--warn" role="alert">
                        {lessonPushForwardError}
                      </p>
                    ) : null}
                    {lessonPushForwardSuccess ? (
                      <p className="lesson-modal-note" role="status">
                        {lessonPushForwardSuccess}
                      </p>
                    ) : null}
                  </div>

                  {placementEnabled && modalSession ? (
                    <div className="lesson-modal-secondary-actions" role="group" aria-label="Lesson placement actions">
                      <button type="button" className="lesson-modal-secondary" disabled={!removalSafe}
                        onClick={moveModalPlacement}>Move lesson</button>
                      <button type="button" className="lesson-modal-secondary lesson-modal-secondary--danger" disabled={!removalSafe}
                        onClick={removeModalPlacement}>Remove from timetable</button>
                    </div>
                  ) : null}
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
