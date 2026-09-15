import {
  SupabaseAuthError,
  createSupabaseAuthAdapter,
  mapSupabaseUser,
} from './supabaseAuth.js';

const SETUP_ERROR = 'We could not finish setting up your account. Please try again or contact support.';

export class PublicAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PublicAuthError';
  }
}

function publicMessage(error, operation) {
  const code = String(error?.code || '').toLowerCase();
  if (operation === 'login') {
    if (code === 'email_not_confirmed') return 'Please confirm your email before logging in.';
    return 'Unable to log in with those details.';
  }
  if (operation === 'signup') return 'Unable to create your account. Please try again.';
  return SETUP_ERROR;
}

export function privateRouteState({ isAuthLoading, user }) {
  if (isAuthLoading) return 'loading';
  return user ? 'private' : 'public';
}

export function createSupabaseAuthController({
  auth = createSupabaseAuthAdapter(),
  schedule = (task) => queueMicrotask(task),
} = {}) {
  let activeSetup = null;
  let ready = null;
  let authGeneration = 0;
  const recoveryTokens = new Set();

  async function signOutAfterFailure() {
    ready = null;
    try { await auth.logout(); } catch { /* access remains denied locally */ }
  }

  async function establish(session) {
    const token = session?.access_token;
    const setupKey = session?.user?.id || token;
    if (!token) throw new PublicAuthError(SETUP_ERROR);
    if (recoveryTokens.has(token)) throw new PublicAuthError(SETUP_ERROR);
    if (ready?.token === token) return ready.user;
    if (activeSetup?.key === setupKey) return activeSetup.promise;
    const generation = authGeneration;

    const promise = (async () => {
      try {
        const validatedUser = await auth.getValidatedCurrentUser(token);
        if (!validatedUser?.id) throw new SupabaseAuthError('Invalid session.');
        const initialProfile = await auth.loadProfile(validatedUser);
        if (!initialProfile) throw new SupabaseAuthError('Profile unavailable.');
        if (generation !== authGeneration || recoveryTokens.has(token)) {
          throw new SupabaseAuthError('Recovery sessions cannot access the application.');
        }
        await auth.ensurePersonalOrganisation();
        const profile = await auth.loadProfile(validatedUser);
        if (!profile) throw new SupabaseAuthError('Profile unavailable.');
        if (generation !== authGeneration) throw new SupabaseAuthError('Session changed.');
        const user = mapSupabaseUser(validatedUser, profile);
        ready = { token, user };
        return user;
      } catch {
        await signOutAfterFailure();
        throw new PublicAuthError(SETUP_ERROR);
      } finally {
        if (activeSetup?.key === setupKey) activeSetup = null;
      }
    })();
    activeSetup = { key: setupKey, promise };
    return promise;
  }

  return {
    async signup(input) {
      try {
        const result = await auth.signup(input);
        if (!result.authenticated || !result.session) {
          if (!result.confirmationPending) throw new SupabaseAuthError('Signup did not create a user.');
          return { authenticated: false, confirmationPending: true, user: null };
        }
        return { authenticated: true, confirmationPending: false, user: await establish(result.session) };
      } catch (error) {
        if (error instanceof PublicAuthError) throw error;
        throw new PublicAuthError(publicMessage(error, 'signup'));
      }
    },

    async login(input) {
      let result;
      try { result = await auth.login(input); } catch (error) {
        throw new PublicAuthError(publicMessage(error, 'login'));
      }
      return establish(result.session);
    },

    async restoreSession() {
      try {
        const session = await auth.getCurrentSession();
        if (!session) return null;
        return await establish(session);
      } catch (error) {
        if (!(error instanceof PublicAuthError)) await signOutAfterFailure();
        return null;
      }
    },

    subscribe({ onUser, onSignedOut, onError }) {
      let active = true;
      let publishedToken = null;
      const cleanup = auth.subscribeToAuthChanges(({ event, session }) => {
        if (event === 'PASSWORD_RECOVERY') {
          if (session?.access_token) recoveryTokens.add(session.access_token);
          authGeneration += 1;
          ready = null;
          schedule(() => { if (active) onSignedOut?.(); });
          return;
        }
        schedule(() => {
          if (!active) return;
          if (event === 'SIGNED_OUT') {
            authGeneration += 1;
            ready = null;
            publishedToken = null;
            onSignedOut?.();
            return;
          }
          if (!session) return;
          establish(session).then(
            (user) => {
              if (active && publishedToken !== session.access_token) {
                publishedToken = session.access_token;
                onUser?.(user);
              }
            },
            (error) => { if (active) onError?.(error); },
          );
        });
      });
      return () => { active = false; cleanup?.(); };
    },

    async logout() {
      authGeneration += 1;
      try { await auth.logout(); } finally { ready = null; }
    },

    getCurrentSession() {
      return auth.getCurrentSession();
    },

    async clearAfterAccountDeletion() {
      authGeneration += 1;
      ready = null;
      try {
        if (typeof auth.logoutLocal === 'function') await auth.logoutLocal();
        else await auth.logout();
      } catch { /* Local application access is already cleared. */ }
    },
  };
}
