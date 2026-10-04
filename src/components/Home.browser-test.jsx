import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Hero from './Hero';
import HomeHighlights from './HomeHighlights';
import CTASection from './CTASection';
import Features from '../pages/Features';
import '../styles/base.css';

createRoot(document.getElementById('root')).render(
  <MemoryRouter>
    <Routes>
      <Route path="/" element={<main><Hero user={null} /><HomeHighlights /><CTASection user={null} /></main>} />
      <Route path="/features" element={<Features user={null} />} />
    </Routes>
  </MemoryRouter>,
);
