import './HomeHighlights.css';

const highlights = [
  {
    title: 'Real weeks, real dates',
    body: 'Move week by week with a timetable that knows Monday to Friday—including Week A and Week B when you use a two-week cycle.',
  },
  {
    title: 'Classes that stay within limits',
    body: 'Define what you teach and how often. Plannix helps you place classes without blowing past the totals you set.',
  },
  {
    title: 'Holidays that blank the grid',
    body: 'Add term breaks and holidays once; those days show as closed, and full weeks off keep your A/B pattern in step.',
  },
  {
    title: 'Your day, your layout',
    body: 'Set periods, registration, breaks, and lunch in settings so the grid matches how your school actually runs.',
  },
];

export default function HomeHighlights() {
  return (
    <section className="section home-highlights" id="highlights" aria-labelledby="home-highlights-heading">
      <div className="container home-highlights-inner">
        <header className="home-highlights-header">
          <p className="home-highlights-kicker">Why teachers use Plannix</p>
          <h2 id="home-highlights-heading">Everything in one weekly view</h2>
          <p className="home-highlights-lead">
            Built for teachers who want a clear timetable—not another generic calendar. Start with the Individual plan and
            grow when your school is ready.
          </p>
        </header>
        <ul className="home-highlights-grid">
          {highlights.map((item) => (
            <li key={item.title} className="home-highlights-card">
              <h3 className="home-highlights-card-title">{item.title}</h3>
              <p className="home-highlights-card-body">{item.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
