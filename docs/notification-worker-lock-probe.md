# iPhone worker/page Web Lock probe (inactive notification details)

Run this only after the matching worker revision is active in the installed
Plannix Home Screen app. Paste it into that app's **page** Console from Mac
Safari. It uses the real `plannix-push-device` lock but reads no notification
state. Keep polling, the one-shot worker and detail display off. It does not
change the push subscription, selector, consent, device policy or server data.

The runner checks an empty lock baseline, then observes one held and one pending
lock in each direction. It requires `queued`, `entered` and `released`
acknowledgements from the actual service worker. A missing, malformed or late
acknowledgement is **inconclusive**, never a pass. An observed entry while the
other side holds the lock reports `lockSharing: false`. The page has a 12-second
overall deadline; each worker probe releases within five seconds. A closed port
does not reliably notify the worker, so its own deadline is also required.

```js
(async () => {
  const name = 'plannix-push-device';
  const controller = new AbortController();
  const probes = [];
  const jobs = [];
  let releasePage = () => {};
  let rejectDeadline;
  const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
  deadline.catch(() => {});
  const wait = value => Promise.race([Promise.resolve(value), deadline]);
  const timer = setTimeout(() => {
    controller.abort();
    releasePage();
    for (const probe of probes) probe.release();
    rejectDeadline(new Error('inconclusive'));
  }, 12000);
  const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
  };
  const startProbe = worker => {
    const channel = new MessageChannel();
    const phases = [];
    let notify = () => {};
    channel.port1.onmessage = ({ data }) => {
      phases.push(data?.phase);
      notify();
    };
    channel.port1.start?.();
    const probe = {
      phases,
      release: () => { try { channel.port1.postMessage({ phase:'release' }); } catch {} },
      close: () => { try { channel.port1.close(); channel.port2.close(); } catch {} },
      next: expected => wait(new Promise((resolve, reject) => {
        const check = () => {
          if (!phases.length) { notify = check; return; }
          notify = () => {};
          phases.shift() === expected ? resolve() : reject(new Error('inconclusive'));
        };
        check();
      })),
    };
    probes.push(probe);
    worker.postMessage({ type:'plannix-worker-lock-probe', version:1 }, [channel.port2]);
    return probe;
  };
  const lockState = async () => {
    const state = await wait(navigator.locks.query());
    return [state.held.filter(item => item.name === name).length,
      state.pending.filter(item => item.name === name).length];
  };
  const observe = async (held, pending, earlyEntry = () => false) => {
    for (;;) {
      if (earlyEntry()) throw new Error('not-shared');
      const state = await lockState();
      if (state[0] === held && state[1] === pending) return;
      await wait(new Promise(resolve => setTimeout(resolve, 25)));
    }
  };
  try {
    if (typeof navigator.locks?.request !== 'function'
      || typeof navigator.locks.query !== 'function') throw new Error('inconclusive');
    const registration = await wait(navigator.serviceWorker.getRegistration('/'));
    if (!registration?.active) throw new Error('inconclusive');
    await observe(0, 0);

    const pageEntered = deferred();
    const pageExit = deferred();
    releasePage = pageExit.resolve;
    const firstPageJob = navigator.locks.request(name,
      { mode:'exclusive', signal:controller.signal }, async lock => {
        if (!lock || controller.signal.aborted) return;
        pageEntered.resolve();
        await pageExit.promise;
      });
    jobs.push(firstPageJob);
    firstPageJob.catch(() => {});
    await wait(pageEntered.promise);
    const first = startProbe(registration.active);
    await first.next('queued');
    await observe(1, 1, () => first.phases.includes('entered'));
    if (first.phases.includes('entered')) throw new Error('not-shared');
    releasePage();
    await wait(firstPageJob);
    await first.next('entered');
    first.release();
    await first.next('released');
    await observe(0, 0);

    const second = startProbe(registration.active);
    await second.next('queued');
    await second.next('entered');
    let secondPageEntered = false;
    const secondPageJob = navigator.locks.request(name,
      { mode:'exclusive', signal:controller.signal }, async lock => {
        if (lock && !controller.signal.aborted) secondPageEntered = true;
      });
    jobs.push(secondPageJob);
    secondPageJob.catch(() => {});
    await observe(1, 1, () => secondPageEntered);
    if (secondPageEntered) throw new Error('not-shared');
    second.release();
    await second.next('released');
    await wait(secondPageJob);
    if (!secondPageEntered) throw new Error('inconclusive');
    await observe(0, 0);
    console.log({ workerBehindPage:true, pageBehindWorker:true });
  } catch (error) {
    console.log(error?.message === 'not-shared'
      ? { lockSharing:false } : { inconclusive:true });
  } finally {
    clearTimeout(timer);
    controller.abort();
    releasePage();
    for (const probe of probes) probe.release();
    await Promise.race([Promise.allSettled(jobs),
      new Promise(resolve => setTimeout(resolve, 1000))]);
    for (const probe of probes) probe.close();
  }
})();
```

`workerBehindPage: true` and `pageBehindWorker: true` establish functional
lock sharing for these two controlled operations on this iPhone. They do not
prove storage availability, selector invalidation, notification authorization,
or safe OS display. Do not treat `inconclusive: true` as unsupported locks.

## Existing worker update/status check

After a deployment is Live, run this in the same installed app page Console.
It requests an update without unregistering, clearing data or changing the
subscription. A waiting worker may require closing all Plannix Home Screen app
windows and reopening the app before it becomes active. The state values do
not identify the exact script bytes of the active worker.

```js
(async () => {
  try {
    const registration = await navigator.serviceWorker.getRegistration('/');
    if (!registration) return console.log({ registrationFound:false });
    await registration.update();
    console.log({ registrationFound:true,
      activeState:registration.active?.state ?? null,
      waiting:Boolean(registration.waiting),
      installing:Boolean(registration.installing),
      controlsThisPage:Boolean(navigator.serviceWorker.controller) });
  } catch { console.log({ updateVerified:false }); }
})();
```
