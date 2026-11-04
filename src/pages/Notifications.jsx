import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import SettingsSubnav from '../components/SettingsSubnav';
import MorningSummaryPanel from '../components/MorningSummaryPanel.jsx';
import { currentPushSubscription, disableCurrentDevice, pushRequest, pushSupport, reconcilePushAccount, vapidBytes, waitForPushAccountReconciliation } from '../utils/pushNotifications';
import { pushCoordinationSupported, PUSH_LOCK_UNAVAILABLE, withPushDeviceLock } from '../utils/pushDeviceLock';
import { serverManagedAuth, captureServerOperationContext,
  assertServerOperationContext } from '../utils/serverAuthTransport';
import { commitDetailSelector, invalidateDetailSelector,
  observeDetailSelector } from '../utils/pushDetailSelector.js';
import './Settings.css';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export default function Notifications({ userId, organisationId }) {
  const [configured, setConfigured] = useState(false);
  const [registered, setRegistered] = useState(null);
  const [detailAvailable, setDetailAvailable] = useState(false);
  const [detailEnabled, setDetailEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [permission, setPermission] = useState(globalThis.Notification?.permission || 'unavailable');
  const [reloadKey, setReloadKey] = useState(0);
  const publicKey = useRef(null);
  const bindingVersion = useRef(null);
  const generation = useRef(0);
  const busyRef = useRef(null);
  const supported = pushSupport();
  const coordinated = pushCoordinationSupported();
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;

  useEffect(() => {
    if (!serverManagedAuth) return undefined;
    const changed = () => {
      bindingVersion.current = null;
      setDetailEnabled(false);
      setReloadKey(value => value + 1);
    };
    window.addEventListener('plannix-server-session-change', changed);
    window.addEventListener('plannix-server-session-mismatch', changed);
    return () => {
      window.removeEventListener('plannix-server-session-change', changed);
      window.removeEventListener('plannix-server-session-mismatch', changed);
    };
  }, []);

  useEffect(() => {
    const ticket = ++generation.current;
    busyRef.current = null; setBusy(false);
    setLoading(true); setRegistered(null); setConfigured(false); setConfigLoaded(false); setError(''); setNotice('');
    setDetailAvailable(false); setDetailEnabled(false); bindingVersion.current = null;
    if (!supported || !coordinated || !userId) { setLoading(false); return () => { generation.current++; busyRef.current = null; }; }
    (async () => {
      try {
        const context = serverManagedAuth ? captureServerOperationContext(userId) : null;
        const config = await pushRequest('config', undefined,
          { expectedUserId: userId, operationContext:context });
        if (ticket !== generation.current) return;
        publicKey.current = config?.publicKey || null;
        setConfigLoaded(true);
        setConfigured(config?.configured === true && Boolean(publicKey.current));
        setDetailAvailable(serverManagedAuth && config?.detailDisplayAvailable === true);
        await withPushDeviceLock(async () => {
          if (context) assertServerOperationContext(context);
          if (ticket !== generation.current) return;
          const subscription = await currentPushSubscription();
          if (!subscription) { if (ticket === generation.current) setRegistered(false); return; }
          if (config?.configured !== true) return;
          const status = await pushRequest('status', { endpoint: subscription.endpoint },
            { expectedUserId: userId, operationContext:context });
          if (typeof status?.registered !== 'boolean') throw new Error('Invalid device status.');
          if (ticket === generation.current) {
            setRegistered(status.registered === true ? true : null);
            bindingVersion.current = status.boundToCurrentSession === true ? status.version : null;
            if (config?.detailDisplayAvailable === true && bindingVersion.current) {
              const policy = await pushRequest('detail-policy/status', {
                endpoint:subscription.endpoint, installationVersion:bindingVersion.current,
              }, { expectedUserId:userId, operationContext:context });
              if (ticket === generation.current && context) {
                assertServerOperationContext(context);
                const stored = await observeDetailSelector().catch(() => null);
                if (ticket === generation.current) setDetailEnabled(policy.enabled === true
                  && stored?.selector?.sessionName === context.sessionName
                  && stored.selector.installationVersion === bindingVersion.current
                  && stored.selector.policyVersion === policy.policyVersion);
              }
            }
          }
        });
      } catch {
        if (ticket === generation.current) setError('Could not load notification settings. Please retry.');
      } finally { if (ticket === generation.current) setLoading(false); }
    })();
    return () => { generation.current++; busyRef.current = null; };
  }, [userId, supported, coordinated, reloadKey]);

  async function run(operation) {
    if (busyRef.current !== null) return;
    const ticket = generation.current;
    busyRef.current = ticket;
    setBusy(true); setError(''); setNotice('');
    try {
      const context = serverManagedAuth ? captureServerOperationContext(userId) : null;
      await operation(ticket,context);
    }
    catch (caught) { if (ticket === generation.current) setError(caught?.message || 'Notification action failed.'); }
    finally {
      if (busyRef.current === ticket) { busyRef.current = null; setPermission(globalThis.Notification?.permission || 'unavailable'); setBusy(false); }
    }
  }

  const enable = () => run(async (ticket, context) => {
    await waitForPushAccountReconciliation();
    if (ticket !== generation.current) return;
    if (!configured || !publicKey.current) throw new Error('Notifications are not configured.');
    const result = await Notification.requestPermission();
    if (ticket !== generation.current) return;
    setPermission(result);
    if (result !== 'granted') throw new Error(result === 'denied'
      ? 'Notifications are blocked in your browser settings.' : 'Notification permission was not granted.');
    await withPushDeviceLock(async () => {
      if (context) assertServerOperationContext(context);
      if (ticket !== generation.current) return;
      const registration = await navigator.serviceWorker.register('/push-sw.js', { scope: '/' });
      if (ticket !== generation.current) return;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: vapidBytes(publicKey.current),
      });
      if (ticket !== generation.current) return;
      const details = subscription.toJSON();
      const payload = { endpoint: details.endpoint, keys: details.keys };
      const observed = serverManagedAuth
        ? await pushRequest('observe', { subscription:payload }, { expectedUserId:userId, operationContext:context })
        : null;
      if (context) assertServerOperationContext(context);
      if (ticket !== generation.current) return;
      if (serverManagedAuth) await invalidateDetailSelector().catch(() => {});
      const committed = await pushRequest('register', serverManagedAuth
        ? { subscription:payload, expectedVersion:observed.version } : { subscription:payload },
        { expectedUserId: userId, operationContext:context });
      if (serverManagedAuth && !UUID.test(committed?.version || ''))
        throw new Error('Notification binding confirmation is unavailable.');
      if (context) assertServerOperationContext(context);
      if (serverManagedAuth && ticket === generation.current) bindingVersion.current = committed.version;
    });
    if (ticket !== generation.current) { void reconcilePushAccount().catch(() => {}); return; }
    setRegistered(true);
    setNotice('Notifications are enabled on this device.');
  });
  const disable = () => run(async (ticket, context) => {
    if (context) assertServerOperationContext(context);
    if (serverManagedAuth) await invalidateDetailSelector().catch(() => {});
    const result = await disableCurrentDevice({ expectedUserId: userId,
      isCurrent: () => generation.current === ticket,
      operationContext:context });
    if (ticket !== generation.current) return;
    setRegistered(false);
    setDetailEnabled(false); bindingVersion.current = null;
    setNotice(result?.state === 'absent'
      ? 'This account has no registered notification subscription on this device.'
      : 'Notifications are disabled on this device.');
  });
  const setDetails = enabled => run(async (ticket, context) => {
    if (!serverManagedAuth || !detailAvailable || !bindingVersion.current || !context)
      throw new Error('Notification detail is unavailable.');
    const version = bindingVersion.current;
    await withPushDeviceLock(async () => {
      assertServerOperationContext(context);
      if (ticket !== generation.current || version !== bindingVersion.current) return;
      const selector = enabled ? await observeDetailSelector() : null;
      const subscription = await currentPushSubscription();
      if (!subscription) throw new Error('This device is no longer subscribed.');
      if (!enabled) await invalidateDetailSelector().catch(() => {});
      const policy = await pushRequest('detail-policy/status', {
        endpoint:subscription.endpoint, installationVersion:version,
      }, { expectedUserId:userId, operationContext:context });
      assertServerOperationContext(context);
      if (ticket !== generation.current || version !== bindingVersion.current) return;
      const saved = await pushRequest('detail-policy/set', {
        endpoint:subscription.endpoint, installationVersion:version,
        policyVersion:policy.policyVersion, enabled,
      }, { expectedUserId:userId, operationContext:context });
      assertServerOperationContext(context);
      if (ticket !== generation.current || version !== bindingVersion.current) return;
      if (enabled) await commitDetailSelector({ expectedEpoch:selector.epoch,
        sessionName:context.sessionName, installationVersion:version,
        policyVersion:saved.policyVersion });
      setDetailEnabled(enabled);
    });
    if (ticket === generation.current) setNotice(enabled
      ? 'Lesson details are enabled for this device.' : 'Lesson details are disabled for this device.');
  });
  const test = () => run(async (ticket, context) => {
    await withPushDeviceLock(async () => {
      if (context) assertServerOperationContext(context);
      if (ticket !== generation.current) return;
      const subscription = await currentPushSubscription();
      if (ticket !== generation.current) return;
      if (!subscription) { setRegistered(false); throw new Error('This device is no longer subscribed. Enable notifications again.'); }
      try { await pushRequest('test', { endpoint: subscription.endpoint },
        { expectedUserId: userId, operationContext:context }); }
      catch (caught) {
        if (ticket === generation.current && caught?.status === 410) setRegistered(null);
        throw caught;
      }
    });
    if (ticket !== generation.current) return;
    setNotice('The push service accepted the test. Delivery to this device is not guaranteed.');
  });

  return <main className="settings-page">
    <div className="container settings-inner settings-inner--wide">
      <p className="settings-breadcrumb"><Link to="/">Home</Link><span aria-hidden> / </span><Link to="/settings">Settings</Link><span aria-hidden> / </span>Notifications</p>
      <h1 className="settings-title">Notifications</h1>
      <SettingsSubnav />
      <div className="settings-timetable-form">
        <h2 className="settings-section-title">This device</h2>
        <p className="settings-hint">Notifications are personal to this signed-in account and this device. A test contains no lesson details.</p>
        <div className="notification-state">
          <p><strong>Browser support:</strong> {supported ? 'Supported' : 'Unavailable in this browser or insecure context'}</p>
          <p><strong>Permission:</strong> {permission === 'granted' ? 'Allowed' : permission === 'denied' ? 'Blocked' : permission === 'default' ? 'Not requested' : 'Unavailable'}</p>
          <p><strong>This device:</strong> {loading ? 'Checking…' : registered === true ? 'Subscribed' : registered === false ? 'Not subscribed' : 'Unknown'}</p>
        </div>
        {ios && !standalone ? <p className="settings-hint">On iPhone or iPad, add Plannix to your Home Screen and open it there to enable web notifications.</p> : null}
        {supported && !coordinated ? <p className="settings-error" role="alert">{PUSH_LOCK_UNAVAILABLE}</p> : null}
        {coordinated && !loading && registered === null && !error ? <p role="status">This device needs reconciliation. Retry notification status or choose Enable notifications.</p> : null}
        {configLoaded && !configured && !loading ? <p role="status">Notifications are not configured on this server yet.</p> : null}
        {permission === 'denied' ? <p role="status">Allow notifications in your browser or device settings before trying again.</p> : null}
        {error ? <p className="settings-error" role="alert">{error}</p> : null}
        {(error || (coordinated && !loading && configured && registered === null)) ? <button className="settings-reset" type="button" disabled={loading || busy} onClick={() => setReloadKey(value => value + 1)}>Retry notification status</button> : null}
        {notice ? <p role="status">{notice}</p> : null}
        <div className="settings-actions notification-actions">
          <button className="settings-save" type="button" disabled={!supported || !coordinated || !configured || loading || busy || registered === true || permission === 'denied' || (ios && !standalone)} onClick={enable}>Enable notifications</button>
          <button className="settings-reset" type="button" disabled={!supported || !coordinated || loading || busy || !registered} onClick={disable}>Disable on this device</button>
          <button className="settings-reset" type="button" disabled={!supported || !coordinated || !configured || loading || busy || !registered || permission !== 'granted'} onClick={test}>Send test notification</button>
        </div>
        <p className="settings-hint">A successful test request means the push service accepted it; your device may still delay or suppress delivery.</p>
        {detailAvailable ? <div className="settings-timetable-form">
          <h2 className="settings-section-title">Details on this device</h2>
          <p className="settings-hint">Lesson details and, with separate consent, event titles may appear on lock screens and connected watches. Displayed notifications cannot be recalled.</p>
          <p role="status">{detailEnabled ? 'Details enabled' : 'Details disabled'}</p>
          <button className="settings-save" type="button" disabled={busy || loading || !registered || detailEnabled || !bindingVersion.current}
            onClick={() => setDetails(true)}>Enable details on this device</button>
          <button className="settings-reset" type="button" disabled={busy || loading || !detailEnabled}
            onClick={() => setDetails(false)}>Disable details on this device</button>
        </div> : null}
        <MorningSummaryPanel userId={userId} organisationId={organisationId} />
      </div>
    </div>
  </main>;
}
