const definitions = Object.freeze({
  AI_CREDENTIAL_UNAVAILABLE: ['AI connection is unavailable.', false],
  AI_CREDENTIAL_REJECTED: ['AI provider rejected the credential.', false],
  AI_RATE_LIMITED: ['AI provider rate limit reached.', true],
  AI_TIMEOUT: ['AI provider request timed out.', true],
  AI_PROVIDER_UNAVAILABLE: ['AI provider is unavailable.', true],
  AI_INVALID_RESPONSE: ['AI provider returned an invalid response.', false],
  AI_CONFIGURATION_ERROR: ['AI generation configuration is invalid.', false],
});
const issuedErrors = new WeakSet();
export function aiError(code) {
  const safeCode = Object.hasOwn(definitions, code) ? code : 'AI_PROVIDER_UNAVAILABLE';
  const [message, retryable] = definitions[safeCode];
  const error = Object.assign(new Error(message), { code: safeCode, retryable });
  issuedErrors.add(error);
  return Object.freeze(error);
}
export function safeAiError(error, fallback = 'AI_PROVIDER_UNAVAILABLE') {
  return issuedErrors.has(error) ? error : aiError(fallback);
}
