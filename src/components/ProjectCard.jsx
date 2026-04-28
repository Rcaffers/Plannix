import './ProjectCard.css';

const dayColumns = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const timeRows = ['09:00', '10:30', '12:00', '13:30', '15:00'];
const sessions = [
  { day: 0, time: 0, title: 'Spg/Ma6', meta: '09:10 - 10:10', room: 'RCA' },
  { day: 1, time: 0, title: '1sp/Ma6', meta: '09:10 - 10:10', room: 'RCA' },
  { day: 2, time: 0, title: '7py/Ma6', meta: '09:10 - 10:10', room: 'RCA (RE/AHD)' },
  { day: 3, time: 1, title: '1ja/Ma1', meta: '10:30 - 11:30', room: 'RCA' },
  { day: 4, time: 1, title: '11B/Ma2', meta: '10:30 - 11:30', room: 'RCA' },
  { day: 0, time: 2, title: '1be/Ma6', meta: '11:30 - 12:30', room: 'RCA' },
  { day: 2, time: 3, title: 'PM Reg', meta: '13:20 - 14:20', room: '11a/Ma1' },
  { day: 4, time: 4, title: '7py/Ma3', meta: '14:20 - 15:20', room: 'RCA' },
];

export default function ProjectCard({ project }) {
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
                      <a className="lesson-card" href={project.href} aria-label={`${session.title} lesson`}>
                        <span className="session-title">{session.title}</span>
                        <span>{session.meta}</span>
                        <span>{session.room}</span>
                      </a>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}
