/**
 * Resolves the API origin for fetch(). Vite bakes VITE_API_BASE_URL at build time—local .env values
 * like http://localhost:4000 break production (browser cannot reach your laptop). We also avoid
 * mixed content (https page → http API) and ignore loopback URLs when the page is not local.
 */
function computeApiBaseUrl() {
  let raw = import.meta.env.VITE_API_BASE_URL;
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

export async function fetchAuthConfig() {
  const response = await fetch(`${API_BASE_URL}/auth/config`, {
    method: 'GET',
    credentials: 'include',
  });
  if (!response.ok) {
    return null;
  }
  const data = await parseJsonSafe(response);
  if (data && typeof data.signupRequiresPayment === 'boolean') {
    return {
      signupRequiresPayment: data.signupRequiresPayment,
      stripePublishableKey:
        typeof data.stripePublishableKey === 'string' ? data.stripePublishableKey : '',
    };
  }
  return null;
}

export async function fetchAuthMe() {
  const response = await fetch(`${API_BASE_URL}/auth/me`, {
    method: 'GET',
    credentials: 'include',
  });
  if (!response.ok) {
    return { ok: false, user: null };
  }
  const data = await parseJsonSafe(response);
  return { ok: true, user: data?.user ?? data ?? null };
}

export async function completePaidSignupSession(sessionId) {
  const response = await fetch(`${API_BASE_URL}/auth/signup/complete`, {
    method: 'POST',
    headers: JSON_POST_HEADERS,
    credentials: 'include',
    body: JSON.stringify({ session_id: sessionId }),
  });
  const payload = await parseJsonSafe(response);
  const user = response.ok && payload?.user ? payload.user : null;
  return { user };
}

export async function completePaidSignupSubscription(subscriptionId) {
  const response = await fetch(`${API_BASE_URL}/auth/signup/complete-subscription`, {
    method: 'POST',
    headers: JSON_POST_HEADERS,
    credentials: 'include',
    body: JSON.stringify({ subscription_id: subscriptionId }),
  });
  const payload = await parseJsonSafe(response);
  const user = response.ok && payload?.user ? payload.user : null;
  return { user };
}

export async function loginWithCredentials({ email, password }) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: JSON_POST_HEADERS,
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });
  } catch (error) {
    throw new Error(userFacingFetchErrorMessage(error, 'Unable to log in.'));
  }

  const payload = await parseJsonSafe(response);

  if (!response.ok) {
    throw new Error(payload?.message || 'Unable to log in with those details.');
  }

  const loggedInUser = payload?.user ?? payload;
  if (loggedInUser) {
    return loggedInUser;
  }

  let meResponse;
  try {
    meResponse = await fetch(`${API_BASE_URL}/auth/me`, {
      method: 'GET',
      credentials: 'include',
    });
  } catch (error) {
    throw new Error(userFacingFetchErrorMessage(error, 'Unable to log in.'));
  }

  const mePayload = await parseJsonSafe(meResponse);
  return mePayload?.user ?? mePayload ?? null;
}

export async function logoutSession() {
  await fetch(`${API_BASE_URL}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  });
}

export async function applySignupPromotionCode({ subscriptionId, promotionCode }) {
  const response = await fetch(`${API_BASE_URL}/auth/signup/apply-promotion-code`, {
    method: 'POST',
    headers: JSON_POST_HEADERS,
    credentials: 'include',
    body: JSON.stringify({
      subscription_id: subscriptionId,
      promotion_code: promotionCode,
    }),
  });
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(payload?.message || 'Could not apply that promotion code.');
  }
  return {
    clientSecret: payload.clientSecret,
    subscriptionId: payload.subscriptionId || subscriptionId,
    subscriptionPrice: payload.subscriptionPrice ?? null,
    dueToday: payload.dueToday ?? null,
  };
}

export async function signupAccount({ name, email, password }) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}/auth/signup`, {
      method: 'POST',
      headers: JSON_POST_HEADERS,
      credentials: 'include',
      body: JSON.stringify({ name, email, password }),
    });
  } catch (error) {
    throw new Error(userFacingFetchErrorMessage(error, 'Unable to create your account right now.'));
  }

  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(payload?.message || 'Unable to create your account right now.');
  }

  if (payload?.clientSecret) {
    return {
      redirecting: true,
      clientSecret: payload.clientSecret,
      subscriptionId: payload.subscriptionId || '',
      subscriptionPrice: payload.subscriptionPrice ?? null,
      dueToday: payload.dueToday ?? null,
      user: null,
    };
  }

  if (payload?.checkoutUrl) {
    return { redirecting: true, checkoutUrl: payload.checkoutUrl, user: null };
  }

  const createdUser = payload?.user ?? payload ?? null;
  return { redirecting: false, user: createdUser };
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

export async function fetchSubscriptionSummary() {
  const response = await fetch(`${API_BASE_URL}/billing/subscription-summary`, {
    method: 'GET',
    credentials: 'include',
  });
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(payload?.message || 'Could not load subscription details.');
  }
  return {
    enabled: Boolean(payload?.enabled),
    subscription: payload?.subscription ?? null,
    warning: String(payload?.warning || '').trim(),
  };
}

export async function createBillingPortalSession({ mode = '', subscriptionId = '' } = {}) {
  const response = await fetch(`${API_BASE_URL}/billing/portal-session`, {
    method: 'POST',
    headers: JSON_POST_HEADERS,
    credentials: 'include',
    body: JSON.stringify({ mode, subscriptionId }),
  });
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(payload?.message || 'Could not open billing portal.');
  }
  return {
    url: String(payload?.url || ''),
  };
}

export async function deleteAccount() {
  const response = await fetch(`${API_BASE_URL}/account`, {
    method: 'DELETE',
    credentials: 'include',
  });
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(payload?.message || 'Could not delete account.');
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

export async function fetchAcademicYearPlan() {
  const response = await fetch(`${API_BASE_URL}/api/academic-year`, {
    method: 'GET',
    credentials: 'include',
  });
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(payload?.message || 'Could not load academic year.');
  }
  return payload?.plan ?? null;
}

export async function saveAcademicYearPlan(plan) {
  const response = await fetch(`${API_BASE_URL}/api/academic-year`, {
    method: 'PUT',
    headers: JSON_POST_HEADERS,
    credentials: 'include',
    body: JSON.stringify({ plan }),
  });
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(payload?.message || 'Could not save academic year.');
  }
  return payload;
}
