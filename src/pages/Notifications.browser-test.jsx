import React from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import Notifications from './Notifications.jsx';
import '../styles/base.css';
import '../styles/accessibility.css';

const calls = [];
let subscribed = false;
let supported = true;
let configEnabled = true;
let failStatus = false;
let lockDepth = 0;
const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic-device-token',
  toJSON: () => ({ endpoint: subscription.endpoint, keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) }, expirationTime: null }),
  unsubscribe: async () => { calls.push('unsubscribe'); subscribed = false; return true; } };
window.Notification = { permission: 'default', requestPermission: async () => {
  calls.push('permission');
  if (window.deferPushPermission) return new Promise(resolve => { window.releasePushPermission = () => {
    window.Notification.permission = 'granted'; resolve('granted');
  }; });
  window.Notification.permission = 'granted'; return 'granted';
} };
Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register: async () => ({ pushManager: {
  getSubscription: async () => subscribed ? subscription : null,
  subscribe: async () => { calls.push('subscribe'); subscribed = true; return subscription; },
} }) } });
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
export const disableCurrentDevice = async () => { calls.push('remove'); subscribed = false; };
export const pushRequest = async (path, body) => {
  calls.push(path);
  if (['status', 'register', 'test'].includes(path) && !lockDepth) throw Error('Device operation occurred outside Web Lock');
  if (path === 'config') return { configured: configEnabled, publicKey: configEnabled ? 'synthetic-public-key' : null };
  if (path === 'status') { if (failStatus) throw Error('Synthetic status failure'); return { registered: false }; }
  if (path === 'register') {
    if (body.subscription.expirationTime !== undefined) throw Error('Unexpected expirationTime');
    return { registered: true };
  }
  if (path === 'test') return { accepted: true };
  return { registered: false };
};

const root = createRoot(document.getElementById('root'));
function NotificationFixture() {
  const [userId, setUserId] = React.useState('ca000000-0000-4000-8000-000000000001');
  window.switchNotificationUser = setUserId;
  return <Notifications userId={userId} organisationId="cb000000-0000-4000-8000-000000000011" />;
}
const router = createMemoryRouter([{ path: '/settings/notifications', element: <NotificationFixture /> },
  { path: '/settings', element: <main>Settings</main> }], { initialEntries: ['/settings/notifications'] });
root.render(<RouterProvider router={router} />);
const tick = () => new Promise(resolve => setTimeout(resolve, 25));
const button = label => [...document.querySelectorAll('button')].find(node => node.textContent === label);
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
  await tick(); await tick();
  check(calls.includes('config') && !calls.includes('permission'), 'permission is not requested on load');
  check(document.body.textContent.includes('Morning summaries are not active yet'), 'summary preference cannot imply scheduling');
  check(document.querySelector('#morning-academic-year')?.value === 'cb000000-0000-4000-8000-000000000010'
    && document.body.textContent.includes('Saved notification year: Not confirmed'),
  'current Settings year is offered but an old preference has no confirmed delivery year');
  check(document.querySelector('#morning-preview-date')?.value, 'London preview date selector is present');
  const optIn = document.querySelector('.morning-opt-in input');
  optIn.click(); await tick();
  button('Save preferences').click(); await tick();
  check(window.summaryPreferenceSaves?.at(-1)?.enabled === true, 'opt-in preference reaches only the preference API');
  check(window.summaryPreferenceSaves.at(-1).academicYearId === 'cb000000-0000-4000-8000-000000000010',
    'saving explicitly confirms the notification academic year');
  check(window.summaryPreferenceSaves.at(-1).revision === 0, 'first save uses absent-row revision');
  check(document.body.textContent.includes('Morning summaries are not active yet'), 'saved opt-in still does not imply activation');
  chooseTime('08:20'); await tick();
  window.setSummaryPreference('ca000000-0000-4000-8000-000000000001',
    { enabled: true, deliveryTime: '06:30', revision: 2,
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
  check(window.summaryPreferenceSaves.at(-1).revision === 2, 'post-reload save uses current revision');
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
  button('Enable notifications').click(); await tick(); await tick();
  check(calls.filter(item => item === 'permission').length === 1, 'explicit click requests permission once');
  check(calls.includes('register') && document.body.textContent.includes('Subscribed'), 'registration reaches server');
  button('Send test notification').click(); await tick();
  check(calls.includes('test') && document.body.textContent.includes('not guaranteed'), 'server test path and truthful feedback');
  button('Disable on this device').click(); await tick();
  check(calls.includes('remove') && document.body.textContent.includes('Not subscribed'), 'disable removes current device');
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
  failStatus = false; button('Retry notification status').click(); await tick(); await tick();
  check(document.body.textContent.includes('Unknown') && !button('Enable notifications').disabled, 'status false stays non-destructive and permits explicit Enable');
  check(subscribed && !calls.includes('unsubscribe'), 'status:false never unsubscribes the browser device');
  const sharedLocks = navigator.locks;
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
  await router.navigate('/settings'); await tick(); await router.navigate('/settings/notifications'); await tick(); await tick();
  check(button('Enable notifications').disabled && button('Disable on this device').disabled
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
  document.body.dataset.testResult = 'passed';
} catch (error) {
  document.body.dataset.testResult = 'failed';
  document.body.dataset.testError = error.message;
} })();
