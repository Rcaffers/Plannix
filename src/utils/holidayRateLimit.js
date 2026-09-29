// Only server-owned codes distinguish quotas; never inspect upstream prose.
export function holidayRateLimitMessage(status, payload) {
  if (status !== 429) return null;
  if (payload?.code === 'HOLIDAY_ATTEMPT_LIMIT') return 'Too many holiday extraction attempts. Please wait before trying again.';
  if (payload?.code === 'AI_RATE_LIMITED') return 'Your AI provider is currently rate limiting requests. Please try again later.';
  return 'Holiday extraction is temporarily rate limited. Please try again later.';
}
