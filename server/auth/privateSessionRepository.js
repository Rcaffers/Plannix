// Stage 2 server-only adapter. No route imports or activates this repository.
import { createHash, randomBytes } from 'node:crypto';
import {
  BROWSER_COOKIE_PREFIX, COOKIE_LIFETIME_SECONDS, MAX_BROWSER_COOKIES,
  MAX_COOKIE_HEADER_BYTES, MAX_SESSION_COOKIES, RECOVERY_COOKIE_PREFIX,
  SESSION_COOKIE_PREFIX,
} from './sessionTransitions.js';

const cookieName = /^__Host-plannix-([bsr])-([1-9]\d{0,15})$/;
const secretPattern = /^[A-Za-z0-9_-]{43}$/;
const cookieSuffix = `Max-Age=${COOKIE_LIFETIME_SECONDS}; Path=/; Secure; HttpOnly; SameSite=Lax`;
const digest = secret => createHash('sha256').update(secret).digest('hex');
const unavailable = () => new Error('Session service unavailable.');

export function parsePrivateSessionCookies(header) {
  if (typeof header !== 'string' || Buffer.byteLength(header, 'utf8') > MAX_COOKIE_HEADER_BYTES) {
    return { state: 'invalid', markers: [], sessions: [] };
  }
  const markers = []; const sessions = []; const seen = new Set();
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const equal = trimmed.indexOf('=');
    if (equal < 1) return { state: 'invalid', markers: [], sessions: [] };
    const name = trimmed.slice(0, equal).trim();
    if (![BROWSER_COOKIE_PREFIX, SESSION_COOKIE_PREFIX, RECOVERY_COOKIE_PREFIX]
      .some(prefix => name.startsWith(prefix))) continue;
    const match = name.match(cookieName);
    const secret = trimmed.slice(equal + 1);
    if (!match || !secretPattern.test(secret) || seen.has(name)) {
      return { state: 'invalid', markers: [], sessions: [] };
    }
    seen.add(name);
    (match[1] === 'b' ? markers : sessions).push({ name, hash: digest(secret) });
    if (markers.length > MAX_BROWSER_COOKIES || sessions.length > MAX_SESSION_COOKIES) {
      return { state: 'invalid', markers: [], sessions: [] };
    }
  }
  return { state: 'parsed', markers, sessions };
}

export function createPrivateSessionRepository({ rpc, cipher, generateSecret = () => randomBytes(32).toString('base64url') }) {
  if (typeof rpc !== 'function' || !cipher?.encrypt || !cipher?.decrypt) throw unavailable();
  async function call(name, args) {
    try {
      const result = await rpc(name, args);
      if (result?.error || !result?.data || typeof result.data !== 'object') throw unavailable();
      return result.data;
    } catch { throw unavailable(); }
  }
  function newSecret() {
    const secret = generateSecret();
    if (!secretPattern.test(secret || '')) throw unavailable();
    return secret;
  }
  function selected(header, needSession) {
    const parsed = parsePrivateSessionCookies(header);
    if (parsed.state !== 'parsed') return { state: 'invalid' };
    // Stage 3's HTTP boundary must implement the complete version-selection
    // protocol. Until then, ambiguous cookie collections cannot authorize.
    const validSessionCount = needSession === 'optional'
      ? parsed.sessions.length <= 1 : parsed.sessions.length === (needSession ? 1 : 0);
    if (parsed.markers.length !== 1 || !validSessionCount) {
      return { state: 'ambiguous' };
    }
    return { state: 'selected', marker: parsed.markers[0], session: parsed.sessions[0] };
  }
  async function issueBinding() {
    const secret = newSecret();
    const result = await call('plannix_auth_issue_binding', { target_hash: digest(secret) });
    if (result.state !== 'issued' || !cookieName.test(result.name)
      || !result.name.startsWith(BROWSER_COOKIE_PREFIX)) return { state: result.state || 'unavailable' };
    return { state: 'issued', setCookie: `${result.name}=${secret}; ${cookieSuffix}` };
  }
  async function begin(header, kind = 'ordinary') {
    if (!['ordinary', 'recovery'].includes(kind)) return { state: 'invalid' };
    const input = selected(header, 'optional');
    if (input.state !== 'selected') return input;
    return call('plannix_auth_begin', { marker_name: input.marker.name,
      provided_marker_hash: input.marker.hash, target_kind: kind,
      session_name: input.session?.name ?? null,
      provided_session_hash: input.session?.hash ?? null });
  }
  async function settle(intentId, outcome, { confirmedOwnerId, accessToken, refreshToken } = {}) {
    if (!['created', 'failed', 'cancelled', 'expired'].includes(outcome)) return { state: 'invalid' };
    let secret; let access; let refresh; let actualOutcome = outcome;
    if (outcome === 'created') {
      try {
        secret = newSecret();
        access = cipher.encrypt({ sessionId: intentId, purpose: 'access', version: 1, token: accessToken });
        refresh = cipher.encrypt({ sessionId: intentId, purpose: 'refresh', version: 1, token: refreshToken });
      } catch { actualOutcome = 'failed'; }
    }
    const result = await call('plannix_auth_settle', { target_intent: intentId, outcome: actualOutcome,
      confirmed_owner: actualOutcome === 'created' ? confirmedOwnerId : null,
      target_hash: secret ? digest(secret) : null,
      access_cipher: access || null, refresh_cipher: refresh || null });
    if (result.state !== 'created') return result;
    const prefix = result.kind === 'recovery' ? RECOVERY_COOKIE_PREFIX : SESSION_COOKIE_PREFIX;
    if (!Number.isSafeInteger(result.generation) || result.generation < 1 || !secret) throw unavailable();
    return { state: 'created', generation: result.generation, kind: result.kind,
      setCookie: `${prefix}${result.generation}=${secret}; ${cookieSuffix}` };
  }
  async function inspect(header, kind = 'ordinary') {
    if (!['ordinary', 'recovery'].includes(kind)) return { state: 'invalid' };
    const input = selected(header, true);
    if (input.state !== 'selected') return input;
    const result = await call('plannix_auth_inspect', {
      marker_name: input.marker.name, provided_marker_hash: input.marker.hash,
      session_name: input.session.name, session_hash: input.session.hash, expected_kind: kind,
    });
    if (result.state !== 'current') return result;
    const { accessEnvelope, refreshEnvelope, ...publicResult } = result;
    return publicResult;
  }
  async function readTokens(header, kind = 'ordinary') {
    const input = selected(header, true);
    if (input.state !== 'selected') return input;
    const result = await call('plannix_auth_inspect', {
      marker_name: input.marker.name, provided_marker_hash: input.marker.hash,
      session_name: input.session.name, session_hash: input.session.hash, expected_kind: kind,
    });
    if (result.state !== 'current') return result;
    try {
      return { state: 'current', ownerId: result.ownerId, sessionId: result.sessionId,
        tokenVersion: result.tokenVersion,
        accessToken: cipher.decrypt({ sessionId: result.sessionId, purpose: 'access',
          version: result.tokenVersion, envelope: result.accessEnvelope }),
        refreshToken: cipher.decrypt({ sessionId: result.sessionId, purpose: 'refresh',
          version: result.tokenVersion, envelope: result.refreshEnvelope }) };
    } catch { throw unavailable(); }
  }
  async function logout(header) {
    const input = selected(header, true);
    if (input.state !== 'selected') return input;
    return call('plannix_auth_logout', { marker_name: input.marker.name,
      marker_hash: input.marker.hash, session_name: input.session.name,
      session_hash: input.session.hash });
  }
  async function refresh(header, { confirmedOwnerId, expectedVersion, accessToken, refreshToken }) {
    const input = selected(header, true);
    if (input.state !== 'selected') return input;
    const current = await inspect(header);
    if (current.state !== 'current' || current.ownerId !== confirmedOwnerId
      || current.tokenVersion !== expectedVersion) return { state: 'rejected' };
    let access; let refreshCipher;
    try {
      access = cipher.encrypt({ sessionId: current.sessionId, purpose: 'access',
        version: expectedVersion + 1, token: accessToken });
      refreshCipher = cipher.encrypt({ sessionId: current.sessionId, purpose: 'refresh',
        version: expectedVersion + 1, token: refreshToken });
    } catch { throw unavailable(); }
    return call('plannix_auth_refresh', { marker_name: input.marker.name,
      marker_hash: input.marker.hash, session_name: input.session.name,
      session_hash: input.session.hash, confirmed_owner: confirmedOwnerId,
      expected_version: expectedVersion, access_cipher: access, refresh_cipher: refreshCipher });
  }
  return Object.freeze({ issueBinding, begin, settle, inspect, readTokens, logout, refresh });
}
