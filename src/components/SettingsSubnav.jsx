import { NavLink } from 'react-router-dom';

export const SETTINGS_SUBNAV_ITEMS = [
  { to: '/settings', end: true, label: 'Timetable settings' },
  { to: '/settings/academic-year', label: 'Academic year' },
  { to: '/classes', end: true, label: 'Classes' },
  { to: '/classes/input', label: 'Input classes' },
  { to: '/settings/subscription', label: 'Subscription' },
];

export default function SettingsSubnav() {
  const linkClass = ({ isActive }) => `classes-subnav-link${isActive ? ' is-active' : ''}`;

  return (
    <nav className="classes-subnav" aria-label="Settings sections">
      {SETTINGS_SUBNAV_ITEMS.map((item) => (
        <NavLink key={`${item.to}${item.end ? '-end' : ''}`} to={item.to} end={Boolean(item.end)} className={linkClass}>
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
