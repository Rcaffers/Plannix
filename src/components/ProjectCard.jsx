import { useState } from 'react';
import './ProjectCard.css';

const dayColumns = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const timeRows = ['09:00', '10:30', '12:00', '13:30', '15:00'];

const initialSessions = [
  { day: 0, time: 0, class: '10pg/Ma6', meta: '09:10 - 10:10', teacher: 'RCA', title: '' },
  { day: 1, time: 0, class: '1sp/Ma6', meta: '09:10 - 10:10', teacher: 'RCA', title: '' },
  { day: 2, time: 0, class: '7py/Ma6', meta: '09:10 - 10:10', teacher: 'RCA (RE/AHD)', title: '' },
  { day: 3, time: 1, class: '1ja/Ma1', meta: '10:30 - 11:30', teacher: 'RCA', title: '' },
  { day: 4, time: 1, class: '11B/Ma2', meta: '10:30 - 11:30', teacher: 'RCA', title: '' },
  { day: 0, time: 2, class: '1be/Ma6', meta: '11:30 - 12:30', teacher: 'RCA', title: '' },
  { day: 2, time: 3, class: 'PM Reg', meta: '13:20 - 14:20', teacher: '11a/Ma1', title: '' },
  { day: 4, time: 4, class: '7py/Ma3', meta: '14:20 - 15:20', teacher: 'RCA', title: '' },
];

export default function ProjectCard({ project }) {
  const [sessions, setSessions] = useState(() => initialSessions.map((s) => ({ ...s })));
  const [modalSlot, setModalSlot] = useState(null);
  const [titleDraft, setTitleDraft] = useState('');

  const modalSession =
    modalSlot == null
      ? null
      : sessions.find((s) => s.day === modalSlot.day && s.time === modalSlot.time) ?? null;

  function openLessonModal(dayIndex, timeIndex) {
    const session = sessions.find((s) => s.day === dayIndex && s.time === timeIndex);
    if (!session) return;
    setModalSlot({ day: dayIndex, time: timeIndex });
    setTitleDraft(session.title);
  }

  function closeLessonModal() {
    setModalSlot(null);
    setTitleDraft('');
  }

  function saveLessonTitle(event) {
    event.preventDefault();
    if (modalSlot == null) return;
    setSessions((prev) =>
      prev.map((s) =>
        s.day === modalSlot.day && s.time === modalSlot.time ? { ...s, title: titleDraft.trim() } : s
      )
    );
    closeLessonModal();
  }

  return (
    <article className="project-card">
      <div className="schedule-card">
        <div className="schedule-titlebar">
          <strong>{project.title}</strong>
          <span>{project.subtitle}</span>
        </div>
        <div className="schedule-head">
          <span className="time-head">Time</span>
          {dayColumns.map((day) => (
            <span key={day} className="day-head">
              {day}
            </span>
          ))}
        </div>

        <div className="schedule-grid">
          <div className="time-col">
            {timeRows.map((time) => (
              <span key={time} className="time-label">
                {time}
              </span>
            ))}
          </div>

          {dayColumns.map((day, dayIndex) => (
            <div key={day} className="day-col">
              {timeRows.map((time, timeIndex) => {
                const session = sessions.find(
                  (item) => item.day === dayIndex && item.time === timeIndex
                );

                return (
                  <div key={`${day}-${time}`} className="slot">
                    {session ? (
                      <button
                        type="button"
                        className="lesson-card"
                        onClick={() => openLessonModal(dayIndex, timeIndex)}
                        aria-label={`Edit lesson: ${session.class}${session.title.trim() ? `, ${session.title.trim()}` : ''}`}
                      >
                        <span className="session-class">{session.class}</span>
                        <span>{session.meta}</span>
                        <span>{session.teacher}</span>
                        {session.title.trim() ? (
                          <span className="session-lesson-title">{session.title.trim()}</span>
                        ) : null}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {modalSession && modalSlot ? (
        <div className="lesson-modal-backdrop" onClick={closeLessonModal}>
          <div
            className="lesson-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lesson-modal-title"
            onClick={(event) => event.stopPropagation()}
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
