export function shouldOpenSignupAfterCancel() {
  const params = new URLSearchParams(window.location.search);
  return params.get('signup_cancel') === '1';
}

export function stripQueryFromLocation() {
  window.history.replaceState({}, '', window.location.pathname || '/');
}

export function readPaidSignupSessionId() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('signup_complete') !== '1') {
    return null;
  }
  return params.get('session_id');
}

export function readPaidSignupSubscriptionId() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('signup_subscription_complete') !== '1') {
    return null;
  }
  return params.get('subscription_id');
}
