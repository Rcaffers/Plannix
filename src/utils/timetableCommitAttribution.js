// Rendered Stage 4 fixture only. This module is never imported by the app.
export function abandonPending(pending, abandoned, { providerId, observerId, reason }) {
  for (const [id, operation] of pending) {
    if (operation.providerId !== providerId || operation.observerId !== observerId) continue;
    pending.delete(id);
    abandoned.push({ id, reason });
  }
}

export function collectCommittedIds(pending, abandoned, { providerId, observerId,
  context, userId, committedMarkers }) {
  const committed = [];
  const causalIds = new Set(committedMarkers || []);
  const committedChannels = new Set([...pending]
    .filter(([id]) => causalIds.has(id)).map(([,operation]) => operation.commitChannel));
  for (const [id, operation] of pending) {
    if (operation.observerId !== observerId) continue;
    if (!context || operation.providerId !== providerId || operation.userId !== userId
      || operation.sessionName !== context.sessionName
      || operation.generation !== context.generation) {
      pending.delete(id);
      abandoned.push({ id, reason:'context-changed' });
      continue;
    }
    if (causalIds.has(id)) {
      pending.delete(id);
      committed.push(id);
    } else if (committedChannels.has(operation.commitChannel)) {
      pending.delete(id);
      abandoned.push({ id, reason:'superseded-update' });
    }
  }
  return committed;
}
