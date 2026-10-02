import express from 'express';
import { verifyHolidayJson } from '../ai/strictHolidayJson.js';
import { validateImportInput, importGenerationInput, validateImportResult } from '../ai/importPreview.js';
import { validateImportImage } from '../ai/importImage.js';
import { extractCsvText, extractXlsxText, IMPORT_TABULAR_BYTES } from '../ai/importTabular.js';
import { generateStructuredJsonForUser } from '../ai/generateStructuredJson.js';
import { extractTextFromHolidayPdf } from '../pdf/extractTextFromHolidayPdf.js';
import { PDF_LIMITS } from '../pdf/pdfConfig.js';
import { IMPORT_IMAGE_BYTES } from '../../shared/importPreview.js';
import { requireSupabaseAuth } from '../middleware/requireSupabaseAuth.js';
import { createAccountDeletionRateLimit } from '../middleware/accountDeletionRateLimit.js';

const exposed = (statusCode, message, publicCode) => Object.assign(new Error(message),
  { statusCode, expose: true, ...(publicCode ? { publicCode } : {}) });
const invalid = () => exposed(400, 'Check the destination, source and academic-year dates.');
const map = {
  PDF_INVALID: [400, 'Use a valid, non-empty PDF document.'],
  PDF_TOO_LARGE: [413, 'PDF must be no larger than 10 MiB.'],
  PDF_ENCRYPTED: [422, 'Password-protected PDFs are not supported.'],
  PDF_TOO_MANY_PAGES: [422, 'PDF must contain no more than 50 pages.'],
  PDF_NO_TEXT: [422, 'This PDF has no readable text. Scanned PDFs require OCR, which is not supported.'],
  PDF_TEXT_TOO_LARGE: [413, 'PDF text exceeds the 50,000-byte limit.'],
  PDF_TIMEOUT: [504, 'PDF processing timed out.'],
  PDF_PROCESSING_FAILED: [422, 'Could not process this PDF safely.'],
  AI_CREDENTIAL_UNAVAILABLE: [409, 'Connect an AI provider in Profile before extracting a preview.'],
  AI_CREDENTIAL_REJECTED: [422, 'Reconnect your AI provider key in Profile and try again.'],
  AI_RATE_LIMITED: [429, 'Your AI provider is currently rate limiting requests. Please try again later.'],
  AI_TIMEOUT: [504, 'Extraction timed out. Please try again.'],
  AI_PROVIDER_UNAVAILABLE: [503, 'AI provider is temporarily unavailable. Please try again later.'],
  AI_INVALID_RESPONSE: [502, 'Could not safely read the extracted suggestions. Please try again.'],
  IMPORT_TABULAR_INVALID: [422, 'Could not read this CSV or Excel file safely.'],
};
export function createImportPreviewRateLimit(options = {}) {
  const limiter = createAccountDeletionRateLimit({ limit: 5, windowMs: 15 * 60 * 1000, ...options });
  return (req, res, next) => limiter(req, res, error => next(error
    ? exposed(429, 'Too many import attempts. Please wait before trying again.', 'IMPORT_PREVIEW_ATTEMPT_LIMIT') : undefined));
}
function queryInput(req) {
  const params = new URL(req.originalUrl, 'http://plannix.invalid').searchParams;
  if ([...params.keys()].sort().join(',') !== 'boundaryEnd,boundaryStart,destination') throw invalid();
  try { return validateImportInput({ destination: params.get('destination'), text: '',
    academicYearStartDate: params.get('boundaryStart'), academicYearEndDate: params.get('boundaryEnd') }, { requireText: false }); }
  catch { throw invalid(); }
}
// The lock is released only when the underlying provider/PDF work settles,
// even if an HTTP cancellation or deadline completed the response earlier.
async function settle({ input, mode, data, userId, signal, generate, extractPdf }) {
  let image;
  try {
    if (signal.aborted) throw Object.assign(Error(), { code: 'AI_CANCELLED' });
    let pageCount;
    if (mode === 'pdf') {
      const parsed = await extractPdf({ data, signal });
      if (Buffer.isBuffer(data)) data.fill(0);
      data = null;
      pageCount = parsed.pageCount;
      input.text = parsed.text;
      validateImportInput(input);
    } else if (mode === 'image') image = validateImportImage(data, input.mimeType);
    else if (mode === 'csv' || mode === 'xlsx') {
      input.text = mode === 'csv' ? extractCsvText(data) : await extractXlsxText(data, { signal });
      if (Buffer.isBuffer(data)) data.fill(0);
      data = null;
      validateImportInput(input);
    }
    if (signal.aborted) throw Object.assign(Error(), { code: 'AI_CANCELLED' });
    const result = await generate(importGenerationInput(userId, input, image), { signal });
    if (signal.aborted) throw Object.assign(Error(), { code: 'AI_CANCELLED' });
    return { ...validateImportResult(result, input.destination), ...(pageCount ? { pageCount } : {}) };
  } finally {
    if (Buffer.isBuffer(data)) data.fill(0);
    else if (data && typeof data === 'object' && typeof data.text === 'string') data.text = '';
    input.text = '';
    if (image) image.data.fill(0);
  }
}
export function registerAiImportPreviewRoutes({ app, requireAuth = requireSupabaseAuth,
  generate = generateStructuredJsonForUser, extractPdf = extractTextFromHolidayPdf,
  rateLimit = createImportPreviewRateLimit(), timeoutMs = 45_000 } = {}) {
  const pending = new Map();
  async function execute(req, res, next) {
    const userId = req.auth.userId;
    if (pending.has(userId)) return next(exposed(409, 'An import preview is already in progress.'));
    const token = Symbol(); pending.set(userId, token);
    const controller = new AbortController();
    let timer, disconnected = false, timedOut = false, rejectDeadline;
    const deadline = new Promise((_, reject) => {
      rejectDeadline = reject;
      timer = setTimeout(() => { timedOut = true; controller.abort(); reject(exposed(504, 'Extraction timed out. Please try again.')); }, timeoutMs);
    });
    const disconnect = () => { disconnected = true; controller.abort(); rejectDeadline(Error('Cancelled')); };
    res.once('close', disconnect); req.once('aborted', disconnect);
    if (req.aborted || res.destroyed) disconnect();
    const work = settle({ input: res.locals.importInput, mode: res.locals.importMode, data: req.body,
      userId, signal: controller.signal, generate, extractPdf });
    const observed = work.finally(() => { if (pending.get(userId) === token) pending.delete(userId); });
    void observed.catch(() => {});
    delete req.body; delete res.locals.importInput;
    try {
      const result = await Promise.race([observed, deadline]);
      if (!disconnected && !res.destroyed) res.json(result);
    } catch (error) {
      if (!disconnected && !res.destroyed) {
        const code = timedOut ? 'AI_TIMEOUT' : error?.code;
        next(Object.hasOwn(map, code) ? exposed(...map[code], code === 'AI_RATE_LIMITED' ? 'AI_RATE_LIMITED' : undefined)
          : exposed(500, 'Could not create an import preview. Please try again.'));
      }
    } finally {
      clearTimeout(timer); res.removeListener('close', disconnect); req.removeListener('aborted', disconnect);
      delete req.body; delete res.locals.importInput;
    }
  }
  function common(req, res, next) {
    res.set('Cache-Control', 'no-store');
    if (req.headers['content-encoding'] !== undefined && req.headers['content-encoding'].toLowerCase() !== 'identity')
      return next(exposed(415, 'Compressed requests are not accepted.'));
    next();
  }
  app.post('/api/ai/import-preview/extract', requireAuth, common, (req, res, next) => {
    if (Object.keys(req.query).length || !req.is('application/json')) return next(invalid());
    next();
  }, express.json({ limit: '64kb', strict: true, inflate: false, verify: verifyHolidayJson }), (req, res, next) => {
    try { res.locals.importInput = validateImportInput(req.body); res.locals.importMode = 'text'; next(); }
    catch { next(invalid()); }
  }, rateLimit, execute);
  app.post('/api/ai/import-preview/extract-pdf', requireAuth, common, (req, res, next) => {
    try { res.locals.importInput = queryInput(req); res.locals.importMode = 'pdf';
      if (!req.is('application/pdf')) throw invalid();
      if (Number(req.headers['content-length']) > PDF_LIMITS.fileBytes) throw exposed(413, 'PDF must be no larger than 10 MiB.');
      next(); } catch (error) { next(error); }
  }, express.raw({ type: 'application/pdf', limit: PDF_LIMITS.fileBytes, inflate: false }), (req, res, next) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return next(exposed(400, 'Choose a non-empty PDF document.'));
    next();
  }, rateLimit, execute);
  app.post('/api/ai/import-preview/extract-image', requireAuth, common, (req, res, next) => {
    try { res.locals.importInput = queryInput(req); res.locals.importMode = 'image';
      const type = req.headers['content-type']?.split(';')[0].trim().toLowerCase();
      if (!['image/png', 'image/jpeg'].includes(type)) throw exposed(415, 'Choose a PNG or JPEG image.');
      res.locals.importInput.mimeType = type;
      if (Number(req.headers['content-length']) > IMPORT_IMAGE_BYTES) throw exposed(413, 'Image must be no larger than 4 MiB.');
      next(); } catch (error) { next(error); }
  }, express.raw({ type: ['image/png', 'image/jpeg'], limit: IMPORT_IMAGE_BYTES, inflate: false }), (req, res, next) => {
    try { validateImportImage(req.body, res.locals.importInput.mimeType); next(); }
    catch { next(exposed(400, 'Choose a valid PNG or JPEG image.')); }
  }, rateLimit, execute);
  for (const [mode, mime] of [['csv', 'text/csv'], ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']]) {
    app.post(`/api/ai/import-preview/extract-${mode}`, requireAuth, common, (req, res, next) => {
      try {
        res.locals.importInput = queryInput(req); res.locals.importMode = mode;
        if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== mime) throw exposed(415, 'Choose a CSV or Excel (.xlsx) file.');
        if (Number(req.headers['content-length']) > IMPORT_TABULAR_BYTES) throw exposed(413, 'CSV or Excel file must be no larger than 2 MiB.');
        next();
      } catch (error) { next(error); }
    }, express.raw({ type: mime, limit: IMPORT_TABULAR_BYTES, inflate: false }), (req, res, next) => {
      if (!Buffer.isBuffer(req.body) || !req.body.length) return next(exposed(400, 'Choose a non-empty CSV or Excel file.'));
      next();
    }, rateLimit, execute);
  }
}
