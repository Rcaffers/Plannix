// A null assignment is known No room. Missing/unconfirmed data is never a default.
export function timetableRoomText(session, { assignmentsReady, catalogueReady, rooms }) {
  if (!assignmentsReady || !Object.hasOwn(session || {}, 'roomId')) return 'Room unavailable';
  if (session.roomId === null) return null;
  if (!catalogueReady) return 'Room unavailable';
  const room = rooms.find(entry => entry.id === session.roomId);
  return room ? `Room: ${room.name}${room.isActive ? '' : ' (Archived)'}` : 'Room unavailable';
}
