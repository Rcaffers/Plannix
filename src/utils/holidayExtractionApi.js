import { getSupabaseClient } from '../lib/supabase.js';
import { API_BASE_URL, ApiError, parseJsonSafe } from './api.js';
import { boundaryError, exactKeys, normalizeHolidayLabel, MAX_HOLIDAY_TEXT_BYTES, suggestionError, textBytes } from './holidayReview.js';

const fallback = 'Could not extract holidays. Please try again.';
const messages = {
  400: 'Check the pasted text and academic-year dates.',
  401: 'Sign in again to extract holidays.', 403: 'Your session cannot extract holidays. Sign in again or contact support.',
  409: 'Holiday extraction is already in progress. Please wait before trying again.',
  413: 'The pasted text is too large. Use a shorter excerpt.',
  422: 'Reconnect your AI provider key in Profile and try again.',
  429: 'Too many holiday extraction attempts or the provider is rate limited. Please try again later.',
  502: 'Suggestions could not be safely read. Review your text and try again.',
  503: 'The AI provider is temporarily unavailable. Please try again later.',
  504: 'Holiday extraction timed out. Please try again.',
};
export async function currentSession() {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) throw new ApiError(messages[401], { status: 401 });
  return data?.session;
}
export function createHolidayExtractionApi({ fetchImpl = fetch, getSession = currentSession } = {}) {
  return async function extract(input, { signal } = {}) {
    try {
      if (!exactKeys(input, ['text', 'academicYearStartDate', 'academicYearEndDate']) || typeof input.text !== 'string'
        || !input.text.trim() || textBytes(input.text) > MAX_HOLIDAY_TEXT_BYTES
        || boundaryError(input.academicYearStartDate, input.academicYearEndDate)) throw new ApiError(messages[400], { status: 400 });
      signal?.throwIfAborted();
      const session = await getSession();
      signal?.throwIfAborted();
      if (!session?.access_token) throw new ApiError(messages[401], { status: 401 });
      const response = await fetchImpl(`${API_BASE_URL}/api/ai/holidays/extract`, {
        method: 'POST', credentials: 'omit', cache: 'no-store', signal,
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: input.text, academicYearStartDate: input.academicYearStartDate, academicYearEndDate: input.academicYearEndDate }),
      });
      const payload = await parseJsonSafe(response);
      signal?.throwIfAborted();
      const requestId = response.headers?.get?.('x-request-id');
      if (!response.ok) {
        const missingConnection = response.status === 409 && payload?.message === 'Connect an AI provider in Profile before extracting holidays.';
        const error = new ApiError(missingConnection ? 'Connect an AI provider in your Profile to import school holidays automatically.' : messages[response.status] || fallback, { status: response.status, requestId });
        error.reason = missingConnection ? 'connection' : '';
        const retry = response.headers?.get?.('retry-after');
        if (response.status === 429 && /^\d{1,6}$/.test(retry || '')) error.retryAfter = Number(retry);
        throw error;
      }
      if (!exactKeys(payload, ['holidays']) || !Array.isArray(payload.holidays) || payload.holidays.length > 100
        || payload.holidays.some(holiday => suggestionError(holiday, input.academicYearStartDate, input.academicYearEndDate))) {
        throw new ApiError(messages[502], { status: 502, requestId });
      }
      return payload.holidays.map(({ label, startDate, endDate }) => ({ label: normalizeHolidayLabel(label), startDate, endDate }));
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Holiday extraction cancelled.', 'AbortError');
      if (error instanceof ApiError) throw error;
      throw new ApiError(fallback);
    }
  };
}
export const extractSchoolHolidays = createHolidayExtractionApi();
