import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));

function parsePort(value, fallback) {
  const port = Number(value ?? fallback);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('PORT (or AUTH_PORT) must be an integer between 0 and 65535.');
  }
  return port;
}

function parseOrigins(value) {
  return String(value || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

export function parseTrustProxyHops(value) {
  if (value === undefined) return 1;
  if (!/^(0|[1-9]\d*)$/.test(String(value)) || Number(value) > 10) {
    throw new Error('TRUST_PROXY_HOPS must be an integer between 0 and 10.');
  }
  return Number(value);
}

export const env = Object.freeze({
  nodeEnv: String(process.env.NODE_ENV || 'development').trim().toLowerCase(),
  port: parsePort(process.env.PORT || process.env.AUTH_PORT, 4000),
  trustProxyHops: parseTrustProxyHops(process.env.TRUST_PROXY_HOPS),
  frontendOrigins: parseOrigins(process.env.FRONTEND_ORIGIN),
  corsDebug: process.env.CORS_DEBUG === 'true',
  supabaseUrl: String(process.env.SUPABASE_URL || '').trim(),
  supabasePublishableKey: String(process.env.SUPABASE_PUBLISHABLE_KEY || '').trim(),
  supabaseSecretKey: String(process.env.SUPABASE_SECRET_KEY || '').trim(),
  vapidPublicKey: String(process.env.VAPID_PUBLIC_KEY || '').trim(),
  vapidPrivateKey: String(process.env.VAPID_PRIVATE_KEY || '').trim(),
  vapidSubject: String(process.env.VAPID_SUBJECT || '').trim(),
  distDirectory: path.join(serverDirectory, '..', '..', 'dist'),
});

export function requireSupabasePublicConfig(config = env) {
  const missing = [];
  if (!config.supabaseUrl) missing.push('SUPABASE_URL');
  if (!config.supabasePublishableKey) missing.push('SUPABASE_PUBLISHABLE_KEY');
  if (missing.length) {
    throw new Error(`Missing server Supabase public configuration: ${missing.join(', ')}.`);
  }
  return {
    url: config.supabaseUrl,
    publishableKey: config.supabasePublishableKey,
  };
}

export function requireSupabaseAdminConfig(config = env) {
  const missing = [];
  if (!config.supabaseUrl) missing.push('SUPABASE_URL');
  if (!config.supabaseSecretKey) missing.push('SUPABASE_SECRET_KEY');
  if (missing.length) {
    throw new Error(`Missing server Supabase Admin configuration: ${missing.join(', ')}.`);
  }
  return {
    url: config.supabaseUrl,
    secretKey: config.supabaseSecretKey,
  };
}

export function validateProductionEnv(config = env) {
  if (config.nodeEnv === 'production') {
    requireSupabasePublicConfig(config);
    requireSupabaseAdminConfig(config);
  }
}
