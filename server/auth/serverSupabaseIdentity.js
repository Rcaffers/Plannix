// Isolated Stage 3 identity adapter. No production module imports it.
import { createClient } from '@supabase/supabase-js';
import { mapSupabaseUser } from '../../src/utils/supabaseAuth.js';

const FLOW_SLOT = /-flow-([0-9a-f]{32})-code-verifier$/;
const PROFILE_COLUMNS = 'id, first_name, last_name, initials';
const timeoutError = () => new Error('Identity service unavailable.');
const credentialsError = () => Object.assign(new Error('Credentials were not accepted.'),
  { kind: 'credentials' });

export function createServerSupabaseIdentity({ url, publishableKey, secretKey,
  createClientImpl = createClient, fetchImpl = globalThis.fetch, timeoutMs = 7000 } = {}) {
  let providerOrigin;
  try { providerOrigin = new URL(url); } catch { throw timeoutError(); }
  if (!['https:','http:'].includes(providerOrigin.protocol)
    || (providerOrigin.protocol==='http:' && !['localhost','127.0.0.1'].includes(providerOrigin.hostname))
    || providerOrigin.username || providerOrigin.password || providerOrigin.pathname!=='/'
    || providerOrigin.search || providerOrigin.hash || !publishableKey || !secretKey
    || typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 100) {
    throw timeoutError();
  }

  function client({ onVerifier, initialVerifier, flowId, bearer } = {}) {
    const items = new Map();
    const storageKey = 'plannix-server-stage3';
    if (initialVerifier && flowId) items.set(`${storageKey}-flow-${flowId}-code-verifier`, initialVerifier);
    const storage = {
      getItem: async key => items.get(key) ?? null,
      setItem: async (key, value) => {
        const match = FLOW_SLOT.exec(key);
        if (match && onVerifier && typeof value === 'string') await onVerifier(match[1], value);
        items.set(key, value);
      },
      removeItem: async key => { items.delete(key); },
    };
    const boundedFetch = async (input, init = {}) => {
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
        return await fetchImpl(input, { ...init, signal, redirect: 'error' });
      } catch { throw timeoutError(); }
      finally { clearTimeout(deadline); }
    };
    return createClientImpl(url, publishableKey, {
      // SDK PKCE and updateUser require storage; this is a new, request-local
      // in-memory map for each operation, never browser or shared storage.
      auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
        flowType: 'pkce', storageKey, storage,
        experimental: { appendPkceFlowIdToRedirects: true } },
      global: { fetch: boundedFetch, headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} },
    });
  }

  async function confirmed(session, suppliedUser) {
    if (!session?.access_token || !session?.refresh_token) throw timeoutError();
    const result = await client().auth.getUser(session.access_token);
    const user = result?.data?.user;
    if (result?.error || !user?.id || user.id !== suppliedUser?.id || !user.email
      || !user.email_confirmed_at || user.is_anonymous) throw timeoutError();
    return user;
  }

  async function prepareOrdinary(session, suppliedUser) {
    const user = await confirmed(session, suppliedUser);
    const scoped = client({ bearer: session.access_token });
    const setup = await scoped.rpc('plannix_ensure_personal_organisation');
    if (setup.error || !setup.data) throw timeoutError();
    const profile = await scoped.from('plannix_users').select(PROFILE_COLUMNS).eq('id',user.id).maybeSingle();
    if (profile.error) throw timeoutError();
    return { user: mapSupabaseUser(user, profile.data), session };
  }

  return Object.freeze({
    async login({ email, password }) {
      const result = await client().auth.signInWithPassword({ email, password });
      if (result.error) throw Number(result.error.status) >= 500 ? timeoutError() : credentialsError();
      if (!result.data?.session) throw timeoutError();
      return prepareOrdinary(result.data.session, result.data.user);
    },
    async signup({ email, password, firstName, lastName, redirectTo, onVerifier }) {
      const result = await client({ onVerifier }).auth.signUp({ email, password,
        options: { data: { first_name: firstName, last_name: lastName }, emailRedirectTo: redirectTo } });
      if (result.error || !result.data?.user) throw timeoutError();
      if (!result.data.session) return { confirmationPending: true };
      return { confirmationPending: false, ...await prepareOrdinary(result.data.session, result.data.user) };
    },
    async sendRecovery({ email, redirectTo, onVerifier }) {
      const result = await client({ onVerifier }).auth.resetPasswordForEmail(email, { redirectTo });
      if (result.error) throw timeoutError();
      return { acknowledged: true };
    },
    async exchange({ code, flowId, verifier }) {
      const result = await client({ initialVerifier: verifier, flowId }).auth.exchangeCodeForSession(code, { flowId });
      if (result.error || !result.data?.session || !result.data?.user) throw timeoutError();
      if (result.data.redirectType === 'recovery') {
        const checked = await client().auth.getUser(result.data.session.access_token);
        if (checked.error || checked.data?.user?.id !== result.data.user.id) throw timeoutError();
        return { kind: 'recovery', userId: result.data.user.id, session: result.data.session };
      }
      return { kind: 'ordinary', ...await prepareOrdinary(result.data.session, result.data.user) };
    },
    async refresh({ refreshToken, expectedUserId }) {
      const result = await client().auth.refreshSession({ refresh_token: refreshToken });
      if (result.error || !result.data?.session) throw timeoutError();
      const user = await confirmed(result.data.session, result.data.user);
      if (user.id !== expectedUserId) throw timeoutError();
      return result.data.session;
    },
    async validateAccess({ accessToken, expectedUserId }) {
      const result = await client().auth.getUser(accessToken);
      if (result.error || result.data?.user?.id !== expectedUserId
        || !result.data?.user?.email_confirmed_at) throw timeoutError();
      return { userId: expectedUserId, email: result.data.user.email };
    },
    async updateRecoveryPassword({ accessToken, refreshToken, password, expectedUserId }) {
      const scoped = client();
      const verified = await scoped.auth.getUser(accessToken);
      if (verified.error || verified.data?.user?.id !== expectedUserId) throw timeoutError();
      const loaded = await scoped.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      if (loaded.error || loaded.data?.user?.id && loaded.data.user.id !== expectedUserId) throw timeoutError();
      const result = await scoped.auth.updateUser({ password });
      if (result.error || result.data?.user?.id !== expectedUserId) throw timeoutError();
      return { updated: true };
    },
    async deleteAccount({ userId, email, password }) {
      const verification = await client().auth.signInWithPassword({ email, password });
      if (verification.error || verification.data?.user?.id !== userId) throw timeoutError();
      const admin = createClientImpl(url, secretKey, { auth: { persistSession: false,
        autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch: async (input, init = {}) => {
          const controller = new AbortController();
          const deadline = setTimeout(() => controller.abort(), timeoutMs);
          try { return await fetchImpl(input, { ...init, signal: controller.signal, redirect: 'error' }); }
          catch { throw timeoutError(); } finally { clearTimeout(deadline); }
        } } });
      const deleted = await admin.auth.admin.deleteUser(userId, false);
      if (deleted.error) throw timeoutError();
      return { deleted: true };
    },
  });
}
