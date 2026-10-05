import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import AnalyticsTracker from './AnalyticsTracker';
import CookieConsent from '../modals/CookieConsent';
import Footer from './Footer';
import '../styles/base.css';

function Fixture() {
  const [user, setUser] = useState(null);
  return <MemoryRouter>
    <AnalyticsTracker user={user} isAuthLoading={false} />
    <nav aria-label="Test navigation">
      <Link id="test-home" to="/">Home</Link>{' '}
      <Link id="test-features" to="/features">Features</Link>{' '}
      <Link id="test-contact" to="/contact">Contact</Link>{' '}
      <Link id="test-private" to="/timetable">Private timetable</Link>{' '}
      <Link id="test-query" to="/contact?email=private@example.test">Private query</Link>
    </nav>
    <button id="test-auth" type="button" onClick={() => setUser(current => current ? null : { id: 'synthetic-user' })}>Toggle signed in</button>
    <Routes>
      <Route path="/" element={<main><h1>Home</h1></main>} />
      <Route path="/features" element={<main><h1>Features</h1></main>} />
      <Route path="/contact" element={<main><h1>Contact</h1></main>} />
      <Route path="/timetable" element={<main><h1>Private timetable</h1></main>} />
    </Routes>
    <Footer user={user} />
    <CookieConsent />
  </MemoryRouter>;
}

createRoot(document.getElementById('root')).render(<Fixture />);
