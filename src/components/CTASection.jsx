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
              Jump to the full grid, tweak your school-day layout, or update your classes.
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
            Shape your timetable, add classes and school dates, and start planning your teaching year.
          </p>
        </div>

        <div className="cta-actions">
          <button type="button" className="button button-primary button-signup" onClick={dispatchOpenSignupModal}>
            Sign up free
          </button>
          <Link to="/features" className="button button-secondary">
            Explore features
          </Link>
        </div>
      </div>
    </section>
  );
}
