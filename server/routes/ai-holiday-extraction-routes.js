import { verifyHolidayJson } from '../ai/strictHolidayJson.js';
import express from 'express';
import { extractTextFromHolidayPdf } from '../pdf/extractTextFromHolidayPdf.js';
import { PDF_LIMITS } from '../pdf/pdfConfig.js';
import { requireSupabaseAuth } from '../middleware/requireSupabaseAuth.js';
import { createAccountDeletionRateLimit } from '../middleware/accountDeletionRateLimit.js';
import { generateStructuredJsonForUser } from '../ai/generateStructuredJson.js';
import { aiError } from '../ai/generationErrors.js';
import { validateHolidayExtractionInput, validateHolidaySuggestions, holidayGenerationInput, holidayRequestError } from '../ai/holidayExtraction.js';

const publicError = (statusCode, message) => Object.assign(new Error(message), { statusCode, expose: true });
const errors = Object.freeze({
  PDF_INVALID: [400, 'Use a valid, non-empty PDF document.'],
  PDF_TOO_LARGE: [413, 'PDF must be no larger than 10 MiB.'],
  PDF_ENCRYPTED: [422, 'Password-protected PDFs are not supported.'],
  PDF_TOO_MANY_PAGES: [422, 'PDF must contain no more than 50 pages.'],
  PDF_NO_TEXT: [422, 'This PDF has no readable text. Scanned PDFs require OCR, which is not supported.'],
  PDF_TEXT_TOO_LARGE: [413, 'PDF text exceeds the 50,000-byte limit. Use a shorter document.'],
  PDF_TIMEOUT: [504, 'PDF processing timed out. Please try a smaller document.'],
  PDF_CANCELLED: [409, 'Holiday extraction was cancelled.'],
  PDF_PROCESSING_FAILED: [422, 'Could not process this PDF safely. Try another document.'],
  AI_CREDENTIAL_UNAVAILABLE: [409, 'Connect an AI provider in Profile before extracting holidays.'],
  AI_CREDENTIAL_REJECTED: [422, 'Reconnect your AI provider key in Profile and try again.'],
  AI_RATE_LIMITED: [429, 'AI provider rate limit reached. Please try again later.'],
  AI_CANCELLED: [409, 'Holiday extraction was cancelled.'],
  AI_TIMEOUT: [504, 'Holiday extraction timed out. Please try again.'],
  AI_PROVIDER_UNAVAILABLE: [503, 'AI provider is temporarily unavailable. Please try again later.'],
  AI_INVALID_RESPONSE: [502, 'Could not obtain valid holiday suggestions. Please review your text and try again.'],
});
export function createHolidayExtractionRateLimit(options = {}) {
  const limiter = createAccountDeletionRateLimit({ limit: 5, windowMs: 15 * 60 * 1000, ...options });
  return (req, res, next) => limiter(req, res, error => next(error
    ? publicError(429, 'Too many holiday extraction attempts. Please try again later.') : undefined));
}
// No request/response objects enter the tracked work or its lock cleanup.
async function settleHolidayOperation({ input, data, pdf, userId, signal, extractPdf, generate }) {
  try {
    if (signal.aborted) throw aiError('AI_CANCELLED');
    let pageCount;
    if (pdf) {
      const parsed = await extractPdf({ data, signal });
      data = null;
      if (signal.aborted) throw aiError('AI_CANCELLED');
      pageCount = parsed.pageCount;
      input.text = parsed.text;
      validateHolidayExtractionInput(input);
    }
    const result = await generate(holidayGenerationInput(userId, input), { signal });
    if (signal.aborted) throw aiError('AI_CANCELLED');
    const suggestions = validateHolidaySuggestions(result, input);
    return pageCount === undefined ? suggestions : { ...suggestions, pageCount };
  } finally { data = null; input.text = ''; }
}
function ownSettlement(operation, pending, userId, token) {
  const settlement = operation.finally(() => { if (pending.get(userId) === token) pending.delete(userId); });
  // Explicitly observe rejection even after response cancellation has completed.
  void settlement.catch(() => {});
  return settlement;
}
export function registerAiHolidayExtractionRoutes({ app, requireAuth = requireSupabaseAuth,
  generate = generateStructuredJsonForUser, extractPdf = extractTextFromHolidayPdf, rateLimit = createHolidayExtractionRateLimit(), timeoutMs,
} = {}) {
  const pending = new Map();
  const execute = async (req, res, next) => {
    const userId = req.auth.userId;
    if (pending.has(userId)) return next(publicError(409, 'Holiday extraction is already in progress.'));
    const token = Symbol(); pending.set(userId, token);
    const controller = new AbortController();
    let timer, disconnected = false, timedOut = false;
    let stop;
    const deadline = new Promise((_, reject) => {
      stop = reject;
      timer = setTimeout(() => { timedOut = true; controller.abort(); reject(aiError('AI_TIMEOUT')); }, timeoutMs ?? (res.locals.pdfExtraction ? 45_000 : 35_000));
    });
    const disconnect = () => { disconnected = true; controller.abort(); stop(aiError('AI_CANCELLED')); };
    res.once('close', disconnect);
    req.once('aborted', disconnect);
    // Only this operation's settlement owns lock release. Promise.race observes
    // late rejection even if the HTTP response has already ended.
    if (req.aborted || res.destroyed) disconnect();
    const operationSettlementPromise = ownSettlement(settleHolidayOperation({
      input: res.locals.holidayInput, data: req.body, pdf: res.locals.pdfExtraction,
      userId, signal: controller.signal, extractPdf, generate,
    }), pending, userId, token);
    delete req.body; delete res.locals.holidayInput;
    const responsePromise = Promise.race([operationSettlementPromise, deadline]);
    try {
      const result = await responsePromise;
      if (!disconnected && !res.destroyed) res.json(result);
    } catch (error) {
      if (!disconnected && !res.destroyed) {
        const code = timedOut ? 'AI_TIMEOUT' : error?.code;
        const mapping = typeof code === 'string' && Object.hasOwn(errors, code) ? errors[code] : null;
        next(mapping ? publicError(...mapping) : new Error('Holiday extraction failed.'));
      }
    } finally {
      clearTimeout(timer);
      res.removeListener('close', disconnect); req.removeListener('aborted', disconnect);
      delete res.locals.holidayInput; delete req.body;
    }
  };
  app.post('/api/ai/holidays/extract', requireAuth, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (Object.keys(req.query).length) return next(holidayRequestError());
    if (req.headers['content-encoding'] !== undefined && req.headers['content-encoding'].toLowerCase() !== 'identity') return next(publicError(415, 'Compressed requests are not accepted.'));
    if (!req.is('application/json')) return next(publicError(415, 'Use application/json for holiday extraction.'));
    next();
  }, express.json({ limit: '64kb', strict: true, inflate: false, verify: verifyHolidayJson }), (req, res, next) => {
    try { res.locals.holidayInput = validateHolidayExtractionInput(req.body); next(); }
    catch { next(holidayRequestError()); }
  }, rateLimit, execute);

  app.post('/api/ai/holidays/extract-pdf', requireAuth, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try {
      const query = req.query;
      if (Object.keys(query).length !== 2 || !Object.hasOwn(query, 'boundaryStart') || !Object.hasOwn(query, 'boundaryEnd')) throw holidayRequestError();
      res.locals.holidayInput = validateHolidayExtractionInput({ text: 'PDF', academicYearStartDate: query.boundaryStart, academicYearEndDate: query.boundaryEnd });
      res.locals.pdfExtraction = true;
      if (req.headers['content-encoding'] !== undefined && req.headers['content-encoding'].toLowerCase() !== 'identity') return next(publicError(415, 'Compressed requests are not accepted.'));
      if (!req.is('application/pdf')) return next(publicError(415, 'Use application/pdf for PDF holiday extraction.'));
      if (Number(req.headers['content-length']) > PDF_LIMITS.fileBytes) return next(publicError(413, 'PDF must be no larger than 10 MiB.'));
      next();
    } catch { next(holidayRequestError()); }
  }, express.raw({ type: 'application/pdf', limit: PDF_LIMITS.fileBytes, inflate: false }), (req, res, next) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return next(publicError(400, 'Choose a non-empty PDF document.'));
    next();
  }, rateLimit, execute);
}
