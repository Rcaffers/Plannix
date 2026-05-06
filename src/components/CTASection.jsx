import { Link } from 'react-router-dom';
import { dispatchOpenSignupModal } from '../utils/plannixEvents';
import './CTASection.css';

export default function CTASection({ user }) {
  if (user) {
    return (
      <section className="section cta-section" aria-label="Quick links">
        <div className="container cta-card cta-card--member">
          <div>
            <p className="cta-kicker">You are signed in</p>
            <h2>Your timetable is ready when you are</h2>
            <p className="cta-member-lead">
              Jump to the full grid, tweak your layout, or update classes—everything stays in sync across devices on this
              browser.
            </p>
          </div>
          <div className="cta-actions">
            <Link to="/timetable" className="button button-primary">
              Open timetable
            </Link>
            <Link to="/settings" className="button button-secondary">
              Settings
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="section cta-section" id="signup">
      <div className="container cta-card">
        <div>
          <p className="cta-kicker">Start in minutes</p>
          <h2>Create your account and see your first week take shape</h2>
          <p className="cta-guest-lead">
            Set up your account, shape your timetable, add classes, and bring order to your term. When your school is
            ready for more, School and School Pro plans are there to grow with you.
          </p>
        </div>

        <div className="cta-actions">
          <button type="button" className="button button-primary button-signup" onClick={dispatchOpenSignupModal}>
            Sign up free
          </button>
          <Link to="/features" className="button button-secondary">
            Compare plans
          </Link>
        </div>
      </div>
    </section>
  );
}
