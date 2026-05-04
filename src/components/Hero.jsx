import './Hero.css';

export default function Hero() {
  return (
    <section className="section hero-section" id="top">
      <div className="container hero-shell">
        <div className="hero-grid">
          <p className="hero-kicker">Planning Suite</p>
          <h1 className="hero-title">Next Level Planning</h1>
          <p className="hero-subtitle">From planning to sharing</p>
          <p className="hero-copy">
            We are here to organise your teaching schedule and help you share it with your students.
          </p>
        </div>
      </div>
    </section>
  );
}
