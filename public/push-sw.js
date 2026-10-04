/* Push-only worker. It does not cache, fetch or intercept app requests. */
self.addEventListener('push', (event) => {
  let payload;
  try { payload = event.data?.json(); } catch { return; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
  if (Object.keys(payload).sort().join(',') === 'type,version'
    && payload.type === 'plannix-test' && payload.version === 1) {
    event.waitUntil(self.registration.showNotification('Plannix test notification', {
      body: 'Notifications are enabled on this device.', tag: 'plannix-test', data: { type: 'test' },
    }));
    return;
  }
  if (Object.keys(payload).sort().join(',') !== 'body,notificationRef,title,type,version'
    || payload.type !== 'plannix-morning-summary' || payload.version !== 1
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(payload.notificationRef)
    || payload.title !== 'Your Plannix day'
    || payload.body !== 'Open Plannix to view your morning summary.') return;
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body, tag: 'plannix-morning-summary',
    data: { type: 'morning', notificationRef: payload.notificationRef },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data;
  const destination = new URL('/settings/notifications', self.location.origin);
  if (data?.type === 'morning'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(data.notificationRef)) {
    destination.searchParams.set('summaryRef', data.notificationRef);
  }
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
