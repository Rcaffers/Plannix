import ProjectGrid from '../components/ProjectGrid';

export default function Timetable() {
  return (
    <main>
      <section className="section content-section" id="work">
        <ProjectGrid projectCardProps={{ enableEditing: false, weekMode: 'date' }} />
      </section>
    </main>
  );
}

