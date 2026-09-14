import { createClient } from '@supabase/supabase-js';
import { env, requireSupabasePublicConfig } from '../config/env.js';

const SERVER_AUTH_OPTIONS = Object.freeze({
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
});

export function createServerSupabaseClient({
  config = env,
  createClientImpl = createClient,
} = {}) {
  const { url, publishableKey } = requireSupabasePublicConfig(config);
  return createClientImpl(url, publishableKey, { auth: { ...SERVER_AUTH_OPTIONS } });
}

export function createRequestSupabaseClient(requestAuth, {
  config = env,
  createClientImpl = createClient,
} = {}) {
  const token = String(requestAuth?.accessToken || '');
  if (!requestAuth?.userId || !token) throw new Error('Validated request authentication is required.');
  const { url, publishableKey } = requireSupabasePublicConfig(config);
  return createClientImpl(url, publishableKey, {
    auth: { ...SERVER_AUTH_OPTIONS },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
