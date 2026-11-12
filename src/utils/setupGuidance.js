import { SETUP_STEPS, setupGuideKey } from './setupProgress.js';
import { serverManagedAuth, captureServerOperationContext, assertServerOperationContext } from './serverAuthTransport.js';

export const SETUP_GUIDANCE_CHANGED = 'plannix-setup-guidance-changed';
const revisionKey = userId => `plannix-setup-guide:${userId}:revision`;
const fallback = new Map();

function read(key) {
  try { return localStorage.getItem(key) ?? fallback.get(key) ?? null; }
  catch { return fallback.get(key) ?? null; }
}

function write(key, value) {
  fallback.set(key, value);
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

function announce(userId) {
  try { window.dispatchEvent(new CustomEvent(SETUP_GUIDANCE_CHANGED, { detail: { userId } })); }
  catch { /* Preference notifications must not affect settings saves. */ }
}

export function setupGuidancePreference(userId, stepId) {
  return userId ? read(setupGuideKey(userId, stepId)) : null;
}

export function setSetupGuidanceVisible(userId, stepId, visible) {
  if (!userId || !SETUP_STEPS.some(step => step.id === stepId)) return false;
  const written = write(setupGuideKey(userId, stepId), visible ? 'shown' : 'dismissed');
  announce(userId);
  return written;
}

function completeSetupGuidance(userId, stepId) {
  if (!userId || !SETUP_STEPS.some(step => step.id === stepId)) return false;
  const written = write(setupGuideKey(userId, stepId), 'completed');
  announce(userId);
  return written;
}

export function restoreSetupGuidance(userId) {
  if (!userId) return false;
  const revision = globalThis.crypto?.randomUUID?.() || `${Date.now()}:${Math.random()}`;
  let persisted = write(revisionKey(userId), revision);
  for (const step of SETUP_STEPS) persisted = write(setupGuideKey(userId, step.id), 'shown') && persisted;
  announce(userId);
  return persisted;
}

// Capture before the first await. A save that started before a checklist reset
// cannot consume the newly restored instructions when it later completes.
export function beginSetupGuidanceSave(userId, stepId) {
  if (!userId) return null;
  try {
    return { userId, stepId, revision: read(revisionKey(userId)),
      context: serverManagedAuth ? captureServerOperationContext(userId) : null };
  } catch { return null; } // Guidance must never prevent a settings save.
}

export function finishSetupGuidanceSave(ticket) {
  if (!ticket) return false;
  try {
    if (ticket.context) assertServerOperationContext(ticket.context);
    if (read(revisionKey(ticket.userId)) !== ticket.revision) return false;
    return completeSetupGuidance(ticket.userId, ticket.stepId);
  } catch { return false; }
}
