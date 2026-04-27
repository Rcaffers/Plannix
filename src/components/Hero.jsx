import './Hero.css';

export default function Hero() {
  return (
    <section className="section hero-section" id="top">
      <div className="container hero-grid">
        <div className="eyebrow">Studio Work</div>
        <h1 className="hero-title">Our work</h1>
        <p className="hero-subtitle">From idea to exit</p>
        <p className="hero-copy">
          A React/Vite boilerplate inspired by a premium studio portfolio: sticky nav,
          oversized editorial typography, filterable case studies, and a contact-driven
          footer ready for real content.
        </p>
      </div>
    </section>
  );
}
