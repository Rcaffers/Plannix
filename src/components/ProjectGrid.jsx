import ProjectCard from './ProjectCard';
import './ProjectGrid.css';

export default function ProjectGrid({ projects }) {
  return (
    <div className="projects-grid">
      {projects.map((project) => (
        <ProjectCard key={project.title} project={project} />
      ))}
    </div>
  );
}
