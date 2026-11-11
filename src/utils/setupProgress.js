export const SETUP_STEPS = [
  { id: 'year', title: 'Add your academic year', to: '/settings/academic-year', next: '/settings',
    explanation: 'Set the dates of your school year so the planner knows which weeks to show.',
    example: 'For example, 2026–27 from September to July.',
    save: 'Enter a name, start date and end date, then choose Save academic year.' },
  { id: 'layout', title: 'Set your school day', to: '/settings', next: '/classes',
    explanation: 'Choose your teaching periods, day start, breaks and timetable cycle.',
    example: 'For example, five 60-minute periods starting at 08:30.',
    save: 'Review the required timetable name, periods and times, then choose Save timetable layout.' },
  { id: 'classes', title: 'Add your classes', to: '/classes', next: '/classes/input',
    explanation: 'List the classes you teach before placing them in the timetable.',
    example: 'For example, 9A Maths, three lessons each week.',
    save: 'Add a class name and frequency, then choose Save classes.' },
  { id: 'placements', title: 'Place your lessons', to: '/classes/input', next: '/timetable',
    explanation: 'Put your saved classes into the repeating timetable.',
    example: 'For example, place 9A Maths in Monday period 1.',
    save: 'Choose Edit classes, select a slot and class, then wait for the automatic save before choosing Finish editing.' },
  { id: 'ai', title: 'Connect an AI provider', to: '/profile', next: '/setup', optional: true,
    explanation: 'Connect your own AI provider if you want help importing holidays.',
    save: 'Choose a provider and enter its API key in Profile, then save the connection. For security, re-enter the key if a save cannot be confirmed.' },
  { id: 'notifications', title: 'Set up notifications', to: '/settings/notifications', next: '/setup', optional: true,
    explanation: 'Choose whether to receive a morning summary on this device.',
    save: 'Review the delivery time and academic year, save preferences, then enable notifications on this device.' },
];

export function setupCompletion({ yearSaved, yearSelected = yearSaved, layoutSaved, classesLoaded, savedClasses,
  recurringReady, recurring, timetableUnsaved }) {
  return {
    year: Boolean(yearSaved),
    layout: Boolean(yearSelected && layoutSaved),
    classes: Boolean(yearSelected && classesLoaded && savedClasses?.length),
    placements: Boolean(yearSelected && layoutSaved && recurringReady && !timetableUnsaved
      && recurring?.some(week => week.sessions?.some(session => session.classId))),
  };
}

export function setupGuideKey(userId, stepId) {
  return `plannix-setup-guide:${userId}:${stepId}`;
}
