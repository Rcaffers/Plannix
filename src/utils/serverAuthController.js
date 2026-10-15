import { bootstrapServerSession, notifyServerSessionChange, serverAuthFetch,
  serverAuthJson, serverManagedAuth, serverSessionGeneration, serverSessionStatus,
  setServerSessionContext, invalidateServerSessionContext,
  assertServerOperationContext, captureServerOperationContext } from './serverAuthTransport.js';
import { authTestOperationId, observeAuthTestOperation } from './serverAuthTestObserver.js';

const AUTH_PATH = '/__stage3/auth';
const unavailable = () => new Error('Your session could not be confirmed. Please try again.');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const changed = () => new DOMException('Account changed.', 'AbortError');
const stale = () => ({ state:'stale' });
const signedOut = () => ({ state:'signed-out' });
const authenticated = user => ({ state:'authenticated', user });
const verificationFailure = error => ({ state:'verification-failure', error });
function publicUser(value, expectedId) {
  if (!value || typeof value!=='object' || Array.isArray(value)
    || value.id!==expectedId || !UUID.test(String(value.id))
    || !UUID.test(String(value.organisationId))
    || !['name','email','firstName','lastName','initials'].every(key=>
      typeof value[key]==='string' && value[key].length<=300)) throw unavailable();
  return {id:value.id,organisationId:value.organisationId,name:value.name,
    email:value.email,firstName:value.firstName,lastName:value.lastName,
    initials:value.initials};
}

export function createServerAuthController() {
  if (!serverManagedAuth) throw new Error('Server-managed authentication is disabled.');
  let current = null;
  let sessionName = null;
  let pendingContext = null;
  let restoreGeneration = 0;
  let currentGeneration = -1;

  async function readCurrentInternal({ bootstrap = false, signal, onContextChange,
    verificationPurpose, testOperationId } = {}) {
    const local = ++restoreGeneration;
    let transport = serverSessionGeneration();
    const superseded = () => signal?.aborted || local !== restoreGeneration
      || transport !== serverSessionGeneration();
    try {
      if (bootstrap) await bootstrapServerSession(fetch,{ signal });
      if (superseded()) return stale();
      let status;
      try { status = await serverSessionStatus(fetch,{ signal, allowTransition:true,
        verificationPurpose, testOperationId }); }
      catch (error) {
        if (superseded()) return stale();
        if (!bootstrap) throw error;
        if (superseded()) return stale();
        // An expired provider access token may still have a server-held refresh token.
        await serverAuthJson(`${AUTH_PATH}/refresh`, { method:'POST',
          headers:{'Content-Type':'application/json'}, body:'{}', signal });
        if (superseded()) return stale();
        status = await serverSessionStatus(fetch,{ signal, allowTransition:true,
          verificationPurpose, testOperationId });
      }
      if (superseded()) return stale();
      if (sessionName && (!status.authenticated || status.sessionName !== sessionName)) {
        transport = invalidateServerSessionContext();
        onContextChange?.();
      }
      if (!status.authenticated) {
        current = null; sessionName = null; currentGeneration = -1;
        pendingContext = null;
        setServerSessionContext(null);
        return signedOut();
      }
      if (typeof status.sessionName !== 'string' || !/^__Host-plannix-s-[1-9]\d{0,15}$/.test(status.sessionName)) {
        throw unavailable();
      }
      const data = await serverAuthJson(`${AUTH_PATH}/me`,{ signal });
      if (superseded()) return stale();
      current = publicUser(data?.user,status.userId);
      sessionName = status.sessionName;
      pendingContext = { sessionName, csrfToken:status.csrfToken, userId:current.id };
      currentGeneration = transport;
      return authenticated(current);
    } catch (error) {
      return superseded() || error?.name === 'AbortError'
        ? stale() : verificationFailure(error);
    }
  }

  function readCurrent(options = {}) {
    const observedId = options.testOperationId || authTestOperationId();
    if (!observedId) return readCurrentInternal(options);
    return readCurrentInternal({ ...options, testOperationId:observedId }).then(
      result => { observeAuthTestOperation({ kind:'session-read-terminal',
        id:observedId, outcome:result.state }); return result; },
      error => { observeAuthTestOperation({ kind:'session-read-terminal',
        id:observedId, outcome:'error' }); throw error; });
  }

  async function mutate(path, body, operationContext) {
    const result = await serverAuthJson(`${AUTH_PATH}${path}`, { method:'POST',
      headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) },
    { unauthenticated: path === '/login' || path === '/signup', operationContext });
    return result;
  }

  return Object.freeze({
    async signup(input) {
      await bootstrapServerSession();
      const result = await mutate('/signup', input);
      if (result?.confirmationPending) return { authenticated:false, confirmationPending:true, user:null };
      const resultAfter = await readCurrent();
      if (resultAfter.state !== 'authenticated') throw resultAfter.error || unavailable();
      notifyServerSessionChange();
      currentGeneration = serverSessionGeneration();
      return { authenticated:true, confirmationPending:false, user:resultAfter.user };
    },
    async login(input) {
      await bootstrapServerSession();
      await mutate('/login', input);
      const resultAfter = await readCurrent();
      if (resultAfter.state !== 'authenticated') throw resultAfter.error || unavailable();
      notifyServerSessionChange();
      currentGeneration = serverSessionGeneration();
      return resultAfter.user;
    },
    async restoreSession() {
      return readCurrent({ bootstrap:true });
    },
    async verifyProfileEntry({ signal, testOperationId } = {}) {
      return readCurrent({ signal, verificationPurpose:'profile-entry', testOperationId });
    },
    currentSessionName() { return sessionName; },
    activateDisplayedSession(userId) {
      if (!pendingContext || pendingContext.userId !== userId
        || sessionName !== pendingContext.sessionName) return false;
      setServerSessionContext(pendingContext.sessionName,pendingContext.csrfToken,userId);
      return true;
    },
    isSignedOut() { return !current && !sessionName; },
    subscribe({ onUser, onSignedOut, onError, onPending }) {
      let active = true;
      let pendingVerification = false;
      const changed = (event) => {
        const observedId = authTestOperationId();
        const suspend = () => { pendingVerification = true; onPending?.(); };
        if (event?.type !== 'focus') suspend();
        void readCurrent({ bootstrap:true, onContextChange:suspend,
          testOperationId:observedId }).then(result => {
          let outcome = 'ignored';
          try {
            if (!active) return;
            if (result.state === 'authenticated') {
              pendingVerification = false; onUser?.(result.user); outcome = 'authenticated';
            } else if (result.state === 'signed-out') {
              pendingVerification = false; onSignedOut?.(); outcome = 'signed-out';
            } else if (result.state === 'verification-failure' && (pendingVerification || !current)) {
              setServerSessionContext(null);
              onError?.(result.error);
              outcome = 'verification-failure';
            }
          } catch (error) {
            outcome = 'callback-error';
            throw error;
          } finally {
            observeAuthTestOperation({ kind:'subscription-terminal', id:observedId, outcome });
          }
        }); };
      globalThis.addEventListener?.('plannix-server-session-change', changed);
      globalThis.addEventListener?.('plannix-server-session-mismatch', changed);
      globalThis.addEventListener?.('focus', changed);
      return () => { active = false;
        globalThis.removeEventListener?.('plannix-server-session-change', changed);
        globalThis.removeEventListener?.('plannix-server-session-mismatch', changed);
        globalThis.removeEventListener?.('focus', changed); };
    },
    async logout({ expectedUserId, operationContext } = {}) {
      if (operationContext) assertServerOperationContext(operationContext);
      if (!sessionName || !current || (expectedUserId && current.id !== expectedUserId))
        throw unavailable();
      const capturedName=sessionName;
      const capturedUser=current.id;
      if (operationContext && (operationContext.sessionName !== capturedName
        || operationContext.userId !== capturedUser)) throw changed();
      await mutate('/logout',{ expectedSessionName:capturedName },operationContext);
      const authoritative=await serverSessionStatus(fetch,{allowTransition:true});
      if (authoritative.authenticated && authoritative.sessionName!==capturedName) {
        notifyServerSessionChange();
        return false;
      }
      if (authoritative.authenticated) throw unavailable();
      if (sessionName!==capturedName || current?.id!==capturedUser) return false;
      current = null; sessionName = null; currentGeneration = -1;
      pendingContext = null;
      setServerSessionContext(null);
      notifyServerSessionChange();
      return true;
    },
    async getCurrentSession({ verifyLocal = true, signal, testOperationId } = {}) {
      if (verifyLocal && (!current || !sessionName)) return null;
      const status=await serverSessionStatus(fetch,{ signal,
        verificationPurpose:verifyLocal ? 'deletion-initial' : 'deletion-reconcile',
        testOperationId });
      if (!status.authenticated) return null;
      if (verifyLocal && (status.userId!==current.id
        || status.sessionName!==sessionName)) throw unavailable();
      return { serverManaged:true, sessionName:status.sessionName,
        userId:status.userId, generation:serverSessionGeneration() };
    },
    async updateProfileName(input) {
      const operationContext = captureServerOperationContext(current?.id);
      if (!current) throw unavailable();
      const capturedName=sessionName;
      const capturedUser=current.id;
      const result = await serverAuthJson(`${AUTH_PATH}/profile/name`, { method:'PUT',
        headers:{'Content-Type':'application/json'}, body:JSON.stringify(input) },
      { operationContext });
      if (sessionName!==capturedName || current?.id!==capturedUser) throw changed();
      if (result?.user?.id !== current.id || !['name','firstName','lastName','initials']
        .every(key=>typeof result.user[key]==='string' && result.user[key].length<=300))
        throw unavailable();
      current = { ...current, name:result.user.name,
        firstName:result.user.firstName,lastName:result.user.lastName,
        initials:result.user.initials };
      return current;
    },
    async updateEmail(email) {
      const operationContext = captureServerOperationContext(current?.id);
      if (!current) throw unavailable();
      const capturedName=sessionName;
      const capturedUser=current.id;
      const result = await mutate('/profile/email',{ email },operationContext);
      if (sessionName!==capturedName || current?.id!==capturedUser) throw changed();
      if (result?.confirmationPending) return { confirmationPending:true, user:current };
      const resultAfter = await readCurrent();
      if (resultAfter.state !== 'authenticated') throw resultAfter.error || unavailable();
      notifyServerSessionChange();
      currentGeneration = serverSessionGeneration();
      return { confirmationPending:false, user:resultAfter.user };
    },
    async updatePassword({ currentPassword, newPassword }) {
      const operationContext = captureServerOperationContext(current?.id);
      if (!current) throw unavailable();
      const capturedName=sessionName;
      const capturedUser=current.id;
      const response = await serverAuthFetch(`${AUTH_PATH}/profile/password`, { method:'POST',
        headers:{'Content-Type':'application/json'}, body:JSON.stringify({ currentPassword,newPassword }) },
      { operationContext });
      if (sessionName!==capturedName || current?.id!==capturedUser) throw changed();
      if (!response.ok) {
        if (response.status===403) throw new Error('Your current password is incorrect.');
        const payload=await response.json().catch(()=>null);
        if (response.status===503 && payload?.message===
          'Password update could not be confirmed. Try signing in or using password recovery.') {
          throw new Error(payload.message);
        }
        throw unavailable();
      }
    },
    async clearAfterAccountDeletion(expectedSessionName) {
      if (expectedSessionName && sessionName!==expectedSessionName) return false;
      current = null; sessionName = null; currentGeneration = -1;
      pendingContext = null;
      setServerSessionContext(null);
      notifyServerSessionChange();
      return true;
    },
    isCurrentSessionVersion(expectedSessionName, expectedUserId, expectedGeneration) {
      return !!current && sessionName === expectedSessionName
        && current.id === expectedUserId
        && serverSessionGeneration() === expectedGeneration;
    },
    isCurrentUser(user) {
      return !!user && current?.id === user.id
        && currentGeneration === serverSessionGeneration();
    },
  });
}
