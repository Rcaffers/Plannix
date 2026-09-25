import express from 'express';
import { requireSupabaseAuth } from '../middleware/requireSupabaseAuth.js';
import { createRequestSupabaseClient } from '../supabase/client.js';
import { getProvider } from '../ai/providers.js';
import { MAX_AI_KEY_LENGTH } from '../../shared/aiProviders.js';

class ConnectionError extends Error {
  constructor(statusCode, message) { super(message); this.statusCode = statusCode; this.expose = true; }
}
const failure = () => new ConnectionError(500, 'Could not update or load your AI connection. Please try again.');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export function validateConnectionInput(body) {
  if (!object(body) || Object.keys(body).length !== 2 || Object.keys(body).some(key => !['provider', 'apiKey'].includes(key))) {
    throw new ConnectionError(400, 'Only provider and apiKey are accepted.');
  }
  if (typeof body.provider !== 'string' || !getProvider(body.provider)) throw new ConnectionError(400, 'Choose a supported AI provider.');
  if (typeof body.apiKey !== 'string' || body.apiKey.length > MAX_AI_KEY_LENGTH || body.apiKey.trim().length < 5) {
    throw new ConnectionError(400, 'Enter an API key containing between 5 and 4096 characters.');
  }
  return { provider: body.provider, api_key: body.apiKey.trim() };
}
function metadata(row) {
  if (row === null) return null;
  const provider = getProvider(row?.provider);
  if (!provider || typeof row.lastFour !== 'string' || row.lastFour.length !== 4 || typeof row.active !== 'boolean') throw failure();
  return { provider: provider.id, providerLabel: provider.label, lastFour: row.lastFour, active: row.active };
}
export function registerAiConnectionRoutes({ app, requireAuth = requireSupabaseAuth, createRequestClient = createRequestSupabaseClient } = {}) {
  const pending = new Set();
  const operations = { get: 'get', post: 'create', put: 'replace', delete: 'delete' };
  for (const [method, operation] of Object.entries(operations)) {
    app[method]('/api/ai/connection', requireAuth, (req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      if (Object.keys(req.query).length) return next(new ConnectionError(400, 'Query parameters are not accepted.'));
      next();
    }, express.json({ limit: '8kb', strict: true }), async (req, res, next) => {
      let locked = false;
      try {
        const writing = method !== 'get';
        let input = {};
        if (['post','put'].includes(method)) input = validateConnectionInput(req.body);
        else if (req.body != null && (!object(req.body) || Object.keys(req.body).length)) throw new ConnectionError(400, 'This operation does not accept a request body.');
        if (writing) {
          if (pending.has(req.auth.userId)) throw new ConnectionError(409, 'An AI connection change is already in progress.');
          pending.add(req.auth.userId); locked = true;
        }
        // Ownership resolution happens inside the RPC using the validated JWT.
        const { data, error } = await createRequestClient(req.auth).rpc(`plannix_${operation}_personal_ai_connection`, input);
        if (error) {
          if (error.code === '23505') throw new ConnectionError(409, 'An AI connection already exists. Reload before changing it.');
          if (error.code === 'P0002') throw new ConnectionError(409, 'Your AI connection changed. Reload before trying again.');
          if (error.code === '42501') throw new ConnectionError(403, 'Your personal AI connection is unavailable. Sign in again or contact support.');
          throw failure();
        }
        if (['post','put'].includes(method) && data == null) throw failure();
        res.status(method === 'post' ? 201 : 200).json({ connection: method === 'delete' ? null : metadata(data) });
      } catch (error) { next(error instanceof ConnectionError ? error : failure()); }
      finally {
        if (locked) pending.delete(req.auth.userId);
        // Do not leave request credentials attached for downstream instrumentation.
        if (req.body && typeof req.body === 'object') delete req.body.apiKey;
      }
    });
  }
}
