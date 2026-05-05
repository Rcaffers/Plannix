export const PLANNIX_OPEN_SIGNUP_EVENT = 'plannix-open-signup';

export const PLANNIX_OPEN_TERMS_EVENT = 'plannix-open-terms';

export function dispatchOpenSignupModal() {
  window.dispatchEvent(new Event(PLANNIX_OPEN_SIGNUP_EVENT));
}

export function dispatchOpenTermsModal() {
  window.dispatchEvent(new Event(PLANNIX_OPEN_TERMS_EVENT));
}
