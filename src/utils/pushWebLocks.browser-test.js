import { reconcilePushAccount } from './pushNotifications.js';
import { withPushDeviceLock } from './pushDeviceLock.js';

const syntheticBrowser = {
  isSecureContext: true,
  PushManager: function PushManager() {},
  Notification: { permission: 'granted' },
  navigator: {
    locks: navigator.locks,
    serviceWorker: { getRegistration: async () => ({ pushManager: {
      getSubscription: async () => {
        const response = await fetch('/device');
        const device = await response.json();
        return {
          endpoint: device.endpoint,
          toJSON: () => ({ keys: device.keys }),
          unsubscribe: async () => {
            await fetch('/unsubscribe', { method: 'POST' });
            return true;
          },
        };
      },
    } }) },
  },
};

window.startOldReconciliation = () => {
  window.oldReconciliation = reconcilePushAccount({ browser: syntheticBrowser,
    request: async path => {
      if (path !== 'status') throw Error('Unexpected mock operation');
      const response = await fetch('/status');
      return response.json();
    } });
};

window.startNewRegistration = () => {
  window.newRegistrationEntered = false;
  window.newRegistration = withPushDeviceLock(async () => {
    window.newRegistrationEntered = true;
    const registration = await syntheticBrowser.navigator.serviceWorker.getRegistration();
    const device = await registration.pushManager.getSubscription();
    const response = await fetch('/register', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: device.endpoint, keys: { auth: 'synthetic-new-auth', p256dh: 'synthetic-new-public' } }),
    });
    if (!response.ok) throw Error('Mock registration failed');
  }, { browser: syntheticBrowser });
};
