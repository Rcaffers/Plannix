import { getSupabaseClient } from '../lib/supabase.js';
import { API_BASE_URL, ApiError, parseJsonSafe } from './api.js';
import { IMPORT_DESTINATIONS, IMPORT_IMAGE_BYTES, IMPORT_TEXT_BYTES, normalizeImportPreview } from '../../shared/importPreview.js';
import { boundaryError } from './holidayReview.js';

export function importSourceError({ mode, text, file }) {
  if (mode === 'text') return typeof text !== 'string' || !text.trim() || new TextEncoder().encode(text).length > IMPORT_TEXT_BYTES
    ? 'Paste up to 50,000 bytes of calendar text.' : '';
  if (!(file instanceof Blob) || !file.size) return 'Choose a non-empty document.';
  if (mode === 'pdf') return file.type !== 'application/pdf' || file.size > 10 * 1024 * 1024
    ? 'Choose one PDF no larger than 10 MiB.' : '';
  if (mode === 'image') return !['image/png', 'image/jpeg'].includes(file.type) || file.size > IMPORT_IMAGE_BYTES
    ? 'Choose one PNG or JPEG image no larger than 4 MiB.' : '';
  if (mode === 'csv') return !['text/csv', 'application/csv', 'application/vnd.ms-excel', ''].includes(file.type) || file.size > 2 * 1024 * 1024 || !/\.csv$/i.test(file.name || '')
    ? 'Choose one CSV file no larger than 2 MiB.' : '';
  if (mode === 'xlsx') return !['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream', ''].includes(file.type)
    || file.size > 2 * 1024 * 1024 || !/\.xlsx$/i.test(file.name || '')
    ? 'Choose one Excel (.xlsx) file no larger than 2 MiB.' : '';
  return 'Choose an import method.';
}
const safeMessages = {
  400: 'Check the source document and academic-year dates.', 401: 'Sign in again to extract a preview.',
  403: 'Your session cannot extract a preview. Sign in again or contact support.',
  409: 'An import preview is already in progress, or an AI connection is missing. Check Profile and retry.',
  413: 'The document is too large. Use a shorter document.',
  415: 'Choose a supported PDF, PNG, JPEG, CSV or Excel (.xlsx) file.',
  422: 'The document or AI connection could not be used. Check Profile or try another document.',
  429: 'Too many import attempts. Please wait before trying again.',
  502: 'Suggestions could not be safely read. Please try again.',
  503: 'The AI provider is temporarily unavailable. Please try again later.',
  504: 'Extraction timed out. Please try again.',
};
async function session() {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error || !data?.session?.access_token) throw new ApiError(safeMessages[401], { status: 401 });
  return data.session;
}
export function createImportPreviewApi({ fetchImpl = fetch, getSession = session } = {}) {
  return async function extract({ destination, mode, text = '', file = null, academicYearStartDate, academicYearEndDate }, { signal } = {}) {
    try {
      if (!IMPORT_DESTINATIONS.includes(destination) || boundaryError(academicYearStartDate, academicYearEndDate))
        throw new ApiError('Select an academic year with valid dates.', { status: 400 });
      const sourceError = importSourceError({ mode, text, file });
      if (sourceError) throw new ApiError(sourceError, { status: 400 });
      signal?.throwIfAborted();
      const active = await getSession();
      signal?.throwIfAborted();
      if (!active?.access_token) throw new ApiError(safeMessages[401], { status: 401 });
      const query = new URLSearchParams({ destination, boundaryStart: academicYearStartDate, boundaryEnd: academicYearEndDate });
      const path = mode === 'text' ? '/api/ai/import-preview/extract'
        : `/api/ai/import-preview/extract-${mode}?${query}`;
      const response = await fetchImpl(`${API_BASE_URL}${path}`, { method: 'POST', credentials: 'omit', cache: 'no-store', signal,
        headers: { Authorization: `Bearer ${active.access_token}`, 'Content-Type': mode === 'text' ? 'application/json'
          : mode === 'csv' ? 'text/csv' : mode === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : file.type },
        body: mode === 'text' ? JSON.stringify({ destination, text, academicYearStartDate, academicYearEndDate }) : file });
      const payload = await parseJsonSafe(response);
      signal?.throwIfAborted();
      const requestId = response.headers?.get?.('x-request-id');
      if (!response.ok) {
        const missing = response.status === 409 && payload?.message === 'Connect an AI provider in Profile before extracting a preview.';
        const providerRate = response.status === 429 && payload?.code === 'AI_RATE_LIMITED';
        const error = new ApiError(missing ? 'Connect an AI provider in Profile before extracting a preview.'
          : providerRate ? 'Your AI provider is currently rate limiting requests. Please try again later.'
            : safeMessages[response.status] || 'Could not extract a preview. Please try again.', { status: response.status, requestId });
        const retry = response.headers?.get?.('retry-after');
        if (response.status === 429 && /^\d{1,6}$/.test(retry || '')) error.retryAfter = Number(retry);
        throw error;
      }
      if (!payload || Object.keys(payload).sort().join(',') !== (mode === 'pdf' ? 'destination,entries,pageCount' : 'destination,entries')
        || payload.destination !== destination
        || (mode === 'pdf' && (!Number.isInteger(payload.pageCount) || payload.pageCount < 1 || payload.pageCount > 50)))
        throw new ApiError(safeMessages[502], { status: 502, requestId });
      let entries;
      try { entries = normalizeImportPreview(destination, payload.entries); }
      catch { throw new ApiError(safeMessages[502], { status: 502, requestId }); }
      return { destination, entries, ...(mode === 'pdf' ? { pageCount: payload.pageCount } : {}) };
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw new DOMException('Import preview cancelled.', 'AbortError');
      if (error instanceof ApiError) throw error;
      throw new ApiError('Could not extract a preview. Please try again.');
    }
  };
}
export const extractImportPreview = createImportPreviewApi();
