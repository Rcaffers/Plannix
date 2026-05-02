import './Features.css';

const tiers = [
  {
    heading: 'Individual',
    description: 'Plan your week, lessons, and priorities in one place—built for a single teacher’s workflow.',
  },
  {
    heading: 'School',
    description: 'Shared structure and visibility for departments and teams, with room to grow as your school does.',
  },
  {
    heading: 'School Pro',
    description: 'Advanced coordination, reporting, and support for larger institutions with complex timetables.',
  },
];

export default function Features() {
  return (
    <main className="features-page">
      <div className="container features-inner">
        <header className="features-header">
          <p className="features-kicker">Plans</p>
          <h1 className="features-title">Choose the level that fits you</h1>
          <p className="features-lead">
            Three ways to use Plannix—each tier adds depth for individuals, whole schools, and enterprise-style
            operations.
          </p>
        </header>

        <ul className="features-cards">
          {tiers.map((tier) => (
            <li key={tier.heading} className="features-card">
              <h2 className="features-card-heading">{tier.heading}</h2>
              <p className="features-card-body">{tier.description}</p>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
