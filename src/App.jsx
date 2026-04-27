import { useMemo, useState } from 'react';
import './App.css';
import Header from './components/Header';
import Hero from './components/Hero';
import FilterTabs from './components/FilterTabs';
import ProjectGrid from './components/ProjectGrid';
import CTASection from './components/CTASection';
import Footer from './components/Footer';
import { filters, projects } from './data/projects';

export default function App() {
  const [activeFilter, setActiveFilter] = useState('All');

  const filteredProjects = useMemo(() => {
    if (activeFilter === 'All') return projects;
    return projects.filter((project) => project.categories.includes(activeFilter));
  }, [activeFilter]);

  return (
    <div className="page-shell">
      <Header />
      <main>
        <Hero />
        <section className="section content-section" id="work">
          <FilterTabs
            activeFilter={activeFilter}
            filters={filters}
            onChange={setActiveFilter}
          />
          <ProjectGrid projects={filteredProjects} />
        </section>
        <CTASection />
      </main>
      <Footer />
    </div>
  );
}
