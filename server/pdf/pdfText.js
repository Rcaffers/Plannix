import { PDF_LIMITS } from './pdfConfig.js';
import { pdfError } from './pdfErrors.js';

export function normalizePdfText(value) {
  const text = value.replace(/\r\n?/g, '\n').replace(/\0/g, '').normalize('NFC');
  if (/[\p{Cc}\p{Cf}]/u.test(text.replace(/[\n\t]/g, ''))) throw pdfError('PDF_INVALID');
  const normalized = text.replace(/[^\S\n]+/gu, ' ').replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n').trim();
  if (Buffer.byteLength(normalized, 'utf8') > PDF_LIMITS.textBytes) throw pdfError('PDF_TEXT_TOO_LARGE');
  return normalized;
}
