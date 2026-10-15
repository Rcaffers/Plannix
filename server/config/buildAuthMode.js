import fs from 'node:fs';
import path from 'node:path';

const MODES = new Set(['bearer', 'server']);

export function assertBuiltAuthMode(distDirectory, runtimeMode) {
  if (!MODES.has(runtimeMode)) throw new Error('Runtime authentication mode is invalid.');
  let value;
  try {
    const source = fs.readFileSync(path.join(distDirectory, 'auth-mode.json'), 'utf8');
    if (source.length > 128) throw new Error('Invalid build metadata.');
    value = JSON.parse(source);
  } catch {
    throw new Error('Frontend authentication build metadata is unavailable.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'authMode,version'
    || value.version !== 1 || !MODES.has(value.authMode)) {
    throw new Error('Frontend authentication build metadata is invalid.');
  }
  if (value.authMode !== runtimeMode) {
    throw new Error('Frontend and server authentication modes do not match.');
  }
  return value.authMode;
}

export function requireMatchingBuild(distDirectory, runtimeMode) {
  return (_req, res, next) => {
    try { assertBuiltAuthMode(distDirectory, runtimeMode); next(); }
    catch { res.status(503).type('text/plain').send('The application is temporarily unavailable.'); }
  };
}
