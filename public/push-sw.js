/* Push-only worker. It does not cache, fetch or intercept app requests. */
self.addEventListener('push', (event) => {
  let payload;
  try { payload = event.data?.json(); } catch { return; }
  if (!payload || Object.keys(payload).sort().join(',') !== 'type,version'
    || payload.type !== 'plannix-test' || payload.version !== 1) return;
  event.waitUntil(self.registration.showNotification('Plannix test notification', {
    body: 'Notifications are enabled on this device.',
    tag: 'plannix-test',
    data: { path: '/settings/notifications' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destination = new URL('/settings/notifications', self.location.origin);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => {
      try { return new URL(client.url).origin === destination.origin; } catch { return false; }
    });
    if (existing) {
      try {
        const windowClient = await existing.navigate(destination.href);
        if (windowClient) { await windowClient.focus(); return; }
      } catch { /* Open a new same-origin page if this tab cannot navigate. */ }
    }
    await self.clients.openWindow(destination.href);
  })());
});
