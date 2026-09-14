import { createClient } from '@supabase/supabase-js';
import { env, requireSupabaseAdminConfig } from '../config/env.js';

const ADMIN_AUTH_OPTIONS = Object.freeze({
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
});

export function createAccountDeletionAdmin({
  config = env,
  createClientImpl = createClient,
} = {}) {
  const { url, secretKey } = requireSupabaseAdminConfig(config);
  const client = createClientImpl(url, secretKey, {
    auth: { ...ADMIN_AUTH_OPTIONS },
  });

  return Object.freeze({
    async deleteUser(validatedUserId) {
      return client.auth.admin.deleteUser(validatedUserId, false);
    },
  });
}
