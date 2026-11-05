# iPhone push-worker capability check

This diagnostic is independent of notification authorization and display. It
does not enable polling, the morning-summary worker, detail display, device
policy or consent. It is available only in a revision containing the diagnostic;
the currently deployed worker will ignore the request and the result will be
**unverified**. Deploying code is a separate operator decision.

With the installed Plannix Home Screen app open, select its **Web** page under
the connected iPhone in Mac Safari's Develop menu. Paste this into that page's
Console. The page sends one message to its active service worker through a
MessageChannel. The worker validates the browser-provided client origin and
returns only four booleans. A missing, malformed or late response prints
`{ verified: false }`; it does not mean an API is unsupported.

```js
(() => {
  let channel;
  let timer;
  let finished = false;
  const finish = result => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    try { channel?.port1.close(); channel?.port2.close(); } catch {}
    console.log(result);
  };
  timer = setTimeout(() => finish({ verified: false }), 3000);
  try {
    channel = new MessageChannel();
    channel.port1.onmessage = ({ data }) => {
      const names = 'cryptoSubtle,indexedDB,pushSubscriptionAccess,webLocks';
      if (!data || typeof data !== 'object' || Array.isArray(data)
        || Object.keys(data).sort().join(',') !== names
        || !Object.values(data).every(value => typeof value === 'boolean')) {
        finish({ verified: false });
        return;
      }
      finish(data);
    };
    navigator.serviceWorker.getRegistration('/').then(registration => {
      if (finished) return;
      if (!registration?.active) { finish({ verified: false }); return; }
      registration.active.postMessage(
        { type: 'plannix-worker-capabilities', version: 1 }, [channel.port2]);
    }).catch(() => finish({ verified: false }));
  } catch { finish({ verified: false }); }
})();
```

The four booleans test API *availability inside the actual worker*, not whether
IndexedDB can open, a lock can be acquired, a subscription exists, a push can
arrive, or detail display is safe. The diagnostic reads no selector, subscription,
session or content, writes no storage, makes no network request and displays
nothing. Do not paste the Console's surrounding page or network data into a
report; the four booleans or `verified: false` are sufficient.
