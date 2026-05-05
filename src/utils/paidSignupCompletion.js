import {
  readPaidSignupSessionId,
  readPaidSignupSubscriptionId,
  stripQueryFromLocation,
} from './authUrl';

/**
 * If the URL contains a post-checkout session id, complete signup and clear the query string.
 * @returns {Promise<{ user: object|null }>}
 */
export async function tryCompletePaidCheckoutSignup(completePaidSignupSession) {
  const sessionId = readPaidSignupSessionId();
  if (!sessionId) {
    return { user: null };
  }
  try {
    const { user } = await completePaidSignupSession(sessionId);
    return { user };
  } finally {
    stripQueryFromLocation();
  }
}

/**
 * If the URL contains a completed subscription id, complete signup and clear the query string.
 * @returns {Promise<{ user: object|null }>}
 */
export async function tryCompletePaidSubscriptionSignup(completePaidSignupSubscription) {
  const subscriptionId = readPaidSignupSubscriptionId();
  if (!subscriptionId) {
    return { user: null };
  }
  try {
    const { user } = await completePaidSignupSubscription(subscriptionId);
    return { user };
  } finally {
    stripQueryFromLocation();
  }
}
