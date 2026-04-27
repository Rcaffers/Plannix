import './CTASection.css';

export default function CTASection() {
  return (
    <section className="section cta-section">
      <div className="container cta-card">
        <div>
          <p className="cta-kicker">Ready to make the leap?</p>
          <h2>Share your vision, and we’ll help shape it into something unforgettable.</h2>
        </div>

        <div className="cta-actions">
          <a href="#" className="button button-primary">
            Our Approach
          </a>
          <a href="#footer" className="button button-secondary">
            Work with us
          </a>
        </div>
      </div>
    </section>
  );
}
