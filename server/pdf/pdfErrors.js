const messages = Object.freeze({
  PDF_INVALID: 'Provide a valid, complete PDF document.',
  PDF_TOO_LARGE: 'The PDF exceeds the 10 MiB limit.',
  PDF_ENCRYPTED: 'Encrypted PDFs are not supported.',
  PDF_TOO_MANY_PAGES: 'The PDF exceeds the 50-page limit.',
  PDF_NO_TEXT: 'No readable text was found. Scanned PDFs require text to be pasted instead.',
  PDF_TEXT_TOO_LARGE: 'The extracted text exceeds the allowed text limit.',
  PDF_TIMEOUT: 'PDF processing timed out.',
  PDF_CANCELLED: 'PDF processing was cancelled.',
  PDF_PROCESSING_FAILED: 'The PDF could not be processed safely.',
});
export const PDF_ERROR_CODES = Object.freeze(Object.keys(messages));
export function pdfError(code) {
  const safeCode = Object.hasOwn(messages, code) ? code : 'PDF_PROCESSING_FAILED';
  return Object.freeze(Object.assign(new Error(messages[safeCode]), {
    code: safeCode, retryable: safeCode === 'PDF_TIMEOUT' || safeCode === 'PDF_PROCESSING_FAILED',
  }));
}
