export function validMeasurementId(value) {
  return typeof value === 'string' && /^G-[A-Z0-9]{8,20}$/.test(value) ? value : null;
}
