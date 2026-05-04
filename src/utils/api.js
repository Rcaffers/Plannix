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
    return { signupRequiresPayment: data.signupRequiresPayment };
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

  if (payload?.checkoutUrl) {
    window.location.assign(payload.checkoutUrl);
    return { redirecting: true, user: null };
  }

  const createdUser = payload?.user ?? payload ?? null;
  return { redirecting: false, user: createdUser };
}
