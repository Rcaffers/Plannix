import { safeAiError } from './generationErrors.js';
import { checkCancellation, waitForOperation } from './cancellation.js';
import { createClient } from '@supabase/supabase-js';
import { env, requireSupabaseAdminConfig } from '../config/env.js';
import { getProvider } from './providers.js';
import { MAX_AI_KEY_LENGTH } from '../../shared/aiProviders.js';

const canonicalUserId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const unavailable = () => new Error('AI credential unavailable.');

// Internal capability: caller must obtain this ID from confirmed authentication,
// never from request parameters. No route, logging, persistence or secret cache.
export async function retrieveAiCredential(validatedUserId, {
  config = env, createClientImpl = createClient, signal,
} = {}) {
  if (typeof validatedUserId !== 'string' || !canonicalUserId.test(validatedUserId)) throw unavailable();
  checkCancellation(signal);
  try {
    const { url, secretKey } = requireSupabaseAdminConfig(config);
    const client = createClientImpl(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    let rpc = client.rpc('plannix_get_server_ai_credential', { validated_user_id: validatedUserId });
    if (signal && typeof rpc.abortSignal === 'function') rpc = rpc.abortSignal(signal);
    const { data, error } = await waitForOperation(rpc, signal);
    checkCancellation(signal);
    if (error || !data || typeof data.provider !== 'string' || !getProvider(data.provider)
      || typeof data.apiKey !== 'string' || data.apiKey.trim().length < 5 || data.apiKey.length > MAX_AI_KEY_LENGTH) throw unavailable();
    return { provider: data.provider, apiKey: data.apiKey };
  } catch (error) {
    checkCancellation(signal);
    if (safeAiError(error).code === 'AI_TIMEOUT') throw error;
    // Do not attach a cause: upstream errors may contain credentials.
    throw unavailable();
  }
}
