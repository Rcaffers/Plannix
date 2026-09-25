// Public identifiers only. Credentials, destinations and model configuration
// must never be added to this browser-safe list.
export const AI_PROVIDERS = Object.freeze([
  Object.freeze({ id: 'openai', label: 'OpenAI' }),
  Object.freeze({ id: 'anthropic', label: 'Anthropic' }),
  Object.freeze({ id: 'google_gemini', label: 'Google Gemini' }),
]);
export const MAX_AI_KEY_LENGTH = 4096;
export const aiProvider = id => AI_PROVIDERS.find(provider => provider.id === id);
