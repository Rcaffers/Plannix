import './Footer.css';

function formatTime(timeZone) {
  return new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  }).format(new Date());
}

const offices = [
  {
    city: 'London',
    timezone: 'Europe/London',
    email: 'london@newgenre.studio',
    phone: '+44 20 4572 6788',
    address: '2 Appleby Yard, Soames Walk, London SE10 0BJ',
  },
  {
    city: 'San Francisco',
    timezone: 'America/Los_Angeles',
    email: 'sf@newgenre.studio',
    phone: '+1 650 466 6274',
    address: 'California, United States',
  },
];

const socialLinks = [
  { label: 'LinkedIn', href: 'https://uk.linkedin.com/' },
  { label: 'Instagram', href: 'https://www.instagram.com/' },
  { label: 'X', href: 'https://x.com/' },
];

export default function Footer() {
  return (
    <footer className="site-footer" id="footer">
      <div className="container footer-shell">
        <div className="footer-top">
          <div>
            <p className="footer-kicker">Work with us</p>
            <h2 className="footer-title">A footer built for a design studio pipeline.</h2>
          </div>

          <div className="footer-links">
            <a href="#">Join Us</a>
            <a href="#">Newsletter</a>
            <a href="#">Privacy</a>
          </div>
        </div>

        <div className="footer-grid">
          {offices.map((office) => (
            <article key={office.city} className="office-card">
              <h3>{office.city}</h3>
              <p className="office-time">{formatTime(office.timezone)}</p>
              <a href={`mailto:${office.email}`}>{office.email}</a>
              <a href={`tel:${office.phone.replace(/\s+/g, '')}`}>{office.phone}</a>
              <p>{office.address}</p>
            </article>
          ))}

          <div className="office-card social-card">
            <h3>Elsewhere</h3>
            <div className="social-list">
              {socialLinks.map((link) => (
                <a key={link.label} href={link.href} target="_blank" rel="noreferrer">
                  {link.label}
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} New Genre inspired boilerplate</span>
          <span>Built with React + Vite</span>
        </div>
      </div>
    </footer>
  );
}
