import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSessionTransitionModel, COOKIE_LIFETIME_SECONDS, TRANSITION_LIFETIME_MS,
  MAX_SESSION_COOKIES, MAX_BROWSER_FAMILIES, MAX_COOKIE_HEADER_BYTES,
} from './sessionTransitions.js';

const pair = result => result.setCookies[0].split(';', 1)[0];
const join = (...pairs) => pairs.filter(Boolean).join('; ');
const marker = model => {
  const result = model.bootstrap('');
  assert.equal(result.state, 'issued');
  return pair(result);
};
const login = (model, browser, owner, kind = 'ordinary') => {
  const started = model.begin(browser, kind);
  assert.equal(started.state, 'started');
  const result = model.finish(started.intent, owner);
  assert.equal(result.state, 'created');
  return result;
};

test('latest begun transition wins, including concurrent first logins', () => {
  const model = createSessionTransitionModel();
  const browser = marker(model);
  const first = model.begin(browser);
  const second = model.begin(browser);
  const b = model.finish(second.intent, 'account-B');
  assert.equal(model.finish(first.intent, 'account-A').state, 'superseded');
  assert.equal(model.inspect(join(browser, pair(b))).ownerId, 'account-B');
  assert.equal(model.finish(second.intent, 'account-C').state, 'already-settled');
  assert.equal(model.inspect(join(browser, pair(b))).ownerId, 'account-B');
});

test('failure, cancellation and expiry preserve the prior valid session without reviving older attempts', () => {
  let clock = 1_000;
  const model = createSessionTransitionModel({ now: () => clock });
  const browser = marker(model);
  const a = login(model, browser, 'account-A');
  const aHeader = join(browser, pair(a));
  const older = model.begin(aHeader);
  const newer = model.begin(aHeader);
  assert.equal(model.fail(newer.intent).state, 'failed');
  assert.equal(model.fail(newer.intent).state, 'failed');
  assert.equal(model.finish(older.intent, 'account-X').state, 'superseded');
  assert.equal(model.inspect(aHeader).ownerId, 'account-A');

  const cancelled = model.begin(aHeader);
  assert.equal(model.cancel(cancelled.intent).state, 'cancelled');
  assert.equal(model.finish(cancelled.intent, 'account-X').state, 'cancelled');
  assert.equal(model.inspect(aHeader).ownerId, 'account-A');

  const expired = model.begin(aHeader);
  clock += TRANSITION_LIFETIME_MS;
  assert.equal(model.finish(expired.intent, 'account-X').state, 'expired');
  assert.equal(model.expire(expired.intent).state, 'expired');
  assert.equal(model.inspect(aHeader).ownerId, 'account-A');
});

test('invalid or throwing secret generation cannot revoke the existing session', () => {
  let issued = 0;
  const model = createSessionTransitionModel({ random: () => {
    issued += 1;
    if (issued === 3) return 'invalid';
    if (issued === 4) throw new Error('synthetic source failure');
    return 'a'.repeat(42) + String(issued);
  } });
  const browser = marker(model);
  const a = login(model, browser, 'account-A');
  const current = join(browser, pair(a));
  for (const expected of [3, 4]) {
    assert.equal(model.finish(model.begin(current).intent, 'account-B').state, 'failed');
    assert.equal(model.inspect(current).ownerId, 'account-A', `secret attempt ${expected}`);
  }
});

test('late logout and reversed login cookies never select the older owner', () => {
  const model = createSessionTransitionModel();
  const browser = marker(model);
  const a = login(model, browser, 'account-A');
  const b = login(model, join(browser, pair(a)), 'account-B');
  const late = model.logout(join(browser, pair(a)));
  assert.equal(late.state, 'absent');
  assert.equal(late.setCookies.length, 1);
  assert.match(late.setCookies[0], new RegExp(`^${pair(a).split('=')[0]}=; Max-Age=0;`));
  const selected = model.inspect(join(browser, pair(b), pair(a)));
  assert.equal(selected.ownerId, 'account-B');
  assert.equal(selected.cleanup.length, 1);
});

test('server-issued markers resist forgery and isolate independent browser families', () => {
  const model = createSessionTransitionModel();
  const browserA = marker(model);
  const browserB = marker(model);
  assert.notEqual(browserA, browserB);
  const a = login(model, browserA, 'account-A');
  const b = login(model, browserB, 'account-B');
  assert.equal(model.inspect(join(browserA, pair(a))).ownerId, 'account-A');
  assert.equal(model.inspect(join(browserB, pair(b))).ownerId, 'account-B');
  const forged = browserA.replace(/=.+$/, `=${'z'.repeat(43)}`);
  assert.equal(model.begin(forged).state, 'invalid');
  assert.equal(model.inspect(join(browserA, pair(a))).ownerId, 'account-A');
  assert.equal(model.inspect(join(browserB, pair(b))).ownerId, 'account-B');
  assert.equal(model.begin('synthetic-client-family-id').state, 'invalid');
});

test('concurrent bootstrap responses use versioned marker names; reversed arrival cannot select older binding', () => {
  const model = createSessionTransitionModel();
  const older = marker(model);
  const newer = marker(model);
  const b = login(model, newer, 'account-B');
  const result = model.inspect(join(newer, pair(b), older));
  assert.equal(result.ownerId, 'account-B');
  assert.equal(result.cleanup.length, 1);
  assert.match(result.cleanup[0], new RegExp(`^${older.split('=')[0]}=; Max-Age=0;`));
  const rejectedOldMarker = model.bootstrap(join(older, newer));
  assert.equal(rejectedOldMarker.state, 'invalid');
  assert.equal(rejectedOldMarker.setCookies.length, 1);
  assert.match(rejectedOldMarker.setCookies[0], new RegExp(`^${older.split('=')[0]}=; Max-Age=0;`));
  assert.equal(model.inspect(join(newer, pair(b))).ownerId, 'account-B');
});

test('missing, duplicate, forged and expired markers fail closed with exact-name cleanup', () => {
  let clock = 1_000;
  const model = createSessionTransitionModel({ now: () => clock });
  assert.equal(model.begin('').state, 'missing');
  const browser = marker(model);
  assert.equal(model.begin(join(browser, browser)).state, 'invalid');
  assert.deepEqual(model.bootstrap(join(browser, browser)).setCookies, []);
  assert.equal(model.begin(`${browser.split('=')[0]}=${'z'.repeat(43)}`).state, 'invalid');
  clock += COOKIE_LIFETIME_SECONDS * 1000;
  const expired = model.bootstrap(browser);
  assert.equal(expired.state, 'expired');
  assert.equal(expired.setCookies.length, 1);
  assert.equal(model.bootstrap('').state, 'issued');
});

test('a marker expiring during identity-provider work cannot commit a session', () => {
  let clock = 1_000;
  const model = createSessionTransitionModel({ now: () => clock });
  const browser = marker(model);
  clock += COOKIE_LIFETIME_SECONDS * 1000 - 1;
  const started = model.begin(browser);
  assert.equal(started.state, 'started');
  clock += 1;
  assert.equal(model.finish(started.intent, 'account-A').state, 'expired');
  // Do not inspect at the expiry time: finish itself must make the marker
  // terminal before a backward clock movement.
  clock -= 1;
  assert.equal(model.begin(browser).state, 'expired');
  assert.equal(model.inspect(browser).state, 'expired');
  assert.equal(model.bootstrap(browser).state, 'expired');
  assert.equal(model.refresh(browser, 'account-A').state, 'rejected');
  assert.notEqual(model.logout(browser).state, 'revoked');
  assert.equal(model.revokeExact(browser, started.intent.generation), false);
  assert.equal(model.cancel(started.intent).state, 'expired');
  assert.equal(model.fail(started.intent).state, 'expired');
});

test('begin, refresh, cancel and fail independently make observed marker expiry terminal', () => {
  for (const operation of ['begin', 'refresh', 'cancel', 'fail']) {
    let clock = 1_000;
    const model = createSessionTransitionModel({ now: () => clock });
    const browser = marker(model);
    const session = login(model, browser, 'account-A');
    const header = join(browser, pair(session));
    const pending = model.begin(header);
    clock += COOKIE_LIFETIME_SECONDS * 1000;
    if (operation === 'begin') assert.equal(model.begin(header).state, 'expired');
    if (operation === 'refresh') assert.equal(model.refresh(header, 'account-A').state, 'rejected');
    if (operation === 'cancel') assert.equal(model.cancel(pending.intent).state, 'expired');
    if (operation === 'fail') assert.equal(model.fail(pending.intent).state, 'expired');
    clock -= 1;
    assert.notEqual(model.inspect(header).state, 'current', operation);
    assert.equal(model.begin(header).state, 'expired', operation);
    assert.equal(model.finish(pending.intent, 'account-B').state, 'expired', operation);
  }
});

test('expiry during replacement-secret generation is rechecked before commit', () => {
  let clock = 1_000;
  let draws = 0;
  const model = createSessionTransitionModel({ now: () => clock, random: () => {
    draws += 1;
    if (draws === 2) clock = 1_000 + COOKIE_LIFETIME_SECONDS * 1000;
    return 'a'.repeat(42) + String(draws);
  } });
  const browser = marker(model);
  clock = 1_000 + COOKIE_LIFETIME_SECONDS * 1000 - 1;
  const pending = model.begin(browser);
  assert.equal(model.finish(pending.intent, 'account-A').state, 'expired');
  clock -= 1;
  assert.equal(model.begin(browser).state, 'expired');
});

test('refresh as first observer makes verified session expiry terminal', () => {
  let clock = 1_000;
  const model = createSessionTransitionModel({ now: () => clock });
  const browser = marker(model);
  clock = 500;
  const session = login(model, browser, 'account-A');
  const header = join(browser, pair(session));
  clock = 500 + COOKIE_LIFETIME_SECONDS * 1000;
  const result = model.refresh(header, 'account-A');
  assert.equal(result.state, 'rejected');
  assert.match(result.setCookies[0], new RegExp(`^${pair(session).split('=')[0]}=; Max-Age=0;`));
  clock -= 1;
  assert.equal(model.inspect(header).state, 'absent');
  assert.equal(model.refresh(header, 'account-A').state, 'rejected');
});

test('begin, bootstrap, finish, fail and cancel independently observe session expiry', () => {
  for (const operation of ['begin', 'bootstrap', 'finish', 'fail', 'cancel']) {
    let clock = 1_000;
    const model = createSessionTransitionModel({ now: () => clock });
    const browser = marker(model);
    clock = 500;
    const session = login(model, browser, 'account-A');
    const header = join(browser, pair(session));
    clock = 500 + COOKIE_LIFETIME_SECONDS * 1000 - 1;
    const pending = ['finish', 'fail', 'cancel'].includes(operation) ? model.begin(header).intent : null;
    clock += 1;
    if (operation === 'begin') assert.equal(model.begin(header).state, 'started');
    if (operation === 'bootstrap') assert.equal(model.bootstrap(header).state, 'ready');
    if (operation === 'finish') assert.equal(model.finish(pending, '').state, 'failed');
    if (operation === 'fail') assert.equal(model.fail(pending).state, 'failed');
    if (operation === 'cancel') assert.equal(model.cancel(pending).state, 'cancelled');
    clock -= 1;
    assert.equal(model.inspect(header).state, 'absent', operation);
    assert.equal(model.refresh(header, 'account-A').state, 'rejected', operation);
  }
});

test('failure and cancellation as first observers make transition deadline expiry terminal', () => {
  for (const operation of ['fail', 'cancel']) {
    let clock = 1_000;
    const model = createSessionTransitionModel({ now: () => clock });
    const browser = marker(model);
    const pending = model.begin(browser);
    clock += TRANSITION_LIFETIME_MS;
    assert.equal(model[operation](pending.intent).state, 'expired');
    clock -= 1;
    assert.equal(model.finish(pending.intent, 'account-A').state, 'expired');
    assert.equal(model[operation](pending.intent).state, 'expired');
  }
});

test('verified marker expiry is terminal across clock rollback and refresh', () => {
  let clock = 1_000;
  const model = createSessionTransitionModel({ now: () => clock });
  const browser = marker(model);
  const session = login(model, browser, 'account-A');
  const header = join(browser, pair(session));
  clock += COOKIE_LIFETIME_SECONDS * 1000;
  const expired = model.inspect(header);
  assert.equal(expired.state, 'expired');
  assert.match(expired.cleanup[0], new RegExp(`^${browser.split('=')[0]}=; Max-Age=0;`));
  clock -= 1;
  assert.notEqual(model.inspect(header).state, 'current');
  assert.equal(model.refresh(header, 'account-A').state, 'rejected');
  const replacement = marker(model);
  const newer = login(model, replacement, 'account-B');
  assert.ok(expired.cleanup.every(cookie => !cookie.startsWith(replacement.split('=')[0] + '=')));
  assert.ok(expired.cleanup.every(cookie => !cookie.startsWith(pair(newer).split('=')[0] + '=')));
  assert.equal(model.inspect(join(replacement, pair(newer))).ownerId, 'account-B');
});

test('verified session expiry is terminal across clock rollback and cannot revive by refresh', () => {
  let clock = 1_000;
  const model = createSessionTransitionModel({ now: () => clock });
  const browser = marker(model);
  // The injected clock makes the session expire before its marker so the
  // session's own expiry path can be exercised independently.
  clock = 500;
  const session = login(model, browser, 'account-A');
  const header = join(browser, pair(session));
  clock = 500 + COOKIE_LIFETIME_SECONDS * 1000;
  const expired = model.inspect(header);
  assert.equal(expired.state, 'absent');
  assert.equal(expired.cleanup.length, 1);
  assert.match(expired.cleanup[0], new RegExp(`^${pair(session).split('=')[0]}=; Max-Age=0;`));
  clock -= 1;
  assert.equal(model.inspect(header).state, 'absent');
  assert.equal(model.refresh(header, 'account-A').state, 'rejected');
  const newer = login(model, browser, 'account-B');
  assert.ok(expired.cleanup.every(cookie => !cookie.startsWith(pair(newer).split('=')[0] + '=')));
  assert.equal(model.inspect(join(browser, pair(newer))).ownerId, 'account-B');
});

test('expired transitions cannot complete after clock rollback or alter the prior session', () => {
  let clock = 1_000;
  const model = createSessionTransitionModel({ now: () => clock });
  const browser = marker(model);
  const session = login(model, browser, 'account-A');
  const current = join(browser, pair(session));
  const pending = model.begin(current);
  clock += TRANSITION_LIFETIME_MS;
  assert.equal(model.finish(pending.intent, 'account-B').state, 'expired');
  clock -= 1;
  assert.equal(model.finish(pending.intent, 'account-B').state, 'expired');
  assert.equal(model.refresh(current, 'account-A').state, 'refreshed');
  assert.equal(model.inspect(current).ownerId, 'account-A');
});

test('forged or duplicate input cannot trigger cleanup during expiry observation', () => {
  let clock = 1_000;
  const model = createSessionTransitionModel({ now: () => clock });
  const browser = marker(model);
  const session = login(model, browser, 'account-A');
  clock += COOKIE_LIFETIME_SECONDS * 1000;
  const forgedSession = `__Host-plannix-s-999=${'z'.repeat(43)}`;
  const forgedMarker = `__Host-plannix-b-999=${'z'.repeat(43)}`;
  for (const invalid of [join(browser, pair(session), forgedSession),
    join(browser, pair(session), forgedMarker), join(browser, browser, pair(session))]) {
    const result = model.inspect(invalid);
    assert.equal(result.state, 'invalid');
    assert.deepEqual(result.cleanup, []);
  }
  clock -= 1;
  assert.equal(model.inspect(join(browser, pair(session))).ownerId, 'account-A');
  clock += 1;
  assert.equal(model.inspect(join(browser, pair(session))).state, 'expired');
});

test('refresh retains owner and absolute expiry; revoked and recovery sessions cannot authorize ordinary access', () => {
  let clock = 1_000;
  const model = createSessionTransitionModel({ now: () => clock });
  const browser = marker(model);
  const a = login(model, browser, 'account-A');
  const current = join(browser, pair(a));
  assert.equal(model.refresh(current, 'account-B').state, 'rejected');
  assert.equal(model.refresh(current, 'account-A').state, 'refreshed');
  assert.equal(model.revokeExact(current, a.generation), true);
  assert.equal(model.refresh(current, 'account-A').state, 'rejected');
  assert.equal(model.revokeExact(current, a.generation), false);

  const recovery = login(model, browser, 'account-A', 'recovery');
  assert.equal(model.inspect(join(browser, pair(recovery))).state, 'wrong-kind');
  assert.equal(model.inspect(join(browser, pair(recovery)), 'recovery').ownerId, 'account-A');
  clock += COOKIE_LIFETIME_SECONDS * 1000;
  assert.notEqual(model.inspect(join(browser, pair(recovery)), 'recovery').state, 'current');
});

test('malformed, duplicate and over-limit state rejects without clearing the authoritative cookies', () => {
  const model = createSessionTransitionModel();
  const browser = marker(model);
  const session = login(model, browser, 'account-A');
  const current = join(browser, pair(session));
  for (const invalid of [join(current, pair(session)),
    `${current}; __Host-plannix-s-0=x`,
    `${current}; __Host-plannix-s-999=${'z'.repeat(43)}`,
    `${current}; __Host-plannix-b-999=${'z'.repeat(43)}`]) {
    const rejected = model.inspect(invalid);
    assert.equal(rejected.state, 'invalid');
    assert.deepEqual(rejected.cleanup, []);
    assert.equal(model.inspect(current).ownerId, 'account-A');
  }
  const excessive = join(current, ...Array.from({ length: MAX_SESSION_COOKIES }, (_, i) =>
    `__Host-plannix-s-${i + 100}=${'z'.repeat(43)}`), 'theme=dark');
  const rejected = model.inspect(excessive);
  assert.equal(rejected.state, 'invalid');
  assert.deepEqual(rejected.cleanup, []);
  const huge = model.inspect(`${current}; theme=${'x'.repeat(MAX_COOKIE_HEADER_BYTES)}`);
  assert.equal(huge.state, 'invalid');
  assert.deepEqual(huge.cleanup, []);
  const prefix = `${current}; theme=`;
  const exactHeader = prefix + 'x'.repeat(MAX_COOKIE_HEADER_BYTES - Buffer.byteLength(prefix));
  assert.equal(Buffer.byteLength(exactHeader), MAX_COOKIE_HEADER_BYTES);
  assert.equal(model.inspect(exactHeader).ownerId, 'account-A');
  assert.deepEqual(model.inspect(`${exactHeader}x`).cleanup, []);
  assert.equal(model.inspect(current).ownerId, 'account-A');
});

test('four marker versions are accepted and a fifth fails without deleting any marker', () => {
  const model = createSessionTransitionModel();
  const markers = Array.from({ length: 5 }, () => marker(model));
  const excessive = model.inspect(join(...markers));
  assert.equal(excessive.state, 'invalid');
  assert.deepEqual(excessive.cleanup, []);
  const atLimit = model.inspect(join(...markers.slice(1)));
  assert.equal(atLimit.state, 'absent');
  assert.equal(atLimit.cleanup.length, 3);
  assert.equal(model.inspect(markers.at(-1)).state, 'absent');
});

test('only server-proven stale versions are cleared, and delayed cleanup cannot clear a newer login', () => {
  const model = createSessionTransitionModel();
  const browser = marker(model);
  const a = login(model, browser, 'account-A');
  const b = login(model, join(browser, pair(a)), 'account-B');
  const oldCleanup = model.inspect(join(browser, pair(a), pair(b))).cleanup;
  assert.equal(oldCleanup.length, 1);
  assert.match(oldCleanup[0], new RegExp(`^${pair(a).split('=')[0]}=; Max-Age=0;`));
  const c = login(model, join(browser, pair(b)), 'account-C');
  assert.ok(oldCleanup.every(cookie => !cookie.startsWith(pair(c).split('=')[0] + '=')));
  assert.equal(model.inspect(join(browser, pair(c))).ownerId, 'account-C');
  const unknown = model.inspect(join(browser, pair(c), `__Host-plannix-s-999=${'z'.repeat(43)}`));
  assert.equal(unknown.state, 'invalid');
  assert.deepEqual(unknown.cleanup, []);
});

test('retained record and family caps reject excess work rather than evict a live browser', () => {
  const model = createSessionTransitionModel();
  const browser = marker(model);
  const issued = [];
  for (let i = 0; i < MAX_SESSION_COOKIES + 1; i += 1) {
    issued.push(login(model, browser, `account-${i}`));
  }
  const old = model.inspect(join(browser, pair(issued[0]), pair(issued.at(-1))));
  assert.equal(old.state, 'invalid');
  assert.deepEqual(old.cleanup, []);
  assert.equal(model.inspect(join(browser, pair(issued.at(-1)))).ownerId, `account-${MAX_SESSION_COOKIES}`);
  for (let i = 1; i < MAX_BROWSER_FAMILIES; i += 1) marker(model);
  assert.equal(model.bootstrap('').state, 'unavailable');
});

test('session secrets and identity-provider tokens appear only in HttpOnly cookie headers', () => {
  const model = createSessionTransitionModel();
  const browser = marker(model);
  const a = login(model, browser, 'account-A');
  assert.match(a.setCookies[0], /^__Host-plannix-s-\d+=[A-Za-z0-9_-]{43}; Max-Age=2592000; Path=\/; Secure; HttpOnly; SameSite=Lax$/);
  assert.deepEqual(Object.keys(a).sort(), ['generation', 'kind', 'setCookies', 'state']);
  assert.doesNotMatch(JSON.stringify(model.inspect(join(browser, pair(a)))), /access_token|refresh_token|supabase/i);
});
