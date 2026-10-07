export function parseAnalyticsFrameOrigin(value, applicationOrigin) {
  if (typeof value !== 'string' || !value || value.trim() !== value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password
      || url.origin === applicationOrigin) return null;
    return url.origin;
  } catch { return null; }
}
