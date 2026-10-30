// Replaces the browser Supabase module in a server-session build. A stale
// caller fails closed instead of creating a second authentication boundary.
export function getSupabaseClient() {
  throw new Error('Browser Supabase access is unavailable in server-session mode.');
}
export const createBrowserSupabaseClient = getSupabaseClient;
