import { API_BASE_URL, ApiError, parseJsonSafe } from './api.js';
import { currentSession } from './holidayExtractionApi.js';
import { boundaryError, exactKeys, normalizeHolidayLabel, suggestionError } from './holidayReview.js';

export const MAX_HOLIDAY_PDF_BYTES = 10 * 1024 * 1024;
export function pdfFileError(file) {
  if (!(file instanceof Blob) || !file.size) return 'Choose a non-empty PDF document.';
  if (file.size > MAX_HOLIDAY_PDF_BYTES) return 'PDF must be no larger than 10 MiB.';
  if (file.type && file.type.toLowerCase() !== 'application/pdf') return 'Choose a PDF document.';
  return '';
}
// Only these server-controlled messages may cross the response boundary.
const safeMessages = new Set([
  'Use a valid, non-empty PDF document.', 'PDF must be no larger than 10 MiB.',
  'Password-protected PDFs are not supported.', 'PDF must contain no more than 50 pages.',
  'This PDF has no readable text. Scanned PDFs require OCR, which is not supported.',
  'PDF text exceeds the 50,000-byte limit. Use a shorter document.',
  'PDF processing timed out. Please try a smaller document.',
  'Could not process this PDF safely. Try another document.',
  'Connect an AI provider in Profile before extracting holidays.',
  'Reconnect your AI provider key in Profile and try again.',
  'Too many holiday extraction attempts. Please try again later.',
  'AI provider rate limit reached. Please try again later.',
  'AI provider is temporarily unavailable. Please try again later.',
  'Holiday extraction timed out. Please try again.',
  'Could not obtain valid holiday suggestions. Please review your text and try again.',
  'Holiday extraction is already in progress.',
]);
const fallback = 'Could not extract PDF holidays. Please try again.';
export function createHolidayPdfExtractionApi({ fetchImpl = fetch, getSession = currentSession } = {}) {
  return async function extract({ file, academicYearStartDate, academicYearEndDate }, { signal } = {}) {
    try {
      const invalid = pdfFileError(file) || boundaryError(academicYearStartDate, academicYearEndDate);
      if (invalid) throw new ApiError(invalid, { status: 400 });
      signal?.throwIfAborted();
      const session = await getSession();
      signal?.throwIfAborted();
      if (!session?.access_token) throw new ApiError('Sign in again to extract holidays.', { status: 401 });
      const query = new URLSearchParams({ boundaryStart: academicYearStartDate, boundaryEnd: academicYearEndDate });
      const response = await fetchImpl(`${API_BASE_URL}/api/ai/holidays/extract-pdf?${query}`, {
        method: 'POST', credentials: 'omit', cache: 'no-store', signal,
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/pdf' }, body: file,
      });
      const payload = await parseJsonSafe(response);
      signal?.throwIfAborted();
      const requestId = response.headers?.get?.('x-request-id');
      if (!response.ok) {
        const message = safeMessages.has(payload?.message) ? payload.message : response.status === 413 ? 'PDF must be no larger than 10 MiB.' : response.status === 401 ? 'Sign in again to extract holidays.' : fallback;
        const error = new ApiError(message, { status: response.status, requestId });
        error.reason = message.startsWith('Connect an AI provider') ? 'connection' : '';
        const retry = response.headers?.get?.('retry-after');
        if (response.status === 429 && /^\d{1,6}$/.test(retry || '')) error.retryAfter = Number(retry);
        throw error;
      }
      if (!exactKeys(payload, ['holidays', 'pageCount']) || !Number.isInteger(payload.pageCount) || payload.pageCount < 1 || payload.pageCount > 50
        || !Array.isArray(payload.holidays) || payload.holidays.length > 100
        || payload.holidays.some(item => suggestionError(item, academicYearStartDate, academicYearEndDate))) throw new ApiError('PDF suggestions could not be safely read.', { status: 502, requestId });
      return { holidays: payload.holidays.map(({ label, startDate, endDate }) => ({ label: normalizeHolidayLabel(label), startDate, endDate })), pageCount: payload.pageCount };
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Holiday extraction cancelled.', 'AbortError');
      if (error instanceof ApiError) throw error;
      throw new ApiError(fallback);
    }
  };
}
export const extractSchoolHolidaysFromPdf = createHolidayPdfExtractionApi();
