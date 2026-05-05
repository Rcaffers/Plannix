/** Return URL for Stripe Payment Element after 3DS / confirm (subscription signup). */
export function buildSubscriptionSignupReturnUrl(subscriptionId) {
  return `${window.location.origin}/?signup_subscription_complete=1&subscription_id=${encodeURIComponent(subscriptionId)}`;
}
