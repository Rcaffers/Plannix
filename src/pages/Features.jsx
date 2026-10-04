import { featureTiers } from '../utils/featuresData';
import { dispatchOpenSignupModal } from '../utils/plannixEvents';
import './Features.css';

export default function Features({ user }) {
  return (
    <main className="features-page">
      <div className="container features-inner">
        <header className="features-header">
          <p className="features-kicker">Features</p>
          <h1 className="features-title">Explore what Plannix can do</h1>
          <p className="features-lead">
            Set up your lessons, review school dates and events, and see what you have planned for each class.
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
