import { timetableProject } from '../utils/projectsData';
import ProjectCard from './ProjectCard';
import './ProjectGrid.css';

export default function ProjectGrid() {
  return (
    <div className="projects-grid">
      <ProjectCard project={timetableProject} />
    </div>
  );
}
