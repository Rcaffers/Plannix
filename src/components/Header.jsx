import './Header.css';

const navItems = ['Work', 'Approach', 'Services', 'News', 'About', 'Join', 'Contact'];

export default function Header() {
  return (
    <header className="site-header">
      <div className="container nav-shell">
        <a className="brand" href="#top" aria-label="New Genre Home">
          <span className="brand-mark">
            <img className="brand-logo" src="/Plannix_logo.png" alt="Plannix" />
          </span>
        </a>

        <nav className="main-nav" aria-label="Primary navigation">
          {navItems.map((item) => (
            <a
              key={item}
              href={item === 'Work' ? '#work' : '#'}
              className={item === 'Work' ? 'nav-link active' : 'nav-link'}
            >
              {item}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
