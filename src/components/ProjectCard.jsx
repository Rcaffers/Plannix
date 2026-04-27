import './ProjectCard.css';

const accentMap = {
  forest: 'linear-gradient(140deg, #1f3428 0%, #3d634d 45%, #d8ead7 100%)',
  stone: 'linear-gradient(140deg, #d9d3cc 0%, #bcb5ab 48%, #8c857c 100%)',
  blueprint: 'linear-gradient(140deg, #0a0c18 0%, #3347c8 42%, #d8ddea 100%)',
  warm: 'linear-gradient(140deg, #d7b28a 0%, #f1dfc7 52%, #8a6249 100%)',
  mint: 'linear-gradient(140deg, #0e3531 0%, #2f7d73 46%, #dcfbef 100%)',
  sand: 'linear-gradient(140deg, #f0dfd4 0%, #e2c2ad 55%, #baa190 100%)',
  violet: 'linear-gradient(140deg, #201443 0%, #6d4cff 55%, #ddd7ff 100%)',
  rose: 'linear-gradient(140deg, #f4f2f2 0%, #f765b9 48%, #ffe3f3 100%)',
  ember: 'linear-gradient(140deg, #140d0c 0%, #7b3125 48%, #ffc6ab 100%)',
  crimson: 'linear-gradient(140deg, #160c0f 0%, #7d1632 44%, #f7b1c0 100%)',
  gold: 'linear-gradient(140deg, #251d09 0%, #9c7d2e 44%, #f3e8c0 100%)',
  teal: 'linear-gradient(140deg, #0a1a1c 0%, #15545f 44%, #cfeff1 100%)',
  fabric: 'linear-gradient(140deg, #1f2336 0%, #52618a 44%, #dbdff1 100%)',
  slate: 'linear-gradient(140deg, #0f1418 0%, #41515e 48%, #dbe4eb 100%)',
  leaf: 'linear-gradient(140deg, #122217 0%, #397240 44%, #def0d4 100%)',
  ink: 'linear-gradient(140deg, #101010 0%, #3f3f3f 48%, #dadada 100%)',
  brass: 'linear-gradient(140deg, #22170f 0%, #7d5c28 48%, #e9d4ac 100%)',
  candy: 'linear-gradient(140deg, #2a0f18 0%, #fb4f8b 48%, #ffd9ec 100%)',
  theatre: 'linear-gradient(140deg, #140e1b 0%, #60428c 48%, #ddd0ff 100%)',
  money: 'linear-gradient(140deg, #0f1d13 0%, #1b7a4a 48%, #cbf5dd 100%)',
  lilac: 'linear-gradient(140deg, #181427 0%, #7561a8 48%, #e8e0ff 100%)',
  sunset: 'linear-gradient(140deg, #2f162f 0%, #ff7f4d 48%, #ffd4a8 100%)',
};

export default function ProjectCard({ project }) {
  const style = project.image
    ? {
        backgroundImage: `linear-gradient(180deg, rgba(10,10,10,0.05), rgba(10,10,10,0.55)), url(${project.image})`,
      }
    : {
        backgroundImage: `${accentMap[project.accent]}, radial-gradient(circle at 15% 20%, rgba(255,255,255,0.24), transparent 30%)`,
      };

  return (
    <a className="project-card" href={project.href}>
      <div className="project-visual" style={style}>
        {!project.image && <span className="project-monogram">{project.title.slice(0, 2)}</span>}
      </div>
      <div className="project-copy">
        <div className="project-meta">
          {project.categories.filter((item) => item !== 'All').slice(0, 2).join(' • ')}
        </div>
        <h3>{project.title}</h3>
        <p>{project.subtitle}</p>
      </div>
    </a>
  );
}
