import { Link } from 'react-router-dom';
import { dispatchOpenSignupModal } from '../utils/plannixEvents';
import './Hero.css';

export default function Hero({ user }) {
  return (
    <section className="section hero-section" id="top">
      <div className="container hero-shell">
        <div className="hero-grid">
          <p className="hero-kicker">{user ? 'Your planner' : 'Plannix'}</p>
          <h1 className="hero-title">
            {user ? 'Welcome back' : 'Plan your teaching week with confidence'}
          </h1>
          <p className="hero-subtitle">
            {user
              ? 'Pick up your timetable, classes, and settings where you left off.'
              : 'Plan weekly or alternating-week lessons, school closures and events in one teacher-friendly timetable.'}
          </p>
          <p className="hero-copy">
            {user ? (
              <>
                Use the timetable below or open the full view anytime. Adjust breaks, lunch, and cycle in{' '}
                <Link to="/settings">Settings</Link>.
              </>
            ) : (
              <>
                Set up your school day, place classes, and keep lesson titles and notes alongside your timetable.
                Review your plans by date whenever you need them.
              </>
            )}
          </p>
          <div className="hero-actions">
            {user ? (
              <>
                <Link to="/timetable" className="hero-button hero-button-primary">
                  Open full timetable
                </Link>
                <Link to="/classes" className="hero-button hero-button-secondary">
                  Classes &amp; input
                </Link>
              </>
            ) : (
              <>
                <button type="button" className="hero-button hero-button-primary" onClick={dispatchOpenSignupModal}>
                  Start free—create an account
                </button>
                <Link to="/features" className="hero-button hero-button-secondary">
                  Explore features
                </Link>
                <a href="#highlights" className="hero-button hero-button-ghost">
                  See what you get
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
