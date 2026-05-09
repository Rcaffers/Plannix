import { Link } from 'react-router-dom';
import { dispatchOpenCookieSettings } from '../utils/cookieConsent';
import {
  dispatchOpenLoginModal,
  dispatchOpenPrivacyModal,
  dispatchOpenSignupModal,
  dispatchOpenTermsModal,
} from '../utils/plannixEvents';
import './Footer.css';

function openCookieSettings(event) {
  event.preventDefault();
  dispatchOpenCookieSettings();
}

function openTermsModal(event) {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) {
    return;
  }
  event.preventDefault();
  dispatchOpenTermsModal();
}

function openPrivacyModal(event) {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) {
    return;
  }
  event.preventDefault();
  dispatchOpenPrivacyModal();
}

export default function Footer({ user }) {
  return (
    <footer className="site-footer" id="footer">
      <div className="container footer-shell">
        <div className="footer-grid">
          <div className="footer-brand">
            <p className="footer-kicker">Plannix</p>
            <p className="footer-tagline">
              Weekly timetables for teachers—classes, holidays, Week A/B, and a school day that matches reality.
            </p>
          </div>

          <nav className="footer-nav" aria-label="Footer">
            <div className="footer-nav-col">
              <h3 className="footer-nav-heading">Product</h3>
              <ul className="footer-nav-list">
                <li>
                  <Link to="/">Home</Link>
                </li>
                <li>
                  <Link to="/features">Plans &amp; pricing</Link>
                </li>
                <li>
                  <Link to="/timetable">Timetable</Link>
                </li>
              </ul>
            </div>
            <div className="footer-nav-col">
              <h3 className="footer-nav-heading">Account</h3>
              <ul className="footer-nav-list">
                {user ? (
                  <>
                    <li>
                      <Link to="/timetable">Timetable</Link>
                    </li>
                    <li>
                      <Link to="/settings">Settings</Link>
                    </li>
                    <li>
                      <Link to="/classes">Classes</Link>
                    </li>
                  </>
                ) : (
                  <>
                    <li>
                      <button type="button" className="footer-link-button" onClick={dispatchOpenSignupModal}>
                        Sign up
                      </button>
                    </li>
                    <li>
                      <button type="button" className="footer-link-button" onClick={dispatchOpenLoginModal}>
                        Login
                      </button>
                    </li>
                  </>
                )}
              </ul>
            </div>
            <div className="footer-nav-col" id="contact">
              <h3 className="footer-nav-heading">Contact</h3>
              <ul className="footer-nav-list">
                <li>
                  <Link to="/contact">Contact us</Link>
                </li>
              </ul>
              <p className="footer-contact-text">
                Interested in Plannix for your school or department? Compare plans above, or create an account to try the
                Individual tier.
              </p>
            </div>
          </nav>
        </div>

        <div className="footer-bottom">
          <span className="footer-copy">© {new Date().getFullYear()} Plannix. All rights reserved.</span>
          <div className="footer-legal">
            <a href="/terms" onClick={openTermsModal}>
              Terms &amp; conditions
            </a>
            <a href="/privacy" onClick={openPrivacyModal}>
              Privacy
            </a>
            <a href="#cookies" onClick={openCookieSettings}>
              Cookie settings
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
