import { env } from './config/env.js';
export { corsDelegate, inferredPublicOrigin } from './config/cors.js';

export const PORT = env.port;
export const SESSION_COOKIE = 'plannix_session';
export const DIST_DIR = env.distDirectory;
export const FRONTEND_ORIGINS = env.frontendOrigins;

export const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: env.cookieSecure,
  maxAge: 1000 * 60 * 60 * 24,
};
