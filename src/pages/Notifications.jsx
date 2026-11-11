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
  const [detailPolicyEnabled, setDetailPolicyEnabled] = useState(null);
  const [detailSelectorCurrent, setDetailSelectorCurrent] = useState(null);
  const [bindingCurrent, setBindingCurrent] = useState(false);
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
      generation.current++;
      busyRef.current = null;
      bindingVersion.current = null;
      setBindingCurrent(false);
      setDetailEnabled(false);
      setDetailPolicyEnabled(null);
      setDetailSelectorCurrent(null);
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
    let context = null;
    const isCurrent = () => {
      if (ticket !== generation.current) return false;
      if (context) { try { assertServerOperationContext(context); } catch { return false; } }
      return true;
    };
    busyRef.current = null; setBusy(false);
    setLoading(true); setRegistered(null); setConfigured(false); setConfigLoaded(false); setError(''); setNotice('');
    setDetailAvailable(false); setDetailEnabled(false); bindingVersion.current = null;
    setDetailPolicyEnabled(null); setDetailSelectorCurrent(null);
    setBindingCurrent(false);
    if (!supported || !coordinated || !userId) { setLoading(false); return () => { generation.current++; busyRef.current = null; }; }
    (async () => {
      try {
        context = serverManagedAuth ? captureServerOperationContext(userId) : null;
        const config = await pushRequest('config', undefined,
          { expectedUserId: userId, operationContext:context });
        if (!isCurrent()) return;
        publicKey.current = config?.publicKey || null;
        setConfigLoaded(true);
        setConfigured(config?.configured === true && Boolean(publicKey.current));
        setDetailAvailable(serverManagedAuth && config?.detailDisplayAvailable === true);
        await withPushDeviceLock(async () => {
          if (!isCurrent()) return;
          const subscription = await currentPushSubscription();
          if (!isCurrent()) return;
          if (!subscription) { if (isCurrent()) { setRegistered(false);
            setDetailPolicyEnabled(null); setDetailSelectorCurrent(null); } return; }
          if (config?.configured !== true) return;
          const status = await pushRequest('status', { endpoint: subscription.endpoint },
            { expectedUserId: userId, operationContext:context });
          if (!isCurrent()) return;
          if (typeof status?.registered !== 'boolean') throw new Error('Invalid device status.');
          if (isCurrent()) {
            setRegistered(status.registered === true ? true : null);
            bindingVersion.current = status.boundToCurrentSession === true && UUID.test(status.version || '')
              ? status.version : null;
            setBindingCurrent(Boolean(bindingVersion.current));
            if (!bindingVersion.current) { setDetailPolicyEnabled(null); setDetailSelectorCurrent(null); }
            if (config?.detailDisplayAvailable === true && bindingVersion.current) {
              const policy = await pushRequest('detail-policy/status', {
                endpoint:subscription.endpoint, installationVersion:bindingVersion.current,
              }, { expectedUserId:userId, operationContext:context });
              if (!isCurrent()) return;
              if (typeof policy?.enabled !== 'boolean' || !UUID.test(policy.policyVersion || ''))
                throw new Error('Invalid device detail policy.');
              if (isCurrent() && context) {
                const stored = await observeDetailSelector().catch(() => null);
                if (isCurrent()) {
                  const selectorCurrent = stored ? stored?.selector?.sessionName === context.sessionName
                    && stored.selector.installationVersion === bindingVersion.current
                    && stored.selector.policyVersion === policy.policyVersion : null;
                  setDetailPolicyEnabled(policy.enabled);
                  setDetailSelectorCurrent(selectorCurrent);
                  setDetailEnabled(policy.enabled && selectorCurrent === true);
                }
              }
            }
          }
        });
      } catch {
        if (isCurrent()) setError('Could not load notification settings. Please retry.');
      } finally { if (isCurrent()) setLoading(false); }
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

  async function performDetailAction(context, task) {
    if (busyRef.current !== null) throw new Error('Another device action is in progress. Please try again.');
    assertServerOperationContext(context);
    const ticket = generation.current;
    busyRef.current = ticket; setBusy(true);
    try { return await task(ticket); }
    finally {
      if (busyRef.current === ticket) { busyRef.current = null; setBusy(false); }
    }
  }

  const assertDetailAction = (context, ticket) => {
    assertServerOperationContext(context);
    if (ticket !== generation.current) throw new DOMException('Account changed.', 'AbortError');
  };

  async function readDetailPolicy(context, ticket) {
    return withPushDeviceLock(async () => {
      assertDetailAction(context,ticket);
      const subscription = await currentPushSubscription();
      assertDetailAction(context,ticket);
      if (!subscription) {
        bindingVersion.current = null; setBindingCurrent(false); setRegistered(false); setDetailEnabled(false);
        setDetailPolicyEnabled(null); setDetailSelectorCurrent(null);
        return { subscribed:false, bound:false, enabled:false, serverEnabled:false };
      }
      const status = await pushRequest('status', { endpoint:subscription.endpoint },
        { expectedUserId:userId, operationContext:context });
      assertDetailAction(context,ticket);
      setRegistered(status.registered === true ? true : status.registered === false ? false : null);
      if (status.boundToCurrentSession !== true || !UUID.test(status.version || '')) {
        bindingVersion.current = null; setBindingCurrent(false); setDetailEnabled(false);
        setDetailPolicyEnabled(null); setDetailSelectorCurrent(null);
        return { subscribed:status.registered === true, bound:false, enabled:false, serverEnabled:false };
      }
      bindingVersion.current = status.version;
      setBindingCurrent(true);
      if (!detailAvailable) { setDetailEnabled(false); setDetailPolicyEnabled(null); setDetailSelectorCurrent(null);
        return { subscribed:true, bound:true, enabled:false, serverEnabled:false }; }
      const policy = await pushRequest('detail-policy/status', {
        endpoint:subscription.endpoint, installationVersion:status.version,
      }, { expectedUserId:userId, operationContext:context });
      if (typeof policy?.enabled !== 'boolean' || !UUID.test(policy.policyVersion || ''))
        throw new Error('Invalid device detail policy.');
      const selector = await observeDetailSelector().catch(() => null);
      assertDetailAction(context,ticket);
      const selectorCurrent = selector ? selector?.selector?.sessionName === context.sessionName
        && selector.selector.installationVersion === status.version
        && selector.selector.policyVersion === policy.policyVersion : null;
      const enabled = policy.enabled && selectorCurrent === true;
      setDetailPolicyEnabled(policy.enabled);
      setDetailSelectorCurrent(selectorCurrent);
      setDetailEnabled(enabled);
      return { subscribed:true, bound:true, enabled, serverEnabled:policy.enabled === true };
    });
  }

  async function changeDetailPolicy(enabled, context, ticket) {
    const version = bindingVersion.current;
    if (!detailAvailable || !UUID.test(version || ''))
      throw new Error('Reconnect notifications on this device before enabling details.');
    return withPushDeviceLock(async () => {
      assertDetailAction(context,ticket);
      if (version !== bindingVersion.current) throw new DOMException('Device binding changed.', 'AbortError');
      const selector = enabled ? await observeDetailSelector() : null;
      const subscription = await currentPushSubscription();
      assertDetailAction(context,ticket);
      if (!subscription) throw new Error('This device is no longer subscribed. Reconnect notifications.');
      if (!enabled) await invalidateDetailSelector().catch(() => {});
      const policy = await pushRequest('detail-policy/status', {
        endpoint:subscription.endpoint, installationVersion:version,
      }, { expectedUserId:userId, operationContext:context });
      assertDetailAction(context,ticket);
      if (version !== bindingVersion.current) throw new DOMException('Device binding changed.', 'AbortError');
      const saved = await pushRequest('detail-policy/set', {
        endpoint:subscription.endpoint, installationVersion:version,
        policyVersion:policy.policyVersion, enabled,
      }, { expectedUserId:userId, operationContext:context });
      assertDetailAction(context,ticket);
      if (version !== bindingVersion.current) throw new DOMException('Device binding changed.', 'AbortError');
      if (enabled) await commitDetailSelector({ expectedEpoch:selector.epoch,
        sessionName:context.sessionName, installationVersion:version,
        policyVersion:saved.policyVersion });
    });
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
      if (serverManagedAuth && ticket === generation.current) {
        bindingVersion.current = committed.version; setBindingCurrent(true);
        setDetailEnabled(false); setDetailPolicyEnabled(null); setDetailSelectorCurrent(null);
      }
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
    setDetailEnabled(false); setDetailPolicyEnabled(null); setDetailSelectorCurrent(null);
    bindingVersion.current = null; setBindingCurrent(false);
    setNotice(result?.state === 'absent'
      ? 'This account has no registered notification subscription on this device.'
      : 'Notifications are disabled on this device.');
  });
  const test = () => run(async (ticket, context) => {
    await withPushDeviceLock(async () => {
      if (context) assertServerOperationContext(context);
      if (ticket !== generation.current) return;
      const subscription = await currentPushSubscription();
      if (ticket !== generation.current) return;
      if (!subscription) { setRegistered(false); setDetailEnabled(false);
        setDetailPolicyEnabled(null); setDetailSelectorCurrent(null);
        throw new Error('This device is no longer subscribed. Enable notifications again.'); }
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
        <MorningSummaryPanel userId={userId} organisationId={organisationId}
          detailDevice={serverManagedAuth ? {
            available:detailAvailable, registered, bound:bindingCurrent,
            enabled:detailEnabled, policyEnabled:detailPolicyEnabled,
            selectorCurrent:detailSelectorCurrent, loading, busy,
            perform:performDetailAction, read:readDetailPolicy, setPolicy:changeDetailPolicy,
          } : null} />
      </div>
    </div>
  </main>;
}
