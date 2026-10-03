import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import SettingsSubnav from '../components/SettingsSubnav';
import MorningSummaryPanel from '../components/MorningSummaryPanel.jsx';
import { currentPushSubscription, disableCurrentDevice, pushRequest, pushSupport, reconcilePushAccount, vapidBytes, waitForPushAccountReconciliation } from '../utils/pushNotifications';
import { pushCoordinationSupported, PUSH_LOCK_UNAVAILABLE, withPushDeviceLock } from '../utils/pushDeviceLock';
import './Settings.css';

export default function Notifications({ userId, organisationId }) {
  const [configured, setConfigured] = useState(false);
  const [registered, setRegistered] = useState(null);
  const [loading, setLoading] = useState(true);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [permission, setPermission] = useState(globalThis.Notification?.permission || 'unavailable');
  const [reloadKey, setReloadKey] = useState(0);
  const publicKey = useRef(null);
  const generation = useRef(0);
  const busyRef = useRef(null);
  const supported = pushSupport();
  const coordinated = pushCoordinationSupported();
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;

  useEffect(() => {
    const ticket = ++generation.current;
    busyRef.current = null; setBusy(false);
    setLoading(true); setRegistered(null); setConfigured(false); setConfigLoaded(false); setError(''); setNotice('');
    if (!supported || !coordinated || !userId) { setLoading(false); return () => { generation.current++; busyRef.current = null; }; }
    (async () => {
      try {
        const config = await pushRequest('config', undefined, { expectedUserId: userId });
        if (ticket !== generation.current) return;
        publicKey.current = config?.publicKey || null;
        setConfigLoaded(true);
        setConfigured(config?.configured === true && Boolean(publicKey.current));
        await withPushDeviceLock(async () => {
          if (ticket !== generation.current) return;
          const subscription = await currentPushSubscription();
          if (!subscription) { if (ticket === generation.current) setRegistered(false); return; }
          if (config?.configured !== true) return;
          const status = await pushRequest('status', { endpoint: subscription.endpoint }, { expectedUserId: userId });
          if (typeof status?.registered !== 'boolean') throw new Error('Invalid device status.');
          if (ticket === generation.current) setRegistered(status.registered === true ? true : null);
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
    try { await operation(ticket); }
    catch (caught) { if (ticket === generation.current) setError(caught?.message || 'Notification action failed.'); }
    finally {
      if (busyRef.current === ticket) { busyRef.current = null; setPermission(globalThis.Notification?.permission || 'unavailable'); setBusy(false); }
    }
  }

  const enable = () => run(async (ticket) => {
    await waitForPushAccountReconciliation();
    if (ticket !== generation.current) return;
    if (!configured || !publicKey.current) throw new Error('Notifications are not configured.');
    const result = await Notification.requestPermission();
    if (ticket !== generation.current) return;
    setPermission(result);
    if (result !== 'granted') throw new Error(result === 'denied'
      ? 'Notifications are blocked in your browser settings.' : 'Notification permission was not granted.');
    await withPushDeviceLock(async () => {
      if (ticket !== generation.current) return;
      const registration = await navigator.serviceWorker.register('/push-sw.js', { scope: '/' });
      if (ticket !== generation.current) return;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: vapidBytes(publicKey.current),
      });
      if (ticket !== generation.current) return;
      const details = subscription.toJSON();
      await pushRequest('register', { subscription: { endpoint: details.endpoint, keys: details.keys } }, { expectedUserId: userId });
    });
    if (ticket !== generation.current) { void reconcilePushAccount().catch(() => {}); return; }
    setRegistered(true);
    setNotice('Notifications are enabled on this device.');
  });
  const disable = () => run(async (ticket) => {
    const result = await disableCurrentDevice({ expectedUserId: userId,
      isCurrent: () => generation.current === ticket });
    if (ticket !== generation.current) return;
    setRegistered(false);
    setNotice(result?.state === 'absent'
      ? 'This account has no registered notification subscription on this device.'
      : 'Notifications are disabled on this device.');
  });
  const test = () => run(async (ticket) => {
    await withPushDeviceLock(async () => {
      if (ticket !== generation.current) return;
      const subscription = await currentPushSubscription();
      if (ticket !== generation.current) return;
      if (!subscription) { setRegistered(false); throw new Error('This device is no longer subscribed. Enable notifications again.'); }
      try { await pushRequest('test', { endpoint: subscription.endpoint }, { expectedUserId: userId }); }
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
        <MorningSummaryPanel userId={userId} organisationId={organisationId} />
      </div>
    </div>
  </main>;
}
