import { verifyHolidayJson } from '../ai/strictHolidayJson.js';
import express from 'express';
import { requireSupabaseAuth } from '../middleware/requireSupabaseAuth.js';
import { createAccountDeletionRateLimit } from '../middleware/accountDeletionRateLimit.js';
import { generateStructuredJsonForUser } from '../ai/generateStructuredJson.js';
import { aiError } from '../ai/generationErrors.js';
import { validateHolidayExtractionInput, validateHolidaySuggestions, holidayGenerationInput, holidayRequestError } from '../ai/holidayExtraction.js';

const publicError = (statusCode, message) => Object.assign(new Error(message), { statusCode, expose: true });
const errors = Object.freeze({
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
export function registerAiHolidayExtractionRoutes({ app, requireAuth = requireSupabaseAuth,
  generate = generateStructuredJsonForUser, rateLimit = createHolidayExtractionRateLimit(), timeoutMs = 35_000,
} = {}) {
  const pending = new Map();
  app.post('/api/ai/holidays/extract', requireAuth, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (Object.keys(req.query).length) return next(holidayRequestError());
    if (req.headers['content-encoding'] !== undefined && req.headers['content-encoding'].toLowerCase() !== 'identity') return next(publicError(415, 'Compressed requests are not accepted.'));
    if (!req.is('application/json')) return next(publicError(415, 'Use application/json for holiday extraction.'));
    next();
  }, express.json({ limit: '64kb', strict: true, inflate: false, verify: verifyHolidayJson }), (req, res, next) => {
    try { res.locals.holidayInput = validateHolidayExtractionInput(req.body); next(); }
    catch { next(holidayRequestError()); }
  }, rateLimit, async (req, res, next) => {
    const userId = req.auth.userId;
    if (pending.has(userId)) return next(publicError(409, 'Holiday extraction is already in progress.'));
    const token = Symbol(); pending.set(userId, token);
    const controller = new AbortController();
    let timer, disconnected = false, timedOut = false;
    const release = () => { if (pending.get(userId) === token) pending.delete(userId); };
    let stop;
    const deadline = new Promise((_, reject) => {
      stop = reject;
      timer = setTimeout(() => { timedOut = true; controller.abort(); reject(aiError('AI_TIMEOUT')); }, timeoutMs);
    });
    const disconnect = () => { disconnected = true; controller.abort(); stop(aiError('AI_CANCELLED')); };
    res.once('close', disconnect);
    req.once('aborted', disconnect);
    // Only this operation's settlement owns lock release. Promise.race observes
    // late rejection even if the HTTP response has already ended.
    const input = res.locals.holidayInput;
    const operation = Promise.resolve().then(() => {
      if (req.aborted || res.destroyed || controller.signal.aborted) throw aiError('AI_CANCELLED');
      return generate(holidayGenerationInput(userId, input), { signal: controller.signal });
    }).finally(release);
    try {
      const result = await Promise.race([operation, deadline]);
      if (!disconnected && !res.destroyed) res.json(validateHolidaySuggestions(result, input));
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
  });
}
