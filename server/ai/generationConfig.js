// Server-owned configuration; no request fields or environment overrides.
export const GENERATION_MODELS = Object.freeze({
  openai: 'gpt-4.1-mini-2025-04-14',
  anthropic: 'claude-haiku-4-5-20251001',
  google_gemini: 'gemini-3.8-flash',
});
export const AI_LIMITS = Object.freeze({
  timeoutMs: 30_000,
  userContentBytes: 100_000,
  systemPromptBytes: 16_000,
  schemaBytes: 32_000,
  responseBytes: 1_048_576,
  outputTokens: 4096,
});
