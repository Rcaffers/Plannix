export function findSessionAt(sessions, dayIndex, timeIndex) {
  return sessions.find((s) => s.day === dayIndex && s.time === timeIndex);
}
