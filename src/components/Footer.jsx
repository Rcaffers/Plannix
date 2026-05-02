import { OPEN_COOKIE_SETTINGS_EVENT } from './CookieConsent';
import './Footer.css';

function openCookieSettings(event) {
  event.preventDefault();
  window.dispatchEvent(new CustomEvent(OPEN_COOKIE_SETTINGS_EVENT));
}

const socialLinks = [
  {
    label: 'X',
    href: 'https://x.com/',
    brandClass: 'is-x',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M18.901 1.153h3.68l-8.04 9.19 9.459 12.504h-7.405l-5.8-7.584-6.637 7.584H.478l8.6-9.83L0 1.154h7.594l5.243 6.932L18.901 1.153Zm-1.291 19.498h2.039L6.486 3.236H4.299L17.61 20.651Z"
        />
      </svg>
    ),
  },
  {
    label: 'Facebook',
    href: 'https://www.facebook.com/',
    brandClass: 'is-facebook',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M14.5 8.2h2V5h-2.3c-2.8 0-4.2 1.7-4.2 4.3v2.2H8v3.1h2v7.4h3.4v-7.4h2.6l.4-3.1h-3V9.8c0-.9.3-1.6 1.5-1.6Z"
        />
      </svg>
    ),
  },
  {
    label: 'Instagram',
    href: 'https://www.instagram.com/',
    brandClass: 'is-instagram',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M7.8 2h8.4A5.8 5.8 0 0 1 22 7.8v8.4a5.8 5.8 0 0 1-5.8 5.8H7.8A5.8 5.8 0 0 1 2 16.2V7.8A5.8 5.8 0 0 1 7.8 2Zm-.2 2A3.6 3.6 0 0 0 4 7.6v8.8A3.6 3.6 0 0 0 7.6 20h8.8a3.6 3.6 0 0 0 3.6-3.6V7.6A3.6 3.6 0 0 0 16.4 4H7.6Zm9.65 1.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z"
        />
      </svg>
    ),
  },
];

export default function Footer() {
  return (
    <footer className="site-footer" id="footer">
      <div className="container footer-shell">
        <div className="footer-top">
          <div className="footer-intro">
            <p className="footer-kicker">Work with us</p>
            <h2 className="footer-title">A footer built for a design studio pipeline.</h2>
          </div>

          <div className="social-section">
            <h3>Social</h3>
            <div className="social-list">
              {socialLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  className={`social-link ${link.brandClass}`}
                  aria-label={link.label}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className="social-icon">{link.icon}</span>
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} Plannix</span>
          <div className="footer-legal">
            <a href="#privacy">Privacy</a>
            <a href="#terms">Terms</a>
            <a href="#cookies" onClick={openCookieSettings}>
              Cookies
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
