import { featureTiers } from '../utils/featuresData';
import { dispatchOpenSignupModal } from '../utils/plannixEvents';
import './Features.css';

export default function Features({ user }) {
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
          {featureTiers.map((tier) => {
            const showCta = tier.signupCta && !user;
            return (
              <li
                key={tier.heading}
                className={`features-card${tier.signupCta ? ' features-card--tier-primary' : ''}`}
              >
                <div className="features-card-main">
                  <h2 className="features-card-heading">{tier.heading}</h2>
                  <p className="features-card-body">{tier.description}</p>
                  {tier.bullets?.length ? (
                    <ul className="features-card-bullets">
                      {tier.bullets.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                {showCta ? (
                  <div className="features-card-cta">
                    <button type="button" className="features-card-signup" onClick={dispatchOpenSignupModal}>
                      Sign up
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}
