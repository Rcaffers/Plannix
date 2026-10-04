import './HomeHighlights.css';

const highlights = [
  {
    title: 'Plan lessons by week',
    body: 'Use a weekly or Week A/B timetable. Place classes in teaching slots and add lesson titles and notes.',
  },
  {
    title: 'Keep the school year in view',
    body: 'Set your academic year and school holidays or closures. Add dated events, with optional weekend visibility in the timetable.',
  },
  {
    title: 'Review AI holiday suggestions',
    body: 'Import from pasted text, PDF, images, Excel or CSV. Review suggestions, add them to your draft, then save the academic year.',
  },
  {
    title: 'Preview extracted events',
    body: 'Extract event ideas from text or a document and correct them in an editable preview. The preview does not save events.',
  },
  {
    title: 'See each class across the year',
    body: 'Filter Class Monitor by class and date, then export the report to Excel or print it.',
  },
  {
    title: 'Keep Plannix close',
    body: 'Install Plannix on your home screen. On supported devices, you can opt in to notifications and send a test notification.',
  },
];

export default function HomeHighlights() {
  return (
    <section className="section home-highlights" id="highlights" aria-labelledby="home-highlights-heading">
      <div className="container home-highlights-inner">
        <header className="home-highlights-header">
          <p className="home-highlights-kicker">Why teachers use Plannix</p>
          <h2 id="home-highlights-heading">Plan the week and see the bigger picture</h2>
          <p className="home-highlights-lead">
            From class placement to term dates and reports, keep the details of your teaching year together.
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
