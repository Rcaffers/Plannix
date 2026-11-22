import React from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import Notifications from './Notifications.jsx';
import { restoreSetupGuidance, setupGuidancePreference } from '../utils/setupGuidance.js';
import { serverManagedAuth, invalidateServerSessionContext,
  setServerSessionContext } from '../utils/serverAuthTransport.js';
import '../styles/base.css';
import '../styles/accessibility.css';

const calls = [];
const reloadDetail = window.name === 'plannix-notification-detail-reload';
let subscribed = reloadDetail;
let supported = true;
let configEnabled = true;
let failStatus = false;
let policyEnabled = reloadDetail;
let policyNumber = 1;
let detailGate = true;
const macPolicy = {enabled:true, version:'synthetic-mac-policy'};
const policyRequests = [];
let selectorEpoch = 0;
let selector = null;
window.staleDetailBinding = false;
window.failNextDetailPolicy = false;
let lockDepth = 0;
const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic-device-token',
  toJSON: () => ({ endpoint: subscription.endpoint, keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) }, expirationTime: null }),
  unsubscribe: async () => { calls.push('unsubscribe'); subscribed = false; return true; } };
window.Notification = { permission: reloadDetail ? 'granted' : 'default', requestPermission: async () => {
  calls.push('permission');
  if (window.deferPushPermission) return new Promise(resolve => { window.releasePushPermission = () => {
    window.Notification.permission = 'granted'; resolve('granted');
  }; });
  window.Notification.permission = 'granted'; return 'granted';
} };
let workerActive = true;
const worker = { postMessage(message, ports) {
  const port=ports?.[0];
  if (message.type !== 'plannix-detail-selector' || !port) return;
  if (message.kind === 'observe') port.postMessage(window.failSelectorObservation
    ? {ok:false} : {ok:true,epoch:selectorEpoch,selector});
  else if (message.kind === 'invalidate') {
    selectorEpoch++; selector=null; port.postMessage({ok:true,epoch:selectorEpoch});
  } else if (message.kind === 'commit' && message.expectedEpoch === selectorEpoch
    && !window.failSelectorCommit) {
    selectorEpoch++; selector=message.selector; port.postMessage({ok:true,epoch:selectorEpoch,selector});
  } else port.postMessage({ok:false});
} };
worker.scriptURL = 'file:///push-sw.js';
let activeWorker = worker;
const registration = Object.assign(new EventTarget(), { waiting:null, installing:null, update:async () => {}, pushManager: {
  getSubscription: async () => subscribed ? subscription : null,
  subscribe: async () => { calls.push('subscribe'); subscribed = true; return subscription; },
} });
Object.defineProperty(registration,'active',{get:() => workerActive ? activeWorker : null});
window.showSyntheticUpdateNotice = () => {
  const waiting = new EventTarget();
  waiting.state = 'installed';
  waiting.scriptURL = 'file:///push-sw.js';
  registration.waiting = waiting;
  registration.dispatchEvent(new Event('updatefound'));
};
const serviceWorker = new EventTarget();
serviceWorker.register = async () => registration;
serviceWorker.getRegistration = async () => registration;
window.setSyntheticWorkerActive = active => {
  workerActive = active;
  if (active) serviceWorker.dispatchEvent(new Event('controllerchange'));
};
Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker });
let lockTail = Promise.resolve();
Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: (_name, _options, callback) => {
  const work = lockTail.then(async () => {
    lockDepth++;
    try { return await callback({ name: 'plannix-push-device' }); }
    finally { lockDepth--; }
  });
  lockTail = work.catch(() => {});
  return work;
} } });
export const pushSupport = () => supported;
export const vapidBytes = () => new Uint8Array([1]);
export const waitForPushAccountReconciliation = async () => {};
export const reconcilePushAccount = async () => { calls.push('reconcile'); return false; };
export const currentPushSubscription = async () => {
  if (!lockDepth) throw Error('Device subscription read occurred outside Web Lock');
  return subscribed ? subscription : null;
};
export const disableCurrentDevice = async () => {
  calls.push('remove');
  if (window.deferPushRemoval) await new Promise((resolve, reject) => {
    window.releasePushRemoval = fail => fail ? reject(Error('Synthetic removal failed')) : resolve();
  });
  subscribed = false;
};
export const pushRequest = async (path, body) => {
  calls.push(path);
  if (['status', 'register', 'test', 'detail-policy/status', 'detail-policy/set'].includes(path) && !lockDepth) throw Error('Device operation occurred outside Web Lock');
  if (path === 'config') return { configured: configEnabled, publicKey: configEnabled ? 'synthetic-public-key' : null,
    detailDisplayAvailable:serverManagedAuth && detailGate };
  if (path === 'status') { if (failStatus) throw Error('Synthetic status failure');
    if (window.holdNextPushStatus) {
      window.holdNextPushStatus=false; window.pushStatusHeld=true;
      return new Promise(resolve => { window.releaseHeldPushStatus=() => resolve({registered:false,
        version:null,boundToCurrentSession:false}); });
    }
    const registered=subscribed && !window.forceUnregisteredStatus;
    return { registered, version:registered && !window.staleDetailBinding
      ? 'ca000000-0000-4000-8000-000000000099' : null,
    boundToCurrentSession:registered && !window.staleDetailBinding }; }
  if (path === 'detail-policy/status') {
    if (window.staleDetailBinding) throw Error('Synthetic stale binding');
    if (window.holdDetailStatusAfterCommit && selector) {
      window.holdDetailStatusAfterCommit=false;
      window.detailStatusHeld=true;
      return new Promise(resolve => { window.releaseHeldDetailStatus=() => resolve({
        enabled:policyEnabled,
        policyVersion:`ca000000-0000-4000-8000-${String(policyNumber).padStart(12,'0')}`,
      }); });
    }
    const observed = {enabled:policyEnabled,policyVersion:`ca000000-0000-4000-8000-${String(policyNumber).padStart(12,'0')}`};
    if (window.rotateAfterPolicyObservation) {window.rotateAfterPolicyObservation=false;policyNumber++;}
    if (window.invalidateBindingAfterObservation) {window.invalidateBindingAfterObservation=false;window.staleDetailBinding=true;}
    return observed;
  }
  if (path === 'detail-policy/set') {
    policyRequests.push({...body});
    if (body.endpoint !== subscription.endpoint) throw Error('Wrong device selected');
    if (window.rotateNextPolicy) { window.rotateNextPolicy=false; policyNumber++; }

    if (window.failNextDetailPolicy) {window.failNextDetailPolicy=false;throw Error('Synthetic policy failure');}
    if (body.policyVersion !== `ca000000-0000-4000-8000-${String(policyNumber).padStart(12,'0')}`)
      throw Error('Synthetic stale policy version');
    policyEnabled=body.enabled; policyNumber++;
    const committed = {enabled:policyEnabled,policyVersion:`ca000000-0000-4000-8000-${String(policyNumber).padStart(12,'0')}`};
    if (window.holdNextPolicyResponse) {
      window.holdNextPolicyResponse=false; window.policyResponseHeld=true;
      await new Promise(resolve => {window.releasePolicyResponse=resolve;});
    }
    if (window.loseNextPolicyResponse) {window.loseNextPolicyResponse=false;throw Error('Synthetic lost policy response');}
    return committed;
  }
  if (path === 'observe') return { state:'absent', version:null };
  if (path === 'register') {
    if (body.subscription.expirationTime !== undefined) throw Error('Unexpected expirationTime');
    if (serverManagedAuth && body.expectedVersion !== null) throw Error('First registration omitted the observed absent version');
    if (window.deferPushRegistration) await new Promise((resolve, reject) => {
      window.releasePushRegistration = fail => fail ? reject(Error('Synthetic registration failed')) : resolve();
    });
    return serverManagedAuth ? { registered: true, version:'ca000000-0000-4000-8000-000000000099' }
      : { registered: true };
  }
  if (path === 'test') return { accepted: true };
  return { registered: false };
};

const root = createRoot(document.getElementById('root'));
if (serverManagedAuth) setServerSessionContext('__Host-plannix-s-1','synthetic-csrf',
  'ca000000-0000-4000-8000-000000000001');
function NotificationFixture() {
  const [userId, setUserId] = React.useState('ca000000-0000-4000-8000-000000000001');
  window.switchNotificationUser = next => {
    if (serverManagedAuth) {
      invalidateServerSessionContext();
      setServerSessionContext('__Host-plannix-s-2','synthetic-csrf',next);
    }
    setUserId(next);
  };
  return <Notifications userId={userId} organisationId="cb000000-0000-4000-8000-000000000011" />;
}
const router = createMemoryRouter([{ path: '/settings/notifications', element: <NotificationFixture /> },
  { path: '/settings', element: <main>Settings</main> }], { initialEntries: ['/settings/notifications'] });
root.render(<RouterProvider router={router} />);
const tick = () => new Promise(resolve => setTimeout(resolve, 25));
const waitFor = async (condition, label) => {
  for(let attempt=0;attempt<160;attempt++) { if (condition()) return; await tick(); }
  throw Error(`${label} did not settle`);
};
const button = label => [...document.querySelectorAll('button')].find(node => node.textContent === label);
if (serverManagedAuth) window.prepareDeviceRecoveryLayout = async () => {
  policyEnabled=false; selector=null;
  await router.navigate('/settings'); await tick(); await router.navigate('/settings/notifications');
  await waitFor(() => Boolean(button('Enable details on this device')
    && !button('Enable details on this device').disabled), 'recovery layout ready');
};
const clickButton = label => {
  const target = button(label);
  if (!target) throw Error(`Missing button: ${label}`);
  target.click();
};
const check = (condition, message) => { if (!condition) throw Error(message); };
const chooseDate = value => {
  const input = document.querySelector('#morning-preview-date');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
};
const chooseTime = value => {
  const input = document.querySelector('#morning-delivery-time');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
};
(async () => { try {
  if (reloadDetail) {
    await waitFor(() => document.body.textContent.includes('Lesson details enabled')
      && selector?.sessionName === '__Host-plannix-s-1'
      && Boolean(button('Disable lesson details') && button('Enable event titles')),
    'full browser reload repairs a lost local selector from current server authority');
    check(!document.body.textContent.includes('detail policy is off')
      && !document.body.textContent.includes('detail status is unverified'),
    'full reload reports the confirmed effective device state');
    window.name='';
    document.body.dataset.testResult='passed';
    return;
  }
  await tick(); await tick();
  check(!document.querySelector('.push-update-notice'), 'no update notice appears without a waiting worker');
  const deviceActions = document.querySelector('.notification-actions');
  const deviceCard = deviceActions.closest('.settings-timetable-form');
  const deviceHint = 'These controls only affect the device you’re using.';
  check(deviceActions.previousElementSibling?.textContent === deviceHint
    && [...deviceCard.querySelectorAll('p')].filter(node => node.textContent === deviceHint).length === 1,
    'device-only scope is explained once immediately above the device buttons');
  check(deviceCard.textContent.includes('A test contains no lesson details.')
    && !deviceCard.textContent.includes('Notifications are personal to this signed-in account and this device.'),
    'generic-test privacy note remains without repeating device scope');
  check(calls.includes('config') && !calls.includes('permission'), 'permission is not requested on load');
  check(document.body.textContent.includes('Morning summaries are not active yet'), 'summary preference cannot imply scheduling');
  check(document.querySelector('#morning-academic-year')?.value === 'cb000000-0000-4000-8000-000000000010'
    && document.body.textContent.includes('Saved notification year: Not confirmed'),
  'current Settings year is offered but an old preference has no confirmed delivery year');
  check(document.querySelector('#morning-preview-date')?.value, 'London preview date selector is present');
  if (serverManagedAuth) {
    check(button('Enable lesson details')?.disabled && button('Enable event titles')?.disabled
      && document.body.textContent.includes('Details disabled'),
      'both detail actions default off until the current device is bound');
    check(document.body.textContent.includes('lock screens and connected watches')
      && document.body.textContent.includes('cannot be recalled'),
    'detail risk and irreversibility are explained before consent');
  } else check(!button('Enable lesson details') && !button('Enable event titles'),
    'bearer UI keeps its established controls');
  const optIn = document.querySelector('.morning-opt-in input');
  optIn.click(); await tick();
  button('Save preferences').click(); await tick();
  if (serverManagedAuth) check(window.summaryPreferenceSaves?.at(-1)?.lessonDetailConsent === false
    && window.summaryPreferenceSaves?.at(-1)?.eventTitleConsent === false,
  'generic preferences do not grant either detail consent');
  check(window.summaryPreferenceSaves?.at(-1)?.enabled === true, 'opt-in preference reaches only the preference API');
  check(window.summaryPreferenceSaves.at(-1).academicYearId === 'cb000000-0000-4000-8000-000000000010',
    'saving explicitly confirms the notification academic year');
  check(window.summaryPreferenceSaves.at(-1).revision === 0, 'first save uses absent-row revision');
  check(document.body.textContent.includes('Morning summaries are not active yet'), 'saved opt-in still does not imply activation');
  const notificationUser = 'ca000000-0000-4000-8000-000000000001';
  restoreSetupGuidance(notificationUser);
  window.summaryPreferenceFailSave = true;
  button('Save preferences').click();
  await waitFor(() => document.body.textContent.includes('Could not save morning summary preferences'),
    'failed unchanged-value preference save');
  check(setupGuidancePreference(notificationUser, 'notifications') === 'shown'
    && !button('Save preferences').disabled,
  'failed unchanged-value save retains restored guidance and allows retry');
  const unchangedSaves = window.summaryPreferenceSaves.length;
  check(!button('Save preferences').disabled, 'loaded unchanged preferences can be confirmed again');
  button('Save preferences').click(); await tick();
  check(window.summaryPreferenceSaves.length === unchangedSaves + 1
    && setupGuidancePreference(notificationUser, 'notifications') === 'completed',
  'successful unchanged-value save clears restored notification guidance');
  chooseTime('08:20'); await tick();
  window.setSummaryPreference('ca000000-0000-4000-8000-000000000001',
    { enabled: true, deliveryTime: '06:30', revision: 3,
      academicYearId: 'cb000000-0000-4000-8000-000000000010' });
  button('Save preferences').click(); await tick();
  check(document.body.textContent.includes('Preferences changed elsewhere')
    && document.querySelector('#morning-delivery-time').value === '08:20'
    && button('Save preferences').disabled, 'conflict preserves the draft and blocks a stale retry');
  window.confirm = () => false;
  const beforeRejectedReload = window.summaryPreferenceLoads;
  button('Reload latest').click(); await tick();
  check(window.summaryPreferenceLoads === beforeRejectedReload && document.querySelector('#morning-delivery-time').value === '08:20',
    'rejected discard starts no reload and keeps edits');
  window.confirm = () => true;
  window.summaryPreferenceFailLoad = true;
  button('Reload latest').click(); await tick();
  check(document.body.textContent.includes('Could not reload preferences')
    && document.querySelector('#morning-delivery-time').value === '08:20'
    && button('Save preferences').disabled, 'failed reload preserves draft and conflict');
  window.summaryPreferenceFailLoad = false;
  window.summaryDelayPreferenceLoad = true;
  const beforePendingReload = window.summaryPreferenceLoads;
  button('Reload latest').click(); await tick();
  check(document.querySelector('#morning-delivery-time').disabled
    && document.querySelector('.morning-opt-in input').disabled
    && button('Save preferences').disabled && button('Reload latest').disabled,
  'destructive reload blocks preference edits and competing actions');
  button('Reload latest').click(); await tick();
  check(window.summaryPreferenceLoads === beforePendingReload + 1, 'repeat reload cannot start another request');
  window.releaseSummaryPreferenceLoad(); window.summaryDelayPreferenceLoad = false; await tick();
  check(document.querySelector('#morning-delivery-time').value === '06:30'
    && !document.body.textContent.includes('Preferences changed elsewhere'),
  'successful confirmed reload adopts the canonical revision');
  chooseTime('08:45'); await tick(); button('Save preferences').click(); await tick();
  check(window.summaryPreferenceSaves.at(-1).revision === 3, 'post-reload save uses current revision');
  chooseDate('2026-11-02'); await tick(); await tick();
  check(document.querySelector('.morning-preview-content')?.textContent.includes('P1 — 7A — Fractions'), 'weekday preview uses saved dated lesson');
  window.summaryFailWeek = '2026-11-23';
  chooseDate('2026-11-23'); await tick(); await tick();
  check(document.body.textContent.includes('Could not load the daily summary preview') && !document.querySelector('.morning-preview-content'),
    'failed week does not display fabricated PPA');
  window.summaryFailWeek = null; button('Retry preview').click(); await tick(); await tick();
  check(document.querySelector('.morning-preview-content')?.textContent.includes('Fractions'), 'retry loads complete preview');
  window.summaryEmptyPeriods = true;
  chooseDate('2026-11-03'); await tick(); await tick();
  check(document.body.textContent.includes('Could not load the daily summary preview')
    && !document.querySelector('.morning-preview-content'),
  'missing teaching periods never render a successful empty preview or PPA');
  window.summaryEmptyPeriods = false; button('Retry preview').click(); await tick(); await tick();
  check(document.querySelector('.morning-preview-content')?.textContent.includes('2026-11-03'),
    'complete period data restores the preview');
  window.summaryDelayWeek = '2026-11-09';
  chooseDate('2026-11-09'); await tick();
  chooseDate('2026-11-16'); await tick(); await tick();
  window.releaseSummaryWeek(true); await tick();
  check(document.querySelector('.morning-preview-content')?.textContent.includes('2026-11-16')
    && !document.body.textContent.includes('Could not load the daily summary preview'), 'late old-scope error is ignored');
  window.summaryDelayWeek = null;
  window.summaryDelayEventDate = '2026-11-10';
  chooseDate('2026-11-10'); await tick();
  const oldDateEvents = window.releaseSummaryEvents;
  window.summaryDelayEventDate = null;
  chooseDate('2026-11-17'); await tick(); await tick(); oldDateEvents(); await tick();
  check(document.querySelector('.morning-preview-content')?.textContent.includes('2026-11-17')
    && !document.querySelector('.morning-preview-content')?.textContent.includes('Late event'),
  'late successful events cannot replace a newer date');
  check(document.body.textContent.includes('Not subscribed'), 'initial device state');
  check(!button('Enable details on this device'), 'no device recovery without saved consent and binding');
  window.deferPushRegistration = true;
  check(button('Enable notifications') && !button('Disable notifications'),
    'not subscribed shows exactly the enable device action');
  button('Enable notifications').click();
  await waitFor(() => typeof window.releasePushRegistration === 'function', 'registration response held');
  check(button('Enable notifications')?.disabled
    && !button('Disable notifications') && button('Send test notification').disabled,
    'pending registration retains enable label and blocks actions before confirmation');
  const permissionCalls = calls.filter(item => item === 'permission').length;
  button('Enable notifications').click(); await tick();
  check(calls.filter(item => item === 'permission').length === permissionCalls,
    'pending device button prevents a duplicate enable');
  window.releasePushRegistration(true);
  await waitFor(() => document.body.textContent.includes('Synthetic registration failed')
    && !button('Enable notifications')?.disabled, 'failed registration settles');
  check(!button('Disable notifications') && button('Send test notification').disabled,
    'failed registration cannot report a confirmed subscription or enable test sending');
  const registrationCalls = calls.filter(item => item === 'register').length;
  await tick();
  check(calls.filter(item => item === 'register').length === registrationCalls,
    'failed registration is not automatically retried');
  window.releasePushRegistration = null;
  button('Enable notifications').click();
  await waitFor(() => typeof window.releasePushRegistration === 'function', 'explicit registration retry held');
  window.deferPushRegistration = false;
  window.releasePushRegistration(false);
  await waitFor(() => Boolean(button('Disable notifications')
    && !button('Disable notifications').disabled), 'registration confirmed');
  check(!button('Enable notifications'), 'confirmed subscription replaces enable with disable');
  check(calls.filter(item => item === 'permission').length === 2,
    'only the two explicit enable clicks request permission');
  check(calls.includes('register') && document.body.textContent.includes('Subscribed'), 'registration reaches server');
  if (serverManagedAuth) check(calls.includes('observe')
    && calls.indexOf('observe') < calls.indexOf('register'),
  'server mode observes the installation version before registration');
  if (serverManagedAuth) {
    await waitFor(() => Boolean(button('Enable event titles') && !button('Enable event titles').disabled),
      'bound detail controls');
    const consentSaves = window.summaryPreferenceSaves.length;
    const policyWrites = calls.filter(item => item === 'detail-policy/set').length;
    clickButton('Enable event titles');
    await waitFor(() => document.body.textContent.includes('Event titles enabled'),'event-only readback');
    check(window.summaryPreferenceSaves.at(-1).eventTitleConsent === true
      && window.summaryPreferenceSaves.at(-1).lessonDetailConsent === false
      && window.summaryPreferenceSaves.at(-1).deliveryTime === '08:45'
      && window.summaryPreferenceSaves.at(-1).academicYearId === 'cb000000-0000-4000-8000-000000000010'
      && window.summaryPreferenceSaves.length === consentSaves + 1
      && calls.filter(item => item === 'detail-policy/set').length === policyWrites + 1,
    'one event button action saves only event consent and enables this device without a separate Save');
    await waitFor(() => !button('Disable event titles').disabled, 'event button completion');
    chooseTime('08:50'); await tick();
    clickButton('Save preferences');
    await waitFor(() => window.summaryPreferenceSaves.at(-1).deliveryTime === '08:50', 'schedule-only save');
    check(window.summaryPreferenceSaves.at(-1).eventTitleConsent === true
      && window.summaryPreferenceSaves.at(-1).lessonDetailConsent === false,
    'general scheduling Save preserves button-granted consent');
    await waitFor(() => Boolean(button('Enable lesson details') && !button('Enable lesson details').disabled),
      'schedule save completion');
    clickButton('Enable lesson details');
    await waitFor(() => document.body.textContent.includes('Lesson details and event titles enabled'),'both-detail readback');
    // Recover an existing device without rewriting consent or changing subscriptions.
    const recoverLabel = 'Enable details on this device';
    const reloadDevice = async () => {
      await router.navigate('/settings'); await tick(); await router.navigate('/settings/notifications');
      await waitFor(() => Boolean(document.querySelector('.morning-notification-details'))
        && !document.body.textContent.includes('Checking…')
        && !document.body.textContent.includes('Checking details…'), 'device readiness load');
    };
    const preferenceCount = window.summaryPreferenceSaves.length;
    const savedAccount = JSON.stringify(window.summaryPreferenceSaves.at(-1));
    const subscriptionsBefore = calls.filter(item => ['register','remove','unsubscribe'].includes(item)).length;
    const macBefore = JSON.stringify(macPolicy);
    policyEnabled=false; selector=null; await reloadDevice();
    await waitFor(() => Boolean(button(recoverLabel) && !button(recoverLabel).disabled), 'disabled-policy recovery available');
    check(button('Disable lesson details') && button('Disable event titles'), 'recovery preserves both saved account consents');
    const recoverWrites = policyRequests.length;
    // Even an explicit status retry may only read a disabled policy.
    failStatus=true; await reloadDevice(); failStatus=false;
    await waitFor(() => Boolean(button('Retry notification status')), 'failed status offers retry');
    clickButton('Retry notification status');
    await waitFor(() => Boolean(button(recoverLabel) && !button(recoverLabel).disabled), 'read-only status retry completed');
    check(!policyEnabled && policyRequests.length === recoverWrites, 'Retry notification status never enables a disabled policy');
    chooseTime('08:55'); await tick();
    window.holdNextPolicyResponse=true; window.policyResponseHeld=false;
    clickButton(recoverLabel); clickButton(recoverLabel);
    await waitFor(() => window.policyResponseHeld, 'admitted policy write response held');
    check(document.body.textContent.includes('Updating details…')
      && !document.body.textContent.includes('Details are enabled and ready on this device.'), 'pending write cannot claim verified readiness');
    window.releasePolicyResponse();
    await waitFor(() => document.body.textContent.includes('Details are enabled and ready on this device.'), 'recovery confirms policy and worker readback');
    check(policyRequests.length === recoverWrites+1 && policyEnabled && selector
      && !button(recoverLabel), 'duplicate clicks make one write and confirmed recovery removes action');
    check(window.summaryPreferenceSaves.length === preferenceCount
      && JSON.stringify(window.summaryPreferenceSaves.at(-1)) === savedAccount
      && calls.filter(item => ['register','remove','unsubscribe'].includes(item)).length === subscriptionsBefore
      && JSON.stringify(macPolicy) === macBefore
      && document.querySelector('#morning-delivery-time').value === '08:55', 'device-only recovery excludes consent, preferences, subscriptions and Mac policy writes and preserves the scheduling draft');
    chooseTime('08:50'); await tick();

    policyEnabled=false; selector=null; await reloadDevice();
    window.rotateAfterPolicyObservation=true;
    const observedWrites=policyRequests.length;
    clickButton(recoverLabel);
    await waitFor(() => document.body.textContent.includes('No request was retried.'), 'observed policy version changed before write');
    check(!policyEnabled && policyRequests.length === observedWrites, 'recovery cannot adopt a newer policy version between observation and set');
    await reloadDevice();
    window.rotateNextPolicy=true;
    const staleWrites=policyRequests.length;
    clickButton(recoverLabel);
    await waitFor(() => document.body.textContent.includes('No request was retried.'), 'stale policy version settles without retry');
    check(!policyEnabled && policyRequests.length === staleWrites+1, 'stale version cannot enable and is not replayed with a newer version');
    await reloadDevice();
    window.invalidateBindingAfterObservation=true;
    const oldBindingWrites=policyRequests.length;
    clickButton(recoverLabel);
    await waitFor(() => document.body.textContent.includes('No request was retried.'), 'installation became stale during recovery');
    check(policyRequests.length === oldBindingWrites && !button(recoverLabel), 'stale installation cannot enable details or automatically reconnect');
    window.staleDetailBinding=false; await reloadDevice();
    window.loseNextPolicyResponse=true;
    clickButton(recoverLabel);
    await waitFor(() => document.body.textContent.includes('request was uncertain, but readback confirms'), 'lost policy acknowledgement resolved by readback');
    check(policyEnabled && selector && policyRequests.length === staleWrites+2, 'uncertain write is read back without a second mutation');

    policyEnabled=false; selector=null; await reloadDevice();
    window.failSelectorCommit=true;
    const partialWrites=policyRequests.length;
    clickButton(recoverLabel);
    await waitFor(() => document.body.textContent.includes('account settings were not changed. No request was retried.'), 'selector failure settles conservatively');
    check(policyEnabled && !selector && policyRequests.length === partialWrites+1
      && !document.body.textContent.includes('Details are enabled and ready on this device.'), 'partial enablement cannot claim worker readiness');
    window.failSelectorCommit=false;
    await waitFor(() => Boolean(button('Retry notification status')), 'partial recovery offers retry');
    clickButton('Retry notification status');
    await waitFor(() => selector && !button('Retry notification status'), 'status-only repair after partial recovery');
    check(policyRequests.length === partialWrites+1, 'partial recovery retry does not repeat policy mutation');
    detailGate=false; policyEnabled=false; selector=null; await reloadDevice();
    check(!button(recoverLabel), 'server gate off hides device recovery');
    detailGate=true; window.staleDetailBinding=true; await reloadDevice();
    check(!button(recoverLabel), 'stale session binding hides device recovery');
    window.staleDetailBinding=false; policyEnabled=true; await reloadDevice();
    check(window.summaryPreferenceSaves.length === preferenceCount
      && JSON.stringify(macPolicy) === macBefore, 'failed and uncertain recovery preserve account consent and the other device');
    clickButton('Disable event titles');
    await waitFor(() => document.body.textContent.includes('Lesson details enabled'),'event withdrawal');
    check(window.summaryPreferenceSaves.at(-1).lessonDetailConsent === true
      && window.summaryPreferenceSaves.at(-1).eventTitleConsent === false,
    'withdrawing events preserves lesson consent');
    clickButton('Enable event titles');
    await waitFor(() => document.body.textContent.includes('Lesson details and event titles enabled'),'event re-enable');
    clickButton('Disable lesson details');
    await waitFor(() => document.body.textContent.includes('Event titles enabled'),'lesson withdrawal');
    check(window.summaryPreferenceSaves.at(-1).lessonDetailConsent === false
      && window.summaryPreferenceSaves.at(-1).eventTitleConsent === true,
    'withdrawing lessons preserves event consent');
    clickButton('Disable event titles');
    await waitFor(() => document.body.textContent.includes('Details disabled'),'last consent withdrawal');
    const beforePreferenceFailure=calls.filter(item=>item==='detail-policy/set').length;
    window.summaryPreferenceFailSave=true;
    clickButton('Enable lesson details');
    await waitFor(() => document.body.textContent.includes('preference request was not confirmed'),
      'failed account preference readback');
    check(calls.filter(item=>item==='detail-policy/set').length===beforePreferenceFailure
      && !window.summaryPreferenceSaves.at(-1).eventTitleConsent,
    'a failed preference save never enables device policy');
    window.failNextDetailPolicy=true;
    clickButton('Enable lesson details');
    await waitFor(() => document.body.textContent.includes('Lesson-detail consent enabled for this account, but this device is not displaying details'),
      'partial device-policy failure');
    check(window.summaryPreferenceSaves.at(-1).lessonDetailConsent===true
      && document.body.textContent.includes("Lesson details enabled for this account; this device's detail policy is off")
      && Boolean(button('Disable lesson details')),
    'partial failure distinguishes saved account consent from the disabled device policy');
    await router.navigate('/settings'); await tick(); await router.navigate('/settings/notifications');
    await waitFor(() => document.body.textContent.includes("Lesson details enabled for this account; this device's detail policy is off")
      && Boolean(button('Disable lesson details')), 'partial policy state after navigation');
    clickButton('Disable lesson details');
    await waitFor(() => document.body.textContent.includes('Details disabled')
      && window.summaryPreferenceSaves.at(-1).lessonDetailConsent===false,
    'partial failure can withdraw consent');
    window.staleDetailBinding=true;
    await router.navigate('/settings'); await tick(); await router.navigate('/settings/notifications');
    await waitFor(() => document.body.textContent.includes('needs reconnecting for the current session'),
      'stale binding guidance');
    check(button('Enable lesson details').disabled && button('Enable event titles').disabled,
      'stale binding cannot enable account details on this device');
    window.staleDetailBinding=false;
    await router.navigate('/settings'); await tick(); await router.navigate('/settings/notifications');
    await waitFor(() => Boolean(button('Enable lesson details') && !button('Enable lesson details').disabled),
      'recovered current binding');
    // Simulate the pilot device returning with its already saved lesson-only
    // account consent, current binding, policy version and worker selector.
    window.setSummaryPreference('ca000000-0000-4000-8000-000000000001', {
      enabled:true, deliveryTime:'08:50', revision:100,
      academicYearId:'cb000000-0000-4000-8000-000000000010',
      lessonDetailConsent:true, eventTitleConsent:false,
    });
    policyEnabled=true;
    selector={ sessionName:'__Host-plannix-s-1',
      installationVersion:'ca000000-0000-4000-8000-000000000099',
      policyVersion:`ca000000-0000-4000-8000-${String(policyNumber).padStart(12,'0')}` };
    await router.navigate('/settings'); await tick(); await router.navigate('/settings/notifications');
    await waitFor(() => document.body.textContent.includes('Lesson details enabled')
      && Boolean(button('Disable lesson details') && button('Enable event titles')),
    'existing lesson-only setting and current device policy');
    check(!button('Disable lesson details').disabled && !button('Enable event titles').disabled,
      'saved lesson-only pilot setting needs no new consent or device action');
    selector=null;
    const beforeRepairWrites=calls.filter(item=>item==='detail-policy/set').length;
    await router.navigate('/settings'); await tick(); await router.navigate('/settings/notifications');
    await waitFor(() => document.body.textContent.includes('Lesson details enabled')
      && !document.body.textContent.includes('detail setup needs reconnecting')
      && selector?.sessionName === '__Host-plannix-s-1',
    'an enabled policy repairs a missing worker selector after reload');
    check(calls.filter(item=>item==='detail-policy/set').length===beforeRepairWrites,
      'selector reconciliation never changes the server device policy');
    selector=null; policyEnabled=false;
    await router.navigate('/settings'); await tick(); await router.navigate('/settings/notifications');
    await waitFor(() => document.body.textContent.includes("this device's detail policy is off"),
      'disabled device policy stays disabled after reload');
    check(selector===null && !button('Retry notification status'),
      'reconciliation cannot re-enable or offer selector repair for a disabled server policy');
    policyEnabled=true;
    selector=null; window.holdDetailStatusAfterCommit=true; window.detailStatusHeld=false;
    await router.navigate('/settings'); await tick(); await router.navigate('/settings/notifications');
    await waitFor(() => window.detailStatusHeld,
      'post-write policy confirmation held after selector commit');
    policyEnabled=false;
    window.releaseHeldDetailStatus();
    await waitFor(() => document.body.textContent.includes("this device's detail policy is off"),
      'policy disabled during selector repair is reported as disabled');
    check(calls.filter(item=>item==='detail-policy/set').length===beforeRepairWrites,
      'race cannot re-enable the server device policy');
    policyEnabled=true;
    selector=null; window.failSelectorCommit=true;
    await router.navigate('/settings'); await tick(); await router.navigate('/settings/notifications');
    await waitFor(() => document.body.textContent.includes("this device's detail status is unverified"),
      'failed selector write cannot report an enabled device');
    check(selector===null && Boolean(button('Retry notification status')),
      'failed coordination cannot create a selector and offers a read-only retry');
    window.failSelectorCommit=false;
    const policyWritesBeforeRetry = calls.filter(item => item === 'detail-policy/set').length;
    const preferenceWritesBeforeRetry = window.summaryPreferenceSaves?.length || 0;
    clickButton('Retry notification status');
    await waitFor(() => selector?.sessionName === '__Host-plannix-s-1'
      && !document.body.textContent.includes('detail status is unverified'),
    'status-only retry repairs after transient worker write failure');
    check(calls.filter(item => item === 'detail-policy/set').length === policyWritesBeforeRetry
      && (window.summaryPreferenceSaves?.length || 0) === preferenceWritesBeforeRetry,
    'selector retry changes neither device policy nor account consent');
    selector=null; window.setSyntheticWorkerActive(false);
    await router.navigate('/settings'); await tick(); await router.navigate('/settings/notifications');
    await waitFor(() => document.body.textContent.includes("this device's detail status is unverified"),
      'delayed worker activation cannot be reported as a disabled policy');
    check(selector===null, 'worker unavailable cannot be silently repaired');
    window.setSyntheticWorkerActive(true);
    await waitFor(() => document.body.textContent.includes('Lesson details enabled')
      && !document.body.textContent.includes('detail status is unverified')
      && selector?.sessionName === '__Host-plannix-s-1',
    'controller change retries verified selector reconciliation');
    window.failSelectorObservation=true;
    await router.navigate('/settings'); await tick(); await router.navigate('/settings/notifications');
    await waitFor(() => document.body.textContent.includes("Lesson details enabled for this account; this device's detail status is unverified"),
      'failed local selector observation is not called a disabled policy');
    window.failSelectorObservation=false;
    selector=null;
    await router.navigate('/settings'); await tick(); await router.navigate('/settings/notifications');
    await waitFor(() => document.body.textContent.includes('Lesson details enabled')
      && !document.body.textContent.includes('detail status is unverified'),
    'a later load repairs the selector after failed coordination');
    window.holdNextPushStatus=true; window.pushStatusHeld=false;
    await router.navigate('/settings'); await tick(); await router.navigate('/settings/notifications');
    await waitFor(() => window.pushStatusHeld, 'old-session status request held');
    invalidateServerSessionContext();
    setServerSessionContext('__Host-plannix-s-2','synthetic-csrf',
      'ca000000-0000-4000-8000-000000000001');
    window.staleDetailBinding=true;
    window.releaseHeldPushStatus();
    await navigator.locks.request('plannix-push-device',{mode:'exclusive'},async () => {});
    await tick();
    check(document.body.textContent.includes('Checking details…')
      && document.body.textContent.includes('This device:')
      && !document.body.textContent.includes('This device: Unknown'),
    'held old-session status reaches its terminal lock release without changing the new session UI');
    window.dispatchEvent(new Event('plannix-server-session-change'));
    await waitFor(() => document.body.textContent.includes('Lesson details enabled for this account; this device needs reconnecting')
      && document.querySelector('.notification-state')?.textContent.includes('This device: Subscribed'),
    'same-account replacement reloads current device status after stale completion');
  }
  button('Send test notification').click(); await tick();
  check(calls.includes('test') && document.body.textContent.includes('not guaranteed'), 'server test path and truthful feedback');
  window.deferPushRemoval = true;
  button('Disable notifications').click();
  await waitFor(() => typeof window.releasePushRemoval === 'function', 'device removal held');
  check(button('Disable notifications')?.disabled
    && !button('Enable notifications') && button('Send test notification').disabled,
    'pending removal retains confirmed subscribed label and blocks other device actions');
  window.releasePushRemoval(true);
  await waitFor(() => document.body.textContent.includes('Synthetic removal failed')
    && !button('Disable notifications')?.disabled, 'failed device removal settles');
  check(!button('Enable notifications'), 'failed removal does not claim the device was disabled');
  window.releasePushRemoval = null;
  button('Disable notifications').click();
  await waitFor(() => typeof window.releasePushRemoval === 'function', 'retried device removal held');
  window.deferPushRemoval = false;
  window.releasePushRemoval(false);
  await waitFor(() => Boolean(button('Enable notifications')
    && !button('Enable notifications').disabled), 'device removal confirmed');
  check(!button('Disable notifications') && calls.includes('remove')
    && document.body.textContent.includes('Not subscribed'), 'confirmed removal switches back to enable');
  if (serverManagedAuth) check(document.body.textContent.includes('notifications are off on this device'),
    'saved consent and a confirmed missing device subscription remain distinct');
  window.Notification.permission = 'denied';
  await router.navigate('/settings'); await tick(); await router.navigate('/settings/notifications'); await tick(); await tick();
  check(button('Enable notifications').disabled && document.body.textContent.includes('Blocked'), 'denied permission is actionable and does not prompt again');
  window.Notification.permission = 'default'; configEnabled = false;
  await router.navigate('/settings'); await tick(); await router.navigate('/settings/notifications'); await tick(); await tick();
  check(button('Enable notifications').disabled && document.body.textContent.includes('not configured'), 'missing server configuration disables registration');
  configEnabled = true; supported = false;
  await router.navigate('/settings'); await tick(); await router.navigate('/settings/notifications'); await tick();
  check(button('Enable notifications').disabled && document.body.textContent.includes('Unavailable in this browser'), 'unsupported browsers fail safely');
  supported = true; subscribed = true; failStatus = true;
  await router.navigate('/settings'); await tick(); await router.navigate('/settings/notifications'); await tick(); await tick();
  check(document.body.textContent.includes('Unknown') && button('Retry notification status'), 'failed status remains unknown and retryable');
  if (serverManagedAuth) check(document.body.textContent.includes("this device's subscription status is unverified"),
    'unknown device status is not reported as a confirmed disabled subscription');
  failStatus = false; window.forceUnregisteredStatus=true;
  button('Retry notification status').click(); await tick(); await tick();
  check(document.body.textContent.includes('Unknown') && !button('Enable notifications').disabled, 'status false stays non-destructive and permits explicit Enable');
  check(subscribed && !calls.includes('unsubscribe'), 'status:false never unsubscribes the browser device');
  const sharedLocks = navigator.locks;
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
  await router.navigate('/settings'); await tick(); await router.navigate('/settings/notifications'); await tick(); await tick();
  check(button('Enable notifications').disabled && !button('Disable notifications')
    && document.body.textContent.includes('cannot safely coordinate'), 'without Web Locks mutation controls are unavailable');
  Object.defineProperty(navigator, 'locks', { configurable: true, value: sharedLocks });
  await router.navigate('/settings'); await tick(); await router.navigate('/settings/notifications'); await tick(); await tick();
  subscribed = false; window.deferPushPermission = true;
  button('Enable notifications').click(); await tick();
  const beforeStale = calls.filter(item => item === 'register').length;
  await router.navigate('/settings'); await tick();
  window.releasePushPermission(); await tick(); await tick();
  check(calls.filter(item => item === 'register').length === beforeStale,
    'late permission response after scope change cannot register a subscription');
  window.deferPushPermission = false;
  await router.navigate('/settings/notifications'); await tick(); await tick();
  window.summaryDelayWeek = '2026-11-30';
  chooseDate('2026-11-30'); await tick();
  const releaseOldYear = window.releaseSummaryWeek;
  window.summaryDelayWeek = null;
  window.summaryYearId = 'cb000000-0000-4000-8000-000000000020';
  chooseDate('2026-12-01'); await tick(); await tick();
  releaseOldYear(true); await tick();
  check(document.querySelector('.morning-preview-content')?.textContent.includes('2026-12-01')
    && !document.body.textContent.includes('Could not load the daily summary preview'), 'late old-year error cannot replace new year');
  check(document.querySelector('.morning-preview-content')?.textContent.includes('P1 — PPA'), 'genuinely empty teaching period is PPA');
  check(window.summaryEventQueries?.some(query => query.academicYearId === window.summaryYearId
    && query.from === '2026-12-01' && query.to === '2026-12-01'), 'events load only for the selected date and year');
  window.summaryDelayEventDate = '2026-12-08';
  chooseDate('2026-12-08'); await tick();
  const oldYearEvents = window.releaseSummaryEvents;
  window.summaryDelayEventDate = null;
  window.summaryYearId = 'cb000000-0000-4000-8000-000000000021';
  chooseDate('2026-12-09'); await tick(); await tick(); oldYearEvents(); await tick();
  check(document.querySelector('.morning-preview-content')?.textContent.includes('2026-12-09')
    && !document.querySelector('.morning-preview-content')?.textContent.includes('Late event'),
  'late successful events cannot replace a newer year');
  window.summaryDelayWeek = '2026-12-07';
  chooseDate('2026-12-07'); await tick();
  const releaseOldAccount = window.releaseSummaryWeek;
  window.summaryDelayWeek = null;
  window.switchNotificationUser('ca000000-0000-4000-8000-000000000002'); await tick(); await tick();
  releaseOldAccount(true); await tick();
  check(document.querySelector('.morning-preview-content')?.textContent.includes('2026-12-07')
    && !document.body.textContent.includes('Could not load the daily summary preview'), 'old-account failure cannot replace new account preview');
  check(document.querySelector('.morning-opt-in input')?.checked === false, 'account switch resets saved preference view');
  window.summaryDelayEventDate = '2026-12-15';
  chooseDate('2026-12-15'); await tick();
  const oldAccountEvents = window.releaseSummaryEvents;
  window.summaryDelayEventDate = null;
  window.switchNotificationUser('ca000000-0000-4000-8000-000000000003'); await tick(); await tick();
  oldAccountEvents(); await tick();
  check(document.querySelector('.morning-preview-content')?.textContent.includes('2026-12-15')
    && !document.querySelector('.morning-preview-content')?.textContent.includes('Late event'),
  'late successful events cannot replace a newer account');
  window.summaryDelayWeek = '2026-12-14';
  chooseDate('2026-12-14'); await tick();
  const releaseUnmounted = window.releaseSummaryWeek;
  await router.navigate('/settings'); await tick();
  releaseUnmounted(true); await tick();
  check(!document.querySelector('.morning-preview-content'), 'unmounted preview ignores late failure');
  window.summaryDelayWeek = null;
  await router.navigate('/settings/notifications'); await tick(); await tick();
  await router.navigate('/settings/notifications?summaryRef=cb000000-0000-4000-8000-000000000030');
  await tick(); await tick();
  check(document.querySelector('#morning-linked-heading')?.textContent.includes('2026-10-05')
    && document.body.textContent.includes('Linked lesson')
    && window.summaryLinkedDayRequests.at(-1).userId === 'ca000000-0000-4000-8000-000000000001'
    && window.summaryLinkedDayRequests.at(-1).summaryRef === 'cb000000-0000-4000-8000-000000000030',
  'notification link re-requests the original day using the currently authenticated account');
  window.summaryLinkedDayFailure = true;
  await router.navigate('/settings/notifications?summaryRef=cb000000-0000-4000-8000-000000000031');
  await tick(); await tick();
  check(document.body.textContent.includes('Could not load this notification’s day')
    && !document.body.textContent.includes('Linked lesson'), 'failed linked day never displays stale data');
  if (serverManagedAuth) {
    // The route remount above restores the fixture's first account. Restore its
    // matching session too before testing the worker's readiness notification.
    subscribed = true;
    window.forceUnregisteredStatus = false;
    window.staleDetailBinding = false;
    window.switchNotificationUser('ca000000-0000-4000-8000-000000000001');
    window.dispatchEvent(new Event('plannix-server-session-change'));
    await waitFor(() => document.querySelector('.notification-state')?.textContent.includes('This device: Subscribed'),
      'worker update fixture has a verified matching account and session');
  }
  const installed = new EventTarget();
  installed.state = 'installed'; installed.scriptURL = 'file:///push-sw.js';
  const activateSyntheticWorker = function (_message,[port]) {
    port.postMessage({accepted:true});
    activeWorker = this;
    registration.waiting = null;
    this.state = 'activated';
    this.dispatchEvent(new Event('statechange'));
  };
  installed.postMessage = activateSyntheticWorker;
  registration.waiting = installed;
  registration.dispatchEvent(new Event('updatefound'));
  await waitFor(() => Boolean(button('Update now')), 'waiting worker update prompt');
  const notice = document.querySelector('.push-update-notice');
  check(notice?.parentElement?.classList.contains('settings-timetable-form')
    && notice.previousElementSibling?.textContent === 'This device'
    && notice.nextElementSibling?.textContent === 'A test contains no lesson details.'
    && getComputedStyle(notice).borderTopWidth === '0px'
    && getComputedStyle(notice).backgroundColor === 'rgba(0, 0, 0, 0)',
  'update notice sits inside the device card immediately after its heading without a separate banner');
  await router.navigate('/settings'); await tick();
  check(!document.querySelector('.push-update-notice'), 'available update notice is absent outside Notifications');
  await router.navigate('/settings/notifications');
  await waitFor(() => Boolean(button('Update now')), 'waiting update reappears on Notifications');
  button('Later').click(); await tick();
  check(!button('Update now') && registration.waiting === installed,
    'deferring leaves the worker waiting and the current page intact');
  await router.navigate('/settings'); await tick();
  await router.navigate('/settings/notifications'); await tick();
  check(!button('Update now') && registration.waiting === installed,
    'Later stays deferred after leaving and returning to Notifications');
  const newer = new EventTarget();
  newer.state = 'installed'; newer.scriptURL = 'file:///push-sw.js';
  newer.postMessage = activateSyntheticWorker;
  registration.waiting = newer;
  registration.dispatchEvent(new Event('updatefound'));
  await waitFor(() => Boolean(button('Update now')), 'new waiting worker update prompt');
  newer.postMessage = () => { throw Error('synthetic activation failure'); };
  button('Update now').click();
  await waitFor(() => document.querySelector('.push-update-notice [role="alert"]')?.textContent.includes('Could not request the worker update.')
    && button('Update now')?.disabled === false,
    'failed activation remains available with accessible error feedback');
  let releaseActivation;
  newer.postMessage = function (message, ports) {
    releaseActivation = () => activateSyntheticWorker.call(this, message, ports);
  };
  const configBeforeUpdate = calls.filter(item => item === 'config').length;
  let activationNotices = 0;
  const activated = () => { activationNotices++; };
  window.addEventListener('plannix-push-worker-activated', activated);
  button('Update now').click();
  await waitFor(() => Boolean(releaseActivation) && Boolean(button('Updating…'))
    && document.querySelector('.push-update-notice [role="status"]')?.textContent.includes('Installing'),
  'pending update announces progress and disables duplicate actions');
  check(button('Later')?.disabled === true, 'Later cannot interrupt a pending activation');
  releaseActivation();
  await waitFor(() => registration.active === newer && !button('Update now'), 'explicit worker activation');
  await waitFor(() => activationNotices === 1, 'one activation acknowledgement');
  await waitFor(() => !document.querySelector('.push-update-notice'),
    'successful activation removes the notice');
  if (serverManagedAuth) await waitFor(() => calls.filter(item => item === 'config').length > configBeforeUpdate,
    'notification readiness after activation');
  window.removeEventListener('plannix-push-worker-activated', activated);
  if (serverManagedAuth) {
    window.name='plannix-notification-detail-reload';
    document.body.dataset.testResult='reload-pending';
    return;
  }
  document.body.dataset.testResult = 'passed';
} catch (error) {
  document.body.dataset.testResult = 'failed';
  document.body.dataset.testError = error.stack || error.message;
} })();
