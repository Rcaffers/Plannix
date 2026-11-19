import { toLocalYmd } from './academicYear.js';

export function pickerDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  return toLocalYmd(date) === value ? date : null;
}

export function pickerAddDays(value, days) {
  const date = pickerDate(value);
  date.setDate(date.getDate() + days);
  return toLocalYmd(date);
}

export function pickerMonday(value) {
  const date = pickerDate(value);
  return pickerAddDays(value, -((date.getDay() + 6) % 7));
}

export function pickerShiftMonth(value, offset) {
  const date = pickerDate(value), day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + offset);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, last));
  return toLocalYmd(date);
}

export const pickerClamp = (value, min, max) => value < min ? min : value > max ? max : value;

export function pickerDays(month) {
  const first = pickerMonday(`${month.slice(0, 7)}-01`);
  return Array.from({ length:42 }, (_, index) => pickerAddDays(first, index));
}
