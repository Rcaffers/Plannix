import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { buildMorningSummary } from '../../src/utils/morningSummary.js';
import { createMorningSummaryDelivery } from '../morningSummary/delivery.js';
import { createMorningSummaryDetailService } from '../morningSummary/detail.js';

const script = readFileSync(new URL('../../public/push-sw.js', import.meta.url), 'utf8');
const consoleScript = readFileSync(new URL('../../docs/notification-worker-capability-check.md', import.meta.url), 'utf8')
  .match(/```js\n([\s\S]*?)\n```/)[1];
function worker(features = {}) {
  const listeners = new Map(); const notifications = []; const opened = [];
  const self = { location: { origin: 'https://plannix.example.test' },
    addEventListener: (name, handler) => listeners.set(name, handler),
    registration: { showNotification: async (...args) => notifications.push(args) },
    clients: { matchAll: async () => [], openWindow: async url => opened.push(url) },
    ...features };
  vm.runInNewContext(script, { self, URL, AbortController, setTimeout, clearTimeout });
  return { listeners, notifications, opened };
}
test('capability diagnostic reads only worker API presence and returns four booleans', () => {
  let subscriptionReads = 0; let storageReads = 0;
  const w = worker({
    navigator: { locks: { request() {} } },
    indexedDB: { open() { storageReads++; } },
    crypto: { subtle: { digest() {} } },
    registration: { showNotification() { throw Error('displayed'); },
      pushManager: { getSubscription() { subscriptionReads++; } } },
  });
  const replies = [];
  w.listeners.get('message')({
    data: { type: 'plannix-worker-capabilities', version: 1, secret: 'not echoed' },
    source: { type: 'window', url: 'https://plannix.example.test/settings/notifications?private=value' },
    ports: [{ postMessage: reply => replies.push(reply) }],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(replies)), [{
    webLocks: true, indexedDB: true, cryptoSubtle: true, pushSubscriptionAccess: true,
  }]);
  assert.equal(subscriptionReads, 0);
  assert.equal(storageReads, 0);
  assert.equal(w.notifications.length, 0);
  const absent = worker();
  const absentReplies = [];
  absent.listeners.get('message')({ data: { type: 'plannix-worker-capabilities', version: 1 },
    source: { type: 'window', url: 'https://plannix.example.test/' },
    ports: [{ postMessage: reply => absentReplies.push(reply) }] });
  assert.deepEqual(JSON.parse(JSON.stringify(absentReplies)), [{
    webLocks: false, indexedDB: false, cryptoSubtle: false, pushSubscriptionAccess: false,
  }]);
});
test('capability diagnostic ignores missing ports and non-origin or non-window clients', () => {
  const w = worker(); const replies = [];
  const send = (source, ports = [{ postMessage: reply => replies.push(reply) }], version = 1) =>
    w.listeners.get('message')({ data: { type: 'plannix-worker-capabilities', version }, source, ports });
  send({ type: 'window', url: 'https://plannix.example.test/' }, []);
  send({ type: 'window', url: 'https://plannix.example.test/' }, [{ postMessage() {} }, { postMessage() {} }]);
  send({ type: 'window', url: 'https://other.example.test/' });
  send({ type: 'worker', url: 'https://plannix.example.test/' });
  send({ type: 'window', url: 'not a URL' });
  send(null);
  send({ type: 'window', url: 'https://plannix.example.test/' }, undefined, 2);
  assert.equal(replies.length, 0);
  assert.doesNotThrow(() => w.listeners.get('message')({
    data: { type: 'plannix-worker-capabilities', version: 1 },
    source: { type: 'window', url: 'https://plannix.example.test/' },
    ports: [{ postMessage() { throw Error('closed port'); } }],
  }));
  assert.equal(w.notifications.length, 0);
});
test('copyable Console probe reports an unanswered worker as unverified and ignores late registration', async () => {
  let resolveRegistration; let expire; let postCount = 0;
  const registration = new Promise(resolve => { resolveRegistration = resolve; });
  const output = [];
  class Channel {
    constructor() {
      this.port1 = { close() {} };
      this.port2 = { close() {} };
    }
  }
  vm.runInNewContext(consoleScript, {
    navigator: { serviceWorker: { getRegistration: () => registration } },
    MessageChannel: Channel,
    setTimeout: callback => { expire = callback; return 1; },
    clearTimeout() {},
    console: { log: value => output.push(value) },
  });
  expire();
  assert.deepEqual(JSON.parse(JSON.stringify(output)), [{ verified: false }]);
  resolveRegistration({ active: { postMessage() { postCount++; } } });
  await registration;
  await Promise.resolve();
  assert.equal(postCount, 0);
  assert.equal(output.length, 1);
});
test('copyable Console probe accepts only the four worker booleans', async () => {
  const output = []; let channel;
  class Channel {
    constructor() {
      this.port1 = { close() {}, onmessage: null };
      this.port2 = { close() {} };
      channel = this;
    }
  }
  vm.runInNewContext(consoleScript, {
    navigator: { serviceWorker: { getRegistration: async () => ({ active: {
      postMessage(message, ports) {
        assert.deepEqual(JSON.parse(JSON.stringify(message)),
          { type: 'plannix-worker-capabilities', version: 1 });
        assert.equal(ports[0], channel.port2);
        channel.port1.onmessage({ data: { webLocks: true, indexedDB: true,
          cryptoSubtle: false, pushSubscriptionAccess: true } });
      },
    } }) } },
    MessageChannel: Channel,
    setTimeout: () => 1,
    clearTimeout() {},
    console: { log: value => output.push(value) },
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(JSON.parse(JSON.stringify(output)), [{ webLocks: true,
    indexedDB: true, cryptoSubtle: false, pushSubscriptionAccess: true }]);
});
test('worker ignores malformed or unapproved payloads and displays only generic test content', async () => {
  const w = worker(); const jobs = [];
  for (const payload of [{ type: 'other', version: 1, title: 'private' }, { type: 'plannix-test', version: 1, url: 'https://evil.test' }, { type: 'plannix-test', version: 1 }]) {
    w.listeners.get('push')({ data: { json: () => payload }, waitUntil: job => jobs.push(job) });
  }
  await Promise.all(jobs);
  assert.equal(w.notifications.length, 1);
  assert.equal(w.notifications[0][0], 'Plannix test notification');
  assert.doesNotMatch(JSON.stringify(w.notifications), /private|evil/);
});
test('click opens only same-origin notification settings and ignores notification-supplied URL', async () => {
  const w = worker(); let closed = false; let job;
  w.listeners.get('notificationclick')({ notification: { data: { url: 'https://evil.test' }, close: () => { closed = true; } }, waitUntil: value => { job = value; } });
  await job;
  assert.equal(closed, true);
  assert.deepEqual(w.opened, ['https://plannix.example.test/settings/notifications']);
});
test('click focuses an existing same-origin page and falls back if navigation fails', async () => {
  const w = worker(); let focused = 0; let job;
  const client = { url: 'https://plannix.example.test/timetable', navigate: async url => {
    assert.equal(url, 'https://plannix.example.test/settings/notifications');
    return { focus: async () => { focused++; } };
  } };
  const context = { self: { location: { origin: 'https://plannix.example.test' }, addEventListener: (name, handler) => w.listeners.set(name, handler),
    clients: { matchAll: async () => [client], openWindow: async url => w.opened.push(url) } },
    URL, AbortController, setTimeout, clearTimeout };
  vm.runInNewContext(script, context);
  w.listeners.get('notificationclick')({ notification: { close() {} }, waitUntil: value => { job = value; } });
  await job;
  assert.equal(focused, 1);
  assert.equal(w.opened.length, 0);
  client.navigate = async () => { throw Error('closed tab'); };
  w.listeners.get('notificationclick')({ notification: { close() {} }, waitUntil: value => { job = value; } });
  await job;
  assert.deepEqual(w.opened, ['https://plannix.example.test/settings/notifications']);
});

test('versioned summary payload opens only a locally constructed authenticated day link', async () => {
  const w = worker(); let job;
  const notificationRef = 'cb000000-0000-4000-8000-000000000010';
  const payload = { type: 'plannix-morning-summary', version: 1, notificationRef,
    title: 'Your Plannix day', body: 'Open Plannix to view your morning summary.' };
  w.listeners.get('push')({ data: { json: () => payload }, waitUntil: value => { job = value; } });
  await job;
  assert.equal(w.notifications[0][0], 'Your Plannix day');
  assert.equal(w.notifications[0][1].body, 'Open Plannix to view your morning summary.');
  w.listeners.get('notificationclick')({ notification: { data: w.notifications[0][1].data, close() {} },
    waitUntil: value => { job = value; } });
  await job;
  assert.equal(w.opened[0], `https://plannix.example.test/settings/notifications?summaryRef=${notificationRef}`);
  for (const invalid of [{ ...payload, date: '2026-10-05' }, { ...payload, path: 'https://evil.test' },
    { ...payload, notificationRef: 'invalid' }, { ...payload, body: 'P1 7A: Fractions' },
    { ...payload, title: 'Private lesson' }]) {
    w.listeners.get('push')({ data: { json: () => invalid }, waitUntil: () => { throw Error('invalid push accepted'); } });
  }
  assert.equal(w.notifications.length, 1);
});

function detailFixture({ fetchImpl, showImpl, locks, timerImpl = setTimeout } = {}) {
  const listeners = new Map();
  const shown = [];
  const selector = { sessionName:'__Host-plannix-s-2',
    installationVersion:'cf000000-0000-4000-8000-000000000001',
    policyVersion:'cf000000-0000-4000-8000-000000000002' };
  let state = {epoch:1,selector};
  const database = { close() {}, transaction() {
    const tx = {objectStore: () => ({
      get() {
        const request = {result:state};
        queueMicrotask(() => { request.onsuccess(); queueMicrotask(() => tx.oncomplete()); });
        return request;
      }, put(next) { state = next; },
    })};
    return tx;
  }};
  const indexedDB = {open() {
    const request = {result:database};
    queueMicrotask(() => request.onsuccess());
    return request;
  }};
  const self = { location:{origin:'https://plannix.example.test'}, crypto:webcrypto,
    navigator:{locks:locks || {request:async (_name,_options,task) => task({})}},
    fetch:fetchImpl || (async input => {
      const path = new URL(input).pathname;
      if (path.endsWith('detail-display-config')) return Response.json({enabled:true});
      if (path.endsWith('/status')) return Response.json({authenticated:true,
        sessionName:selector.sessionName});
      return Response.json({date:'2026-11-03',week:'A',lessons:[{period:'P1',
        className:'Synthetic class',title:'Synthetic lesson',isPpa:false}],
        events:[],eventTitlesIncluded:false});
    }),
    addEventListener:(name,handler) => listeners.set(name,handler),
    registration:{pushManager:{getSubscription:async () => ({endpoint:'https://push.example.test/device'})},
      showNotification:async (...args) => {
        shown.push(args);
        if (showImpl) return showImpl(...args);
      }},
    clients:{matchAll:async () => [],openWindow:async () => {}},
  };
  vm.runInNewContext(script,{self,URL,indexedDB,AbortController,setTimeout:timerImpl,clearTimeout,
    TextEncoder,TextDecoder,Uint8Array,Response,Number,queueMicrotask});
  const payload = {type:'plannix-morning-summary',version:1,
    notificationRef:'cf000000-0000-4000-8000-000000000003',
    title:'Your Plannix day',body:'Open Plannix to view your morning summary.'};
  return {shown,payload,listeners,state:() => state,setState:value => { state=value; },
    deliver() { let job; listeners.get('push')({data:{json:() => payload},waitUntil:value => {job=value;}}); return job; }};
}

test('worker uses fresh session and authorization before one detailed display', async () => {
  const paths = [];
  const h = detailFixture({fetchImpl:async (input,init) => {
    const path = new URL(input).pathname;
    paths.push([path,init.headers]);
    if (path.endsWith('detail-display-config')) return Response.json({enabled:true});
    if (path.endsWith('/status')) return Response.json({authenticated:true,
      sessionName:'__Host-plannix-s-2'});
    return Response.json({date:'2026-11-03',week:'A',lessons:[{period:'P1',
      className:'Synthetic class',title:'Synthetic lesson',isPpa:false}],
      events:[{title:'Private event'}],eventTitlesIncluded:true});
  }});
  await h.deliver();
  assert.equal(h.shown.length,1);
  assert.match(h.shown[0][1].body,/Synthetic lesson/);
  assert.match(h.shown[0][1].body,/Private event/);
  assert.equal(paths.length,3);
  assert.equal(paths[2][1]['X-Plannix-Expected-Session'],'__Host-plannix-s-2');
  assert.equal(h.state().selector.sessionName,'__Host-plannix-s-2');
});

test('real summary, detail service and worker display ordinary lessons and PPA without unconsented events', async () => {
  const userId = 'cf000000-0000-4000-8000-000000000011';
  const sessionId = 'cf000000-0000-4000-8000-000000000012';
  const yearId = 'cf000000-0000-4000-8000-000000000013';
  const weekId = 'cf000000-0000-4000-8000-000000000014';
  const date = '2026-11-02';
  const snapshot = {
    date, year: { id:yearId, startDate:'2026-09-01', endDate:'2027-07-31', holidays:[] },
    dated: { weekStartDate:date, repeatingWeekId:weekId, sessions:[
      { day:0, periodId:'one', classId:'class-a', title:'Fractions' },
      { day:0, periodId:'three', classId:'class-a', title:'Geometry' },
    ] },
    periods: [
      { id:'one', type:'teaching', order:1, startTime:'09:00', endTime:'10:00' },
      { id:'two', type:'teaching', order:2, startTime:'10:15', endTime:'11:15' },
      { id:'three', type:'teaching', order:3, startTime:'11:30', endTime:'12:30' },
    ],
    classes:[{ id:'class-a', name:'Synthetic class' }], weeks:[{ id:weekId, code:'A' }],
    events:[{ id:'event-a', date, title:'Synthetic event', startTime:null, endTime:null }],
  };
  const canonical = buildMorningSummary(snapshot);
  assert.deepEqual(canonical.lessons.map(lesson => [lesson.period, lesson.className, lesson.isPpa]), [
    ['P1','Synthetic class',false], ['P2',null,true], ['P3','Synthetic class',false],
  ]);
  const config = { supabaseUrl:'https://example.test', supabaseSecretKey:'synthetic',
    morningSummaryPilotUserId:userId };
  const delivery = createMorningSummaryDelivery({ config, createClientImpl:() => ({
    rpc:async name => {
      assert.equal(name,'plannix_morning_summary_notification_snapshot');
      return { data:snapshot, error:null };
    },
  }) });
  let authorizations = 0; let detailResponse;
  const detail = createMorningSummaryDetailService({ config, delivery,
    createClientImpl:() => ({ rpc:async name => {
      assert.equal(name,'plannix_authorize_morning_summary_detail_v2');
      authorizations++;
      return { data:{ ownerId:userId, eventTitleConsent:false }, error:null };
    } }),
  });
  const h = detailFixture({ fetchImpl:async (input, init) => {
    const path = new URL(input).pathname;
    if (path.endsWith('detail-display-config')) return Response.json({ enabled:true });
    if (path.endsWith('/status')) return Response.json({ authenticated:true,
      sessionName:'__Host-plannix-s-2' });
    detailResponse = await detail.resolve({ userId, sessionId,
      endpointHash:init.headers['X-Plannix-Installation-Hash'],
      installationVersion:init.headers['X-Plannix-Installation-Version'],
      detailPolicyVersion:init.headers['X-Plannix-Detail-Policy-Version'],
      notificationRef:init.headers['X-Plannix-Notification-Reference'] });
    return Response.json(detailResponse);
  } });
  await h.deliver();
  assert.equal(authorizations,2);
  assert.deepEqual(detailResponse.lessons, canonical.lessons.map(lesson => ({
    period:lesson.period, className:lesson.className, title:lesson.title, isPpa:lesson.isPpa,
  })));
  assert.deepEqual(detailResponse.events, []);
  assert.equal(detailResponse.eventTitlesIncluded,false);
  assert.equal(h.shown.length,1);
  assert.equal(h.shown[0][0],'Your Plannix day');
  assert.equal(h.shown[0][1].body,
    'P1: Synthetic class — Fractions · P2: PPA · P3: Synthetic class — Geometry');
  assert.doesNotMatch(JSON.stringify(h.shown),/Synthetic event/);
});

test('malformed detail shapes remain generic and never display their text', async () => {
  const ordinary = { period:'P1', className:'Synthetic class', title:'Private lesson', isPpa:false };
  const invalid = [
    { lessons:[{ ...ordinary, period:1 }] },
    { lessons:[{ ...ordinary, period:'P0' }] },
    { lessons:[{ ...ordinary, period:'P1\n' }] },
    { lessons:[{ ...ordinary, className:null }] },
    { lessons:[{ period:'P1', className:'Synthetic class', title:'', isPpa:true }] },
    { lessons:[{ period:'P1', className:null, title:'Private lesson', isPpa:true }] },
    { lessons:[ordinary], events:[{ title:'Private event' }] },
  ];
  for (const change of invalid) {
    const response = { date:'2026-11-02', week:'A', lessons:[ordinary],
      events:[], eventTitlesIncluded:false, ...change };
    const h = detailFixture({ fetchImpl:async input => {
      const path = new URL(input).pathname;
      if (path.endsWith('detail-display-config')) return Response.json({ enabled:true });
      if (path.endsWith('/status')) return Response.json({ authenticated:true,
        sessionName:'__Host-plannix-s-2' });
      return Response.json(response);
    } });
    await h.deliver();
    assert.equal(h.shown.length,1);
    assert.equal(h.shown[0][1].body,h.payload.body);
    assert.doesNotMatch(JSON.stringify(h.shown),/Private lesson|Private event/);
  }
});

test('network failure and stale selector fall back once before display', async () => {
  const failed = detailFixture({fetchImpl:async () => {throw new Error('offline');}});
  await failed.deliver();
  assert.equal(failed.shown.length,1);
  assert.equal(failed.shown[0][1].body,failed.payload.body);
  const stale = detailFixture();
  stale.setState({epoch:2,selector:null});
  await stale.deliver();
  assert.equal(stale.shown.length,1);
  assert.equal(stale.shown[0][1].body,stale.payload.body);
});

test('unsupported worker locks, changed session and pre-display timeout use generic once', async () => {
  const unsupported=detailFixture({locks:{}});
  await unsupported.deliver();
  assert.equal(unsupported.shown.length,1);
  assert.equal(unsupported.shown[0][1].body,unsupported.payload.body);
  const switched=detailFixture({fetchImpl:async input => new URL(input).pathname.endsWith('/status')
    ? Response.json({authenticated:true,sessionName:'__Host-plannix-s-3'})
    : Response.json({enabled:true})});
  await switched.deliver();
  assert.equal(switched.shown.length,1);
  assert.equal(switched.shown[0][1].body,switched.payload.body);
  const timeout=detailFixture({fetchImpl:async () => new Promise(() => {}),
    timerImpl:callback => setTimeout(callback,10)});
  await timeout.deliver();
  assert.equal(timeout.shown.length,1);
  assert.equal(timeout.shown[0][1].body,timeout.payload.body);
});

test('a rejected or unsettled display attempt never starts a generic second display', async () => {
  const failed = detailFixture({showImpl:async () => {throw new Error('OS rejected');}});
  await failed.deliver();
  assert.equal(failed.shown.length,1);
  const pending = detailFixture({showImpl:() => new Promise(() => {})});
  await pending.deliver();
  assert.equal(pending.shown.length,1);
  assert.notEqual(pending.shown[0][1].body,pending.payload.body);
});
