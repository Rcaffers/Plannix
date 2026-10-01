import ProjectGrid from '../components/ProjectGrid';

export default function Timetable({ userId }) {
  return (
    <main>
      <section className="section content-section main-timetable-section" id="work">
        <ProjectGrid projectCardProps={{ enableEditing: false, weekMode: 'date', weekendEventsUserId: userId }} />
      </section>
    </main>
  );
}
