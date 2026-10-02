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
const router = createMemoryRouter([{ path: '/settings/notifications', element: <Notifications userId="ca000000-0000-4000-8000-000000000001" /> },
  { path: '/settings', element: <main>Settings</main> }], { initialEntries: ['/settings/notifications'] });
root.render(<RouterProvider router={router} />);
const tick = () => new Promise(resolve => setTimeout(resolve, 25));
const button = label => [...document.querySelectorAll('button')].find(node => node.textContent === label);
const check = (condition, message) => { if (!condition) throw Error(message); };
(async () => { try {
  await tick(); await tick();
  check(calls.includes('config') && !calls.includes('permission'), 'permission is not requested on load');
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
  document.body.dataset.testResult = 'passed';
} catch (error) {
  document.body.dataset.testResult = 'failed';
  document.body.dataset.testError = error.message;
} })();
