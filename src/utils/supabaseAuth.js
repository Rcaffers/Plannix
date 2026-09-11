import { getSupabaseClient } from '../lib/supabase.js';

const PROFILE_COLUMNS = 'id, first_name, last_name, initials';

export class SupabaseAuthError extends Error {
  constructor(message, { code = '', status = null } = {}) {
    super(message);
    this.name = 'SupabaseAuthError';
    this.code = code;
    this.status = status;
  }
}

function authError(error, fallback) {
  return new SupabaseAuthError(String(error?.message || '').trim() || fallback, {
    code: String(error?.code || ''),
    status: Number.isInteger(error?.status) ? error.status : null,
  });
}

export function normalizeAuthEmail(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

export function applicationUrl(pathname, locationLike = globalThis.location) {
  let url;
  try {
    url = new URL(String(locationLike?.origin || '').trim());
  } catch {
    throw new SupabaseAuthError('The application URL is not available.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new SupabaseAuthError('The application URL must use HTTP or HTTPS.');
  }
  const safePath = `/${String(pathname || '').replace(/^\/+/, '')}`;
  return new URL(safePath, `${url.origin}/`).toString();
}

function clean(value) {
  return String(value || '').trim();
}

function metadataNames(authUser) {
  const metadata = authUser?.user_metadata || {};
  const fullName = clean(metadata.full_name || metadata.name);
  const [fullFirstName = '', ...fullLastNameParts] = fullName.split(/\s+/).filter(Boolean);
  const firstName = clean(metadata.first_name) || fullFirstName;
  const lastName = clean(metadata.last_name) || fullLastNameParts.join(' ');
  return { firstName, lastName, fullName };
}

export function mapSupabaseUser(authUser, profile = null) {
  if (!authUser) return null;
  const metadata = metadataNames(authUser);
  const firstName = clean(profile?.first_name) || metadata.firstName;
  const lastName = clean(profile?.last_name) || metadata.lastName;
  const email = normalizeAuthEmail(authUser.email);
  const name = [firstName, lastName].filter(Boolean).join(' ') || metadata.fullName || email || 'Account';
  const suppliedInitials = clean(profile?.initials || authUser.user_metadata?.initials);
  const initials =
    suppliedInitials ||
    `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() ||
    email.charAt(0).toUpperCase();

  return {
    id: String(authUser.id || ''),
    name,
    email,
    firstName,
    lastName,
    initials,
  };
}

export function createSupabaseAuthAdapter({
  client = getSupabaseClient(),
  location = globalThis.location,
} = {}) {
  const recoveryAccessTokens = new Set();

  async function loadProfile(authUser) {
    if (!authUser?.id) return null;
    const { data, error } = await client
      .from('plannix_users')
      .select(PROFILE_COLUMNS)
      .eq('id', authUser.id)
      .maybeSingle();
    if (error) throw authError(error, 'Unable to load your Plannix profile.');
    return data || null;
  }

  async function mappedUser(authUser) {
    if (!authUser) return null;
    return mapSupabaseUser(authUser, await loadProfile(authUser));
  }

  return {
    async signup({ firstName, lastName, email, password }) {
      const normalizedFirstName = clean(firstName);
      const normalizedLastName = clean(lastName);
      const normalizedEmail = normalizeAuthEmail(email);
      const preservedPassword = String(password || '');
      if (!normalizedFirstName || !normalizedLastName || !normalizedEmail || !preservedPassword) {
        throw new SupabaseAuthError('First name, last name, email, and password are required.');
      }
      const { data, error } = await client.auth.signUp({
        email: normalizedEmail,
        password: preservedPassword,
        options: {
          data: { first_name: normalizedFirstName, last_name: normalizedLastName },
          emailRedirectTo: applicationUrl('/', location),
        },
      });
      if (error) throw authError(error, 'Unable to create your account.');
      const authenticated = Boolean(data?.session);
      return {
        authenticated,
        confirmationPending: Boolean(data?.user) && !authenticated,
        session: data?.session || null,
        user: authenticated ? await mappedUser(data.user) : null,
        pendingUser: !authenticated && data?.user ? mapSupabaseUser(data.user) : null,
      };
    },

    async login({ email, password }) {
      const normalizedEmail = normalizeAuthEmail(email);
      const preservedPassword = String(password || '');
      if (!normalizedEmail || !preservedPassword) {
        throw new SupabaseAuthError('Email and password are required.');
      }
      const { data, error } = await client.auth.signInWithPassword({
        email: normalizedEmail,
        password: preservedPassword,
      });
      if (error) throw authError(error, 'Unable to log in.');
      return { session: data?.session || null, user: await mappedUser(data?.user) };
    },

    async getCurrentSession() {
      const { data, error } = await client.auth.getSession();
      if (error) throw authError(error, 'Unable to restore your session.');
      return data?.session || null;
    },

    async getValidatedCurrentUser(accessToken) {
      const result = accessToken ? await client.auth.getUser(accessToken) : await client.auth.getUser();
      if (result.error) throw authError(result.error, 'Unable to validate your session.');
      return mappedUser(result.data?.user);
    },

    subscribeToAuthChanges(callback) {
      const { data } = client.auth.onAuthStateChange(async (event, session) => {
        if (event === 'PASSWORD_RECOVERY' && session?.access_token) {
          recoveryAccessTokens.add(session.access_token);
        }
        callback({
          event,
          session: session || null,
          user: session?.user ? await mappedUser(session.user) : null,
        });
      });
      return () => data?.subscription?.unsubscribe();
    },

    async logout() {
      const { error } = await client.auth.signOut();
      if (error) throw authError(error, 'Unable to log out.');
    },

    async sendPasswordRecovery(email) {
      const normalizedEmail = normalizeAuthEmail(email);
      if (!normalizedEmail) throw new SupabaseAuthError('Email is required.');
      const { error } = await client.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: applicationUrl('/reset-password', location),
      });
      if (error) throw authError(error, 'Unable to send a password recovery email.');
    },

    async updatePasswordDuringRecovery(password) {
      const preservedPassword = String(password || '');
      if (!preservedPassword) throw new SupabaseAuthError('Password is required.');
      const { data, error } = await client.auth.getSession();
      if (error) throw authError(error, 'Unable to validate the recovery session.');
      const session = data?.session;
      if (!session?.access_token || !recoveryAccessTokens.has(session.access_token)) {
        throw new SupabaseAuthError('A password recovery session is required.');
      }
      const result = await client.auth.updateUser({ password: preservedPassword });
      if (result.error) throw authError(result.error, 'Unable to update your password.');
      recoveryAccessTokens.delete(session.access_token);
      return mapSupabaseUser(result.data?.user);
    },

    loadProfile,
  };
}
