// Undefined means an archived/missing default requires an explicit new choice.
// Null is a confirmed No room value; never replace it with a class default.
export function newPlacementRoom(classId, classes, rooms) {
  const id=classes?.find(entry=>entry.id===classId)?.defaultRoomId;
  if(!id)return null;
  return rooms.some(room=>room.id===id&&room.isActive) ? id : undefined;
}
