import { MAX_CALENDAR_TEXT_BYTES } from '../ai/holidayExtraction.js';

export const PDF_LIMITS = Object.freeze({
  fileBytes: 10 * 1024 * 1024,
  pages: 50,
  textBytes: MAX_CALENDAR_TEXT_BYTES,
  deadlineMs: 10_000,
  cleanupMs: 250,
  heapMb: 128,
  textItems: 100_000,
  rawTextBytes: 1_000_000,
});
