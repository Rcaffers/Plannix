export const PLANNIX_OPEN_SIGNUP_EVENT = 'plannix-open-signup';

export function dispatchOpenSignupModal() {
  window.dispatchEvent(new Event(PLANNIX_OPEN_SIGNUP_EVENT));
}
