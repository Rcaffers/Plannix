// Stage 1 contract model only. No production route imports this module.
import { createHash, randomBytes } from 'node:crypto';

export const BROWSER_COOKIE_PREFIX = '__Host-plannix-b-';
export const SESSION_COOKIE_PREFIX = '__Host-plannix-s-';
export const RECOVERY_COOKIE_PREFIX = '__Host-plannix-r-';
export const COOKIE_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
export const TRANSITION_LIFETIME_MS = 2 * 60 * 1000;
export const MAX_SESSION_COOKIES = 8;
export const MAX_BROWSER_COOKIES = 4;
export const MAX_COOKIE_HEADER_BYTES = 4096;
export const MAX_BROWSER_FAMILIES = 1024;

const hash = value => createHash('sha256').update(value).digest('hex');
const newSecret = () => randomBytes(32).toString('base64url');
const cookieOptions = 'Path=/; Secure; HttpOnly; SameSite=Lax';
const setCookie = (name, value) => `${name}=${value}; Max-Age=${COOKIE_LIFETIME_SECONDS}; ${cookieOptions}`;
const clearCookie = name => `${name}=; Max-Age=0; ${cookieOptions}`;
const namePattern = /^__Host-plannix-([bsr])-([1-9]\d{0,15})$/;
const secretPattern = /^[A-Za-z0-9_-]{43}$/;
const prefixes = [BROWSER_COOKIE_PREFIX, SESSION_COOKIE_PREFIX, RECOVERY_COOKIE_PREFIX];

function parseCookies(header) {
  if (typeof header !== 'string') return { entries: [], error: 'invalid' };
  const oversized = Buffer.byteLength(header, 'utf8') > MAX_COOKIE_HEADER_BYTES;
  const portion = oversized ? Buffer.from(header.slice(0, MAX_COOKIE_HEADER_BYTES))
    .subarray(0, MAX_COOKIE_HEADER_BYTES).toString('latin1') : header;
  const entries = [];
  const seen = new Set();
  let error = oversized ? 'oversized' : null;
  for (const segment of portion.split(';')) {
    const value = segment.trim();
    if (!value) continue;
    const equal = value.indexOf('=');
    if (equal < 1) { error ||= 'invalid'; continue; }
    const name = value.slice(0, equal).trim();
    if (!prefixes.some(prefix => name.startsWith(prefix))) continue;
    const match = name.match(namePattern);
    if (!match) { error ||= 'invalid'; continue; }
    if (seen.has(name)) error ||= 'duplicate';
    seen.add(name);
    if (entries.length < MAX_SESSION_COOKIES + MAX_BROWSER_COOKIES) {
      entries.push({ name, value: value.slice(equal + 1), type: match[1], sequence: Number(match[2]) });
    } else error ||= 'too-many';
  }
  if (entries.filter(item => item.type === 'b').length > MAX_BROWSER_COOKIES
    || entries.filter(item => item.type !== 'b').length > MAX_SESSION_COOKIES) error ||= 'too-many';
  return { entries, error };
}

export function createSessionTransitionModel({ now = () => Date.now(), random = newSecret } = {}) {
  const families = new Map();
  const records = new Map();
  const intents = new WeakMap();
  let nextSequence = 0;

  function issueSecret() {
    const value = random();
    return typeof value === 'string' && secretPattern.test(value) ? value : null;
  }

  function sequence() {
    nextSequence += 1;
    if (!Number.isSafeInteger(nextSequence) || nextSequence > 9999999999999999) throw new Error('Sequence exhausted');
    return nextSequence;
  }

  function cleanup(entries, limit = MAX_SESSION_COOKIES + MAX_BROWSER_COOKIES) {
    return [...new Set(entries.map(item => item.name))].slice(0, limit).map(clearCookie);
  }

  function observeFamilyExpiry(family, at = now()) {
    if (family.current) observeSessionExpiry(family.current, at);
    if (family.expired) return true;
    if (family.expiresAt > at) return false;
    family.expired = true;
    family.revoked = true;
    if (family.current) family.current.revoked = true;
    if (family.latestIntent) {
      const pending = intents.get(family.latestIntent);
      if (pending?.state === 'pending') pending.state = 'expired';
      family.latestIntent = null;
    }
    return true;
  }

  function observeSessionExpiry(record, at = now()) {
    if (record.expired) return true;
    if (record.expiresAt > at) return false;
    record.expired = true;
    record.revoked = true;
    return true;
  }

  function observeTransitionExpiry(intent, entry, at = now()) {
    const familyExpired = observeFamilyExpiry(entry.family, at);
    if (entry.state === 'pending' && (familyExpired || entry.expiresAt <= at)) {
      entry.state = 'expired';
      if (entry.family.latestIntent === intent) entry.family.latestIntent = null;
    }
    return entry.state === 'expired';
  }

  function selectBrowser(parsed) {
    if (parsed.error) return { state: 'invalid', cleanup: [] };
    const markers = parsed.entries.filter(item => item.type === 'b');
    const sessions = parsed.entries.filter(item => item.type !== 'b');
    if (!markers.length) return sessions.length
      ? { state: 'invalid', cleanup: [] } : { state: 'missing', cleanup: [] };
    for (const cookie of sessions) {
      const record = records.get(cookie.name);
      if (!record || !secretPattern.test(cookie.value) || hash(cookie.value) !== record.hash) {
        return { state: 'invalid', cleanup: [] };
      }
    }
    const valid = [];
    for (const marker of markers) {
      const family = families.get(marker.name);
      if (!family || !secretPattern.test(marker.value) || hash(marker.value) !== family.markerHash) {
        return { state: 'invalid', cleanup: [] };
      }
      valid.push({ marker, family });
    }
    // Validate the complete marker collection before changing state or
    // emitting cleanup; a later forged marker must keep the whole request on
    // the no-cleanup path.
    const observedAt = now();
    for (const { marker, family } of valid) {
      if (observeFamilyExpiry(family, observedAt)) {
        return { state: 'expired', cleanup: [clearCookie(marker.name)] };
      }
      if (family.revoked) {
        return { state: 'invalid', cleanup: [clearCookie(marker.name)] };
      }
    }
    valid.sort((a, b) => b.marker.sequence - a.marker.sequence);
    // An older marker can never become authoritative again. Revoke it before
    // emitting its name-specific cleanup so a delayed response stays safe.
    for (const item of valid.slice(1)) {
      item.family.revoked = true;
      if (item.family.current) item.family.current.revoked = true;
    }
    return { state: 'current', family: valid[0].family,
      cleanup: cleanup(valid.slice(1).map(item => item.marker)) };
  }

  function bootstrap(header) {
    const parsed = parseCookies(header);
    const selected = selectBrowser(parsed);
    if (selected.state === 'current') return { state: 'ready', setCookies: selected.cleanup };
    if (selected.state !== 'missing') return { state: selected.state, setCookies: selected.cleanup };
    for (const [name, family] of families) {
      if (observeFamilyExpiry(family)) {
        for (const record of family.records) records.delete(record.name);
        families.delete(name);
      }
    }
    if (families.size >= MAX_BROWSER_FAMILIES) return { state: 'unavailable', setCookies: [] };
    let secret;
    try { secret = issueSecret(); } catch { return { state: 'unavailable', setCookies: [] }; }
    if (!secret) return { state: 'unavailable', setCookies: [] };
    const name = `${BROWSER_COOKIE_PREFIX}${sequence()}`;
    families.set(name, { name, markerHash: hash(secret), expiresAt: now() + COOKIE_LIFETIME_SECONDS * 1000,
      revoked: false,
      current: null, latestIntent: null, records: [] });
    return { state: 'issued', setCookies: [setCookie(name, secret)] };
  }

  function begin(header, kind = 'ordinary') {
    if (kind !== 'ordinary' && kind !== 'recovery') throw new TypeError('Invalid session kind');
    const selected = selectBrowser(parseCookies(header));
    if (selected.state !== 'current') return { state: selected.state, cleanup: selected.cleanup };
    const family = selected.family;
    const startedAt = now();
    if (observeFamilyExpiry(family, startedAt)) {
      return { state: 'expired', cleanup: [clearCookie(family.name)] };
    }
    if (family.latestIntent) {
      const previous = intents.get(family.latestIntent);
      if (previous?.state === 'pending') previous.state = 'superseded';
    }
    const intent = Object.freeze({});
    intents.set(intent, { state: 'pending', family, kind,
      generation: sequence(), expiresAt: startedAt + TRANSITION_LIFETIME_MS });
    family.latestIntent = intent;
    return { state: 'started', intent, cleanup: selected.cleanup };
  }

  function settle(intent, outcome) {
    const entry = intents.get(intent);
    if (!entry) return { state: 'invalid', setCookies: [] };
    observeTransitionExpiry(intent, entry);
    if (entry.state !== 'pending') return { state: entry.state === 'created' ? 'already-settled' : entry.state, setCookies: [] };
    if (entry.family.revoked) entry.state = 'expired';
    else if (entry.family.latestIntent !== intent) entry.state = 'superseded';
    else entry.state = outcome;
    if (entry.family.latestIntent === intent) entry.family.latestIntent = null;
    return { state: entry.state, setCookies: [] };
  }

  function fail(intent) { return settle(intent, 'failed'); }
  function cancel(intent) { return settle(intent, 'cancelled'); }
  function expire(intent) { return settle(intent, 'expired'); }

  function finish(intent, ownerId) {
    const entry = intents.get(intent);
    if (!entry) return { state: 'invalid', setCookies: [] };
    if (observeTransitionExpiry(intent, entry) || entry.state !== 'pending' || entry.family.revoked
      || entry.family.latestIntent !== intent) {
      return settle(intent, 'expired');
    }
    if (typeof ownerId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(ownerId)) return fail(intent);
    let secret;
    try { secret = issueSecret(); } catch { return fail(intent); }
    if (!secret) return fail(intent);
    const committedAt = now();
    if (observeTransitionExpiry(intent, entry, committedAt) || entry.family.revoked
      || entry.family.latestIntent !== intent) return settle(intent, 'expired');
    const name = `${entry.kind === 'recovery' ? RECOVERY_COOKIE_PREFIX : SESSION_COOKIE_PREFIX}${entry.generation}`;
    const record = { family: entry.family, generation: entry.generation, ownerId,
      kind: entry.kind, name, hash: hash(secret), revoked: false,
      expired: false, expiresAt: committedAt + COOKIE_LIFETIME_SECONDS * 1000 };
    if (entry.family.current) entry.family.current.revoked = true;
    entry.family.current = record;
    entry.family.records.push(record);
    records.set(name, record);
    while (entry.family.records.length > MAX_SESSION_COOKIES) {
      const old = entry.family.records.shift();
      records.delete(old.name);
    }
    entry.state = 'created';
    entry.family.latestIntent = null;
    return { state: 'created', generation: record.generation, kind: record.kind,
      setCookies: [setCookie(name, secret)] };
  }

  function inspect(header, kind = 'ordinary') {
    if (kind !== 'ordinary' && kind !== 'recovery') throw new TypeError('Invalid session kind');
    const parsed = parseCookies(header);
    const selected = selectBrowser(parsed);
    if (selected.state !== 'current') return selected;
    const sessions = parsed.entries.filter(item => item.type !== 'b');
    const stale = [];
    const matches = [];
    for (const cookie of sessions) {
      const record = records.get(cookie.name);
      if (!record || !secretPattern.test(cookie.value) || hash(cookie.value) !== record.hash) {
        return { state: 'invalid', cleanup: [] };
      }
      observeSessionExpiry(record);
      if (record.revoked) stale.push(cookie);
      else if (record.family !== selected.family) return { state: 'invalid', cleanup: [] };
      else if (selected.family.current !== record) stale.push(cookie);
      else if (record.kind === kind) matches.push(record);
      else return { state: 'wrong-kind', cleanup: [...selected.cleanup, ...cleanup(stale)] };
    }
    const staleCleanup = [...selected.cleanup, ...cleanup(stale)];
    if (matches.length > 1) return { state: 'ambiguous', cleanup: [] };
    if (!matches.length) return { state: 'absent', cleanup: staleCleanup };
    return { state: 'current', ownerId: matches[0].ownerId,
      generation: matches[0].generation, name: matches[0].name, cleanup: staleCleanup };
  }

  function logout(header) {
    const selected = inspect(header);
    if (selected.state !== 'current') return { state: selected.state, setCookies: selected.cleanup };
    const record = records.get(selected.name);
    if (record.family.current !== record) return { state: 'superseded', setCookies: [] };
    record.revoked = true;
    record.family.current = null;
    return { state: 'revoked', setCookies: [clearCookie(record.name), ...selected.cleanup] };
  }

  function revokeExact(header, generation) {
    const selected = inspect(header);
    if (selected.state !== 'current' || selected.generation !== generation) return false;
    const record = records.get(selected.name);
    record.revoked = true;
    record.family.current = null;
    return true;
  }

  function refresh(header, confirmedOwnerId) {
    const selected = inspect(header);
    if (selected.state !== 'current' || selected.ownerId !== confirmedOwnerId) {
      return { state: 'rejected', setCookies: selected.cleanup };
    }
    const record = records.get(selected.name);
    if (observeFamilyExpiry(record.family)) {
      return { state: 'rejected', setCookies: [clearCookie(record.family.name)] };
    }
    if (observeSessionExpiry(record) || record.revoked) {
      return { state: 'rejected', setCookies: [clearCookie(record.name)] };
    }
    return { state: 'refreshed', ownerId: record.ownerId, generation: record.generation,
      setCookies: selected.cleanup };
  }

  return { bootstrap, begin, finish, fail, cancel, expire, inspect, logout, revokeExact, refresh };
}
