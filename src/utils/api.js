import { getSupabaseClient } from '../lib/supabase.js';

/**
 * Resolves the API origin for fetch(). Vite bakes VITE_API_BASE_URL at build time—local .env values
 * like http://localhost:4000 break production (browser cannot reach your laptop). We also avoid
 * mixed content (https page → http API) and ignore loopback URLs when the page is not local.
 */
function computeApiBaseUrl() {
  let raw = import.meta.env?.VITE_API_BASE_URL;
  let trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (trimmed.endsWith('/')) {
    trimmed = trimmed.slice(0, -1);
  }

  if (typeof window !== 'undefined' && window.location) {
    const host = window.location.hostname;
    const pageIsLocal = host === 'localhost' || host === '127.0.0.1';

    if (trimmed) {
      const lower = trimmed.toLowerCase();
      const pointsAtLoopback =
        lower.includes('localhost') ||
        lower.includes('127.0.0.1') ||
        /:\/\/0\.0\.0\.0/.test(lower);
      if (!pageIsLocal && pointsAtLoopback) {
        trimmed = '';
      }
    }

    if (trimmed && window.location.protocol === 'https:') {
      try {
        const u = new URL(trimmed);
        if (u.protocol === 'http:') {
          u.protocol = 'https:';
          trimmed = `${u.origin}${u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '')}`;
        }
      } catch {
        trimmed = '';
      }
    }
  }

  if (!trimmed) {
    return '';
  }

  try {
    const u = new URL(trimmed);
    const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
    return `${u.origin}${path}`;
  } catch {
    return '';
  }
}

export const API_BASE_URL = computeApiBaseUrl();

export const JSON_POST_HEADERS = {
  'Content-Type': 'application/json',
};

function isLikelyNetworkFailure(error) {
  if (!error) return false;
  if (error instanceof TypeError) return true;
  const msg = String(error.message || '').toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('load failed') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed')
  );
}

/** Maps thrown fetch errors (e.g. Safari “Load failed”) to text that explains deployment/CORS. */
export function userFacingFetchErrorMessage(error, fallback) {
  if (isLikelyNetworkFailure(error)) {
    return (
      'Could not reach the Plannix server. Check your connection. ' +
      'On the live site: do not bake in a local API URL (remove VITE_API_BASE_URL from the build, or set it to your public https API). ' +
      'The API must allow this site in CORS (FRONTEND_ORIGIN) and use COOKIE_SECURE on https.'
    );
  }
  return String(error?.message || fallback || 'Something went wrong.');
}

export async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

const CANONICAL_REQUEST_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class ApiError extends Error {
  constructor(message, { status = 0, requestId = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.requestId = CANONICAL_REQUEST_ID.test(String(requestId || '')) ? requestId : null;
  }
}

export async function submitContactForm({ name, email, message }) {
  const response = await fetch(`${API_BASE_URL}/api/contact`, {
    method: 'POST',
    headers: JSON_POST_HEADERS,
    credentials: 'include',
    body: JSON.stringify({ name, email, message }),
  });
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(payload?.message || 'Could not send your message.');
  }
  return payload;
}

export async function fetchHolidayCountries() {
  const response = await fetch(`${API_BASE_URL}/holidays/countries`, {
    method: 'GET',
    credentials: 'include',
  });
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(payload?.message || 'Could not load country list.');
  }
  return Array.isArray(payload?.countries) ? payload.countries : [];
}

export async function resolveCountryFromCoordinates({ lat, lng }) {
  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
  });
  const response = await fetch(`${API_BASE_URL}/holidays/resolve-country?${params.toString()}`, {
    method: 'GET',
    credentials: 'include',
  });
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(payload?.message || 'Could not detect your country from location.');
  }
  return {
    countryCode: String(payload?.countryCode || '').toUpperCase(),
    countryName: String(payload?.countryName || '').trim(),
  };
}

export async function fetchPublicHolidays({ countryCode, year }) {
  const params = new URLSearchParams({
    country: String(countryCode || '').toUpperCase(),
    year: String(year),
  });
  const response = await fetch(`${API_BASE_URL}/holidays/public?${params.toString()}`, {
    method: 'GET',
    credentials: 'include',
  });
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(payload?.message || 'Could not load public holidays.');
  }
  return Array.isArray(payload?.holidays) ? payload.holidays : [];
}

export async function deleteAccount({ password, accessToken, fetchImpl = fetch }) {
  const response = await fetchImpl(`${API_BASE_URL}/account`, {
    method: 'DELETE',
    credentials: 'omit',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password }),
  });
  if (response.status === 204) return;
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new ApiError(payload?.message || 'Could not delete account.', {
      status: response.status,
      requestId: response.headers.get('x-request-id'),
    });
  }
}

export async function fetchClassesPlan() {
  const response = await fetch(`${API_BASE_URL}/api/classes`, {
    method: 'GET',
    credentials: 'include',
  });
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(payload?.message || 'Could not load classes.');
  }
  return {
    entries: Array.isArray(payload?.entries) ? payload.entries : [],
  };
}

export async function saveClassesPlan(plan) {
  const response = await fetch(`${API_BASE_URL}/api/classes`, {
    method: 'PUT',
    headers: JSON_POST_HEADERS,
    credentials: 'include',
    body: JSON.stringify(plan),
  });
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(payload?.message || 'Could not save classes.');
  }
  return payload;
}

export async function fetchTimetableLayout() {
  const response = await fetch(`${API_BASE_URL}/api/timetable/layout`, {
    method: 'GET',
    credentials: 'include',
  });
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(payload?.message || 'Could not load timetable layout.');
  }
  return payload?.layout ?? null;
}

export async function saveTimetableLayout(layout) {
  const response = await fetch(`${API_BASE_URL}/api/timetable/layout`, {
    method: 'PUT',
    headers: JSON_POST_HEADERS,
    credentials: 'include',
    body: JSON.stringify({ layout }),
  });
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(payload?.message || 'Could not save timetable layout.');
  }
  return payload;
}

export async function fetchTimetableSessions({ layoutKey, weekKey = '' }) {
  const params = new URLSearchParams({ layoutKey, weekKey });
  const response = await fetch(`${API_BASE_URL}/api/timetable/sessions?${params.toString()}`, {
    method: 'GET',
    credentials: 'include',
  });
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(payload?.message || 'Could not load timetable sessions.');
  }
  return Array.isArray(payload?.sessions) ? payload.sessions : [];
}

export async function saveTimetableSessions({ layoutKey, weekKey = '', sessions }) {
  const response = await fetch(`${API_BASE_URL}/api/timetable/sessions`, {
    method: 'PUT',
    headers: JSON_POST_HEADERS,
    credentials: 'include',
    body: JSON.stringify({ layoutKey, weekKey, sessions }),
  });
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(payload?.message || 'Could not save timetable sessions.');
  }
  return payload;
}

export async function clearTimetableSessionsForLayout({ layoutKey }) {
  const params = new URLSearchParams({ layoutKey });
  const response = await fetch(`${API_BASE_URL}/api/timetable/sessions?${params.toString()}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(payload?.message || 'Could not clear timetable sessions.');
  }
  return payload;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function canonicalUuid(value, label) {
  if (!UUID.test(String(value || ''))) throw new ApiError(`${label} is invalid.`);
  return value;
}

function publicYear(value, withHolidays = false) {
  const year = {
    id: canonicalUuid(value?.id, 'Academic year'),
    label: String(value?.label || ''),
    startDate: DATE.test(String(value?.startDate || '')) ? value.startDate : '',
    endDate: DATE.test(String(value?.endDate || '')) ? value.endDate : '',
  };
  if (withHolidays) {
    year.holidays = (Array.isArray(value?.holidays) ? value.holidays : []).map((holiday) => ({
      id: canonicalUuid(holiday?.id, 'Holiday'),
      label: String(holiday?.label || ''),
      startDate: DATE.test(String(holiday?.startDate || '')) ? holiday.startDate : '',
      endDate: DATE.test(String(holiday?.endDate || '')) ? holiday.endDate : '',
    }));
  }
  return year;
}

export function createAcademicYearApi({
  fetchImpl = fetch,
  getSession = async () => {
    const client = getSupabaseClient();
    const { data, error } = await client.auth.getSession();
    if (error) throw new ApiError('Authentication is required.', { status: 401 });
    const session = data?.session;
    if (!session?.access_token) throw new ApiError('Authentication is required.', { status: 401 });
    const validation = await client.auth.getUser(session.access_token);
    if (validation.error || !validation.data?.user) throw new ApiError('Authentication is required.', { status: 401 });
    return session;
  },
} = {}) {
  async function request(path, options, fallback) {
    let response;
    try {
      const session = await getSession();
      if (!session?.access_token) throw new ApiError('Authentication is required.', { status: 401 });
      response = await fetchImpl(`${API_BASE_URL}${path}`, {
        ...options,
        credentials: 'omit',
        headers: { ...options?.headers, Authorization: `Bearer ${session.access_token}` },
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(fallback);
    }
    const payload = await parseJsonSafe(response);
    const requestId = response.headers?.get?.('x-request-id');
    if (!response.ok) throw new ApiError(payload?.message || fallback, { status: response.status, requestId });
    return { payload, requestId: UUID.test(String(requestId || '')) ? requestId : null };
  }

  return {
    async list(organisationId) {
      canonicalUuid(organisationId, 'Organisation');
      const query = new URLSearchParams({ organisationId });
      const { payload, requestId } = await request(`/api/academic-years?${query}`, { method: 'GET' }, 'Could not load academic years.');
      return { academicYears: (Array.isArray(payload?.academicYears) ? payload.academicYears : []).map((year) => publicYear(year)), requestId };
    },
    async load(organisationId, academicYearId) {
      canonicalUuid(organisationId, 'Organisation');
      canonicalUuid(academicYearId, 'Academic year');
      const query = new URLSearchParams({ organisationId, academicYearId });
      const { payload, requestId } = await request(`/api/academic-year?${query}`, { method: 'GET' }, 'Could not load the academic year.');
      return { plan: publicYear(payload?.plan, true), requestId };
    },
    async save(organisationId, plan) {
      canonicalUuid(organisationId, 'Organisation');
      if (plan?.id) canonicalUuid(plan.id, 'Academic year');
      const { payload, requestId } = await request('/api/academic-year', {
        method: 'PUT', headers: JSON_POST_HEADERS, body: JSON.stringify({ organisationId, plan }),
      }, 'Could not save the academic year.');
      return { academicYearId: canonicalUuid(payload?.academicYearId, 'Academic year'), requestId };
    },
  };
}

const academicYearApi = createAcademicYearApi();
export const fetchAcademicYears = (organisationId) => academicYearApi.list(organisationId);
export const fetchAcademicYearPlan = (organisationId, academicYearId) => academicYearApi.load(organisationId, academicYearId);
export const saveAcademicYearPlan = (organisationId, plan) => academicYearApi.save(organisationId, plan);
