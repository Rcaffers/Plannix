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

export const env = Object.freeze({
  nodeEnv: String(process.env.NODE_ENV || 'development').trim().toLowerCase(),
  port: parsePort(process.env.PORT || process.env.AUTH_PORT, 4000),
  trustProxyHops: Number(process.env.TRUST_PROXY_HOPS ?? 1) || 1,
  frontendOrigins: parseOrigins(process.env.FRONTEND_ORIGIN),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  corsDebug: process.env.CORS_DEBUG === 'true',
  enableDemoUser: process.env.ENABLE_DEMO_USER === 'true',
  distDirectory: path.join(serverDirectory, '..', '..', 'dist'),
});

export function validateProductionEnv(config = env) {
  if (config.nodeEnv === 'production' && config.enableDemoUser) {
    throw new Error('ENABLE_DEMO_USER must not be enabled in production.');
  }
}
