import { getSupabaseClient } from '../lib/supabase.js';
import { API_BASE_URL, ApiError, JSON_POST_HEADERS, parseJsonSafe } from './api.js';

const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PATH = '/api/notifications/morning-summary/preferences';

function preferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'academicYearId,deliveryTime,enabled,revision'
    || typeof value.enabled !== 'boolean' || typeof value.deliveryTime !== 'string'
    || !TIME.test(value.deliveryTime) || !Number.isSafeInteger(value.revision)
    || value.revision < 0 || (value.academicYearId !== null
      && (typeof value.academicYearId !== 'string' || !UUID.test(value.academicYearId))))
    throw new ApiError('The server returned invalid morning summary preferences.');
  return { enabled: value.enabled, deliveryTime: value.deliveryTime, revision: value.revision,
    academicYearId: value.academicYearId };
}

async function currentSession() {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error || !data?.session?.access_token) throw new ApiError('Authentication is required.', { status: 401 });
  const checked = await client.auth.getUser(data.session.access_token);
  if (checked.error || !checked.data?.user?.email_confirmed_at) throw new ApiError('Confirmed authentication is required.', { status: 403 });
  return { token: data.session.access_token, userId: checked.data.user.id };
}

export function createMorningSummaryApi({ fetchImpl = fetch, getSession = currentSession } = {}) {
  async function request(method, expectedUserId, value, signal) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (typeof expectedUserId !== 'string' || !UUID.test(expectedUserId)) throw new ApiError('Authentication is required.', { status: 401 });
    const requestBody = method === 'PUT' ? JSON.stringify(preferences(value)) : null;
    if (method === 'PUT' && (value.revision === Number.MAX_SAFE_INTEGER || !value.academicYearId))
      throw new ApiError('Morning summary preferences cannot be saved until reloaded.');
    const session = await getSession();
    if (session.userId !== expectedUserId || signal?.aborted) throw new ApiError('The signed-in account changed.', { status: 401 });
    let response;
    try {
      response = await fetchImpl(`${API_BASE_URL}${PATH}`, { method, signal, credentials: 'omit',
        headers: { Authorization: `Bearer ${session.token}`, ...(method === 'PUT' ? JSON_POST_HEADERS : {}) },
        ...(method === 'PUT' ? { body: requestBody } : {}),
      });
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw error;
      throw new ApiError('Could not reach morning summary preferences.');
    }
    const payload = await parseJsonSafe(response);
    const rawId = response.headers?.get?.('x-request-id');
    const requestId = UUID.test(String(rawId || '')) ? rawId : null;
    if (!response.ok) throw new ApiError(response.status === 409 && method === 'PUT'
      ? 'Morning summary preferences changed elsewhere. Reload latest before saving.'
      : method === 'GET' ? 'Could not load morning summary preferences.' : 'Could not save morning summary preferences.',
    { status: response.status, requestId });
    return { ...preferences(payload), requestId };
  }
  return {
    load: (userId, { signal } = {}) => request('GET', userId, null, signal),
    save: (userId, value, { signal } = {}) => request('PUT', userId, value, signal),
    async day(userId, summaryRef, { signal } = {}) {
      if (!UUID.test(userId) || !UUID.test(summaryRef))
        throw new ApiError('Daily summary request is invalid.');
      const session = await getSession();
      if (session.userId !== userId || signal?.aborted) throw new ApiError('The signed-in account changed.', { status: 401 });
      const query = new URLSearchParams({ summaryRef });
      let response;
      try {
        response = await fetchImpl(`${API_BASE_URL}/api/notifications/morning-summary/day?${query}`, {
          method: 'GET', credentials: 'omit', signal, headers: { Authorization: `Bearer ${session.token}` },
        });
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw error;
        throw new ApiError('Could not load daily summary.');
      }
      const payload = await parseJsonSafe(response);
      const rawId = response.headers?.get?.('x-request-id');
      const requestId = UUID.test(String(rawId || '')) ? rawId : null;
      if (!response.ok) throw new ApiError('Could not load daily summary.', { status: response.status, requestId });
      if (!payload || !/^\d{4}-\d{2}-\d{2}$/.test(payload.date)
        || !Array.isArray(payload.lessons) || !Array.isArray(payload.events))
        throw new ApiError('The server returned an invalid daily summary.', { requestId });
      return payload;
    },
  };
}

export const morningSummaryApi = createMorningSummaryApi();
