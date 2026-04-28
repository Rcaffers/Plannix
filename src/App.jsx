import './App.css';
import Header from './components/Header';
import Hero from './components/Hero';
import ProjectGrid from './components/ProjectGrid';
import CTASection from './components/CTASection';
import Footer from './components/Footer';

export default function App() {
  return (
    <div className="page-shell">
      <Header />
      <main>
        <Hero />
        <section className="section content-section" id="work">
          <ProjectGrid />
        </section>
        <CTASection />
      </main>
      <Footer />
    </div>
  );
}
