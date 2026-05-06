import { NavLink } from 'react-router-dom';

export default function SettingsSubnav() {
  const linkClass = ({ isActive }) => `classes-subnav-link${isActive ? ' is-active' : ''}`;

  return (
    <nav className="classes-subnav" aria-label="Settings sections">
      <NavLink to="/settings" end className={linkClass}>
        Timetable settings
      </NavLink>
      <NavLink to="/settings/academic-year" className={linkClass}>
        Academic year
      </NavLink>
      <NavLink to="/classes" end className={linkClass}>
        Classes
      </NavLink>
      <NavLink to="/classes/input" className={linkClass}>
        Input classes
      </NavLink>
    </nav>
  );
}
