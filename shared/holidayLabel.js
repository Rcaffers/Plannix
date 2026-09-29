// Environment-neutral authoritative holiday-label rules. Reject controls before
// whitespace normalization: unsafe input must not become a different valid label.
export function normalizeHolidayLabel(value) {
  if (typeof value !== 'string' || /[\p{Cc}\p{Cf}]/u.test(value)) return null;
  const label = value.normalize('NFC').replace(/\p{White_Space}+/gu, ' ').trim();
  if (!label || label.length > 200 || /[<>`*\[\]]/.test(label)) return null;
  return label;
}
