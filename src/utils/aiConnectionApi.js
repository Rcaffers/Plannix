import { getSupabaseClient } from '../lib/supabase.js';
import { API_BASE_URL, ApiError, parseJsonSafe } from './api.js';
import { aiProvider, MAX_AI_KEY_LENGTH } from '../../shared/aiProviders.js';

export function connectionMetadata(value) {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['provider','providerLabel','lastFour','active'].includes(key))
    || !aiProvider(value.provider) || typeof value.lastFour !== 'string' || value.lastFour.length !== 4
    || typeof value.active !== 'boolean') throw new ApiError('Could not read your AI connection.');
  return { provider: value.provider, providerLabel: aiProvider(value.provider).label, lastFour: value.lastFour, active: value.active };
}
async function currentSession() {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error || !data?.session?.access_token) throw new ApiError('Sign in to manage your AI connection.');
  return data.session;
}
export function createAiConnectionApi({ fetchImpl = fetch, getSession = currentSession } = {}) {
  async function request(method, value) {
    const fallback = 'Could not update or load your AI connection. Please try again.';
    try {
      let body;
      if (value) {
        if (!aiProvider(value.provider) || typeof value.apiKey !== 'string' || value.apiKey.length > MAX_AI_KEY_LENGTH || value.apiKey.trim().length < 5) {
          throw new ApiError('Choose a provider and enter an API key containing between 5 and 4096 characters.');
        }
        body = JSON.stringify({ provider: value.provider, apiKey: value.apiKey.trim() });
      }
      const session = await getSession();
      if (!session?.access_token) throw new ApiError('Sign in to manage your AI connection.');
      const response = await fetchImpl(`${API_BASE_URL}/api/ai/connection`, { method, credentials: 'omit', cache: 'no-store',
        headers: { Authorization: `Bearer ${session.access_token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body } : {}) });
      const payload = await parseJsonSafe(response);
      const requestId = response.headers?.get?.('x-request-id');
      if (!response.ok) {
        // Never render a server/proxy exception or echoed request payload.
        const messages = { 400: 'Check the provider and API key, then try again.', 401: 'Sign in to manage your AI connection.',
          403: 'Your personal AI connection is unavailable. Sign in again or contact support.',
          409: 'Your AI connection changed or a request is in progress. Reload before trying again.',
          413: 'The API key is too long.' };
        throw new ApiError(messages[response.status] || fallback, { status: response.status, requestId });
      }
      return connectionMetadata(payload?.connection);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(fallback);
    }
  }
  return { load: () => request('GET'), connect: value => request('POST', value), replace: value => request('PUT', value), disconnect: () => request('DELETE') };
}
export const aiConnectionApi = createAiConnectionApi();
