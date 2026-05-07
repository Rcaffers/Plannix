export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export const JSON_POST_HEADERS = {
  'Content-Type': 'application/json',
};

export async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
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
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: JSON_POST_HEADERS,
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });

  const payload = await parseJsonSafe(response);

  if (!response.ok) {
    throw new Error(payload?.message || 'Unable to log in with those details.');
  }

  const loggedInUser = payload?.user ?? payload;
  if (loggedInUser) {
    return loggedInUser;
  }

  const meResponse = await fetch(`${API_BASE_URL}/auth/me`, {
    method: 'GET',
    credentials: 'include',
  });

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
  const response = await fetch(`${API_BASE_URL}/auth/signup`, {
    method: 'POST',
    headers: JSON_POST_HEADERS,
    credentials: 'include',
    body: JSON.stringify({ name, email, password }),
  });

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
