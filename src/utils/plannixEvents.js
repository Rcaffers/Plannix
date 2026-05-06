export const PLANNIX_OPEN_SIGNUP_EVENT = 'plannix-open-signup';

export const PLANNIX_OPEN_LOGIN_EVENT = 'plannix-open-login';

export const PLANNIX_OPEN_TERMS_EVENT = 'plannix-open-terms';

export const PLANNIX_OPEN_PRIVACY_EVENT = 'plannix-open-privacy';

export function dispatchOpenSignupModal() {
  window.dispatchEvent(new Event(PLANNIX_OPEN_SIGNUP_EVENT));
}

export function dispatchOpenLoginModal() {
  window.dispatchEvent(new Event(PLANNIX_OPEN_LOGIN_EVENT));
}

export function dispatchOpenTermsModal() {
  window.dispatchEvent(new Event(PLANNIX_OPEN_TERMS_EVENT));
}

export function dispatchOpenPrivacyModal() {
  window.dispatchEvent(new Event(PLANNIX_OPEN_PRIVACY_EVENT));
}
