import { createClient } from '@supabase/supabase-js';

const REQUIRED_PUBLIC_CONFIG = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'];

export function createBrowserSupabaseClient({
  configuration = import.meta.env,
  createClientImpl = createClient,
} = {}) {
  const url = String(configuration?.VITE_SUPABASE_URL || '').trim();
  const publishableKey = String(configuration?.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();
  const missing = REQUIRED_PUBLIC_CONFIG.filter((name) =>
    name === 'VITE_SUPABASE_URL' ? !url : !publishableKey,
  );
  if (missing.length > 0) {
    throw new Error(`Missing public Supabase configuration: ${missing.join(', ')}.`);
  }

  return createClientImpl(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

let browserClient;

export function getSupabaseClient() {
  browserClient ||= createBrowserSupabaseClient();
  return browserClient;
}
