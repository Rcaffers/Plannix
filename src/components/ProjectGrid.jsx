import ProjectCard from './ProjectCard';
import './ProjectGrid.css';

const timetableProject = {
  title: 'Weekly Timetable',
  subtitle: 'Teaching Schedule',
  href: '#',
};

export default function ProjectGrid() {
  return (
    <div className="projects-grid">
      <ProjectCard project={timetableProject} />
    </div>
  );
}
