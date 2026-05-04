import { featureTiers } from '../utils/featuresData';
import './Features.css';

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
          {featureTiers.map((tier) => (
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
