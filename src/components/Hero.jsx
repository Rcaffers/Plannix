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
              : 'A weekly timetable built for teachers—classes, holidays, Week A/B, and a layout that matches your school day.'}
          </p>
          <p className="hero-copy">
            {user ? (
              <>
                Use the timetable below or open the full view anytime. Adjust breaks, lunch, and cycle in{' '}
                <Link to="/settings">Settings</Link>.
              </>
            ) : (
              <>
                Stop juggling spreadsheets and sticky notes. Plannix keeps limits, dates, and term breaks in sync so you
                can focus on teaching. Join teachers who use the Individual plan today—School and School Pro when you are
                ready to scale.
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
                  View plans and pricing
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
