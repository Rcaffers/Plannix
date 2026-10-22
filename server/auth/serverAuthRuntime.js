import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';
import { createPrivateSessionRepository } from './privateSessionRepository.js';
import { createSessionTokenCipherFromEnvironment } from './sessionTokenCrypto.js';
import { createServerSupabaseIdentity } from './serverSupabaseIdentity.js';
import { createRequireServerSession } from './requireServerSession.js';
import { createServerSessionRouter } from './serverSessionRouter.js';
import { createDistributedAuthLimiter } from './distributedAuthLimiter.js';
import { measureAuth, measureAuthMethods, measureAuthSync } from '../observability/authPerformance.js';

function csrfKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43,}$/.test(value)) throw new Error('Server auth CSRF key is unavailable.');
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length < 32 || decoded.toString('base64url') !== value) throw new Error('Server auth CSRF key is unavailable.');
  return decoded;
}

export function createServerAuthRuntime({ config = env, environment = process.env,
  createClientImpl = createClient } = {}) {
  if (config.authMode !== 'server') throw new Error('Server auth mode is disabled.');
  if (!config.serverAuthRateKey
    || !/^[1-9][0-9]*$/.test(config.serverAuthRateEpoch || '')
    || !Number.isSafeInteger(Number(config.serverAuthRateEpoch))
    || !['digitalocean-managed','direct'].includes(config.serverAuthNetworkIdentityMode))
    throw new Error('Shared auth limiter configuration is required.');
  if (!config.supabaseUrl || !config.supabasePublishableKey || !config.supabaseSecretKey) {
    throw new Error('Server auth provider configuration is unavailable.');
  }
  const service = createClientImpl(config.supabaseUrl, config.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const cipher = createSessionTokenCipherFromEnvironment(environment);
  const repository = measureAuthMethods(createPrivateSessionRepository({
    rpc: (name, args) => service.rpc(name, args),
    cipher: { ...cipher, decrypt: args => measureAuthSync('auth.tokenDecrypt',
      () => cipher.decrypt(args)) },
  }), 'auth.repository');
  const limiterKey = csrfKey(config.serverAuthRateKey);
  const limiter = createDistributedAuthLimiter({
    rpc:(name,args) => service.rpc(name,args), key:limiterKey,
    epoch:Number(config.serverAuthRateEpoch),
    mode:config.serverAuthNetworkIdentityMode,
  });
  const rawIdentity = createServerSupabaseIdentity({ url: config.supabaseUrl,
    publishableKey: config.supabasePublishableKey, secretKey: config.supabaseSecretKey });
  const identity = Object.freeze({ ...rawIdentity,
    login: args => measureAuth('auth.identity.login', () => rawIdentity.login(args)),
    validateAccess: args => measureAuth('auth.identity.validateAccess',
      () => rawIdentity.validateAccess(args)),
    loadCurrentUser: args => measureAuth('auth.identity.loadCurrentUser',
      () => rawIdentity.loadCurrentUser(args)) });
  const options = { repository, identity, origin: config.serverAuthOrigin,
    csrfKey: csrfKey(config.serverAuthCsrfKey),
    limiter: { check: (...args) => measureAuth('auth.limiter', () => limiter.check(...args)) },
    callbackDiagnosticsEnabled: config.serverAuthCallbackDiagnosticsEnabled === true,
    requireLogoutVersion: true };
  const sessionGuard = createRequireServerSession(options);
  return Object.freeze({
    authRouter: createServerSessionRouter(options),
    requireAuth(req, res, next) {
      if (req.headers.authorization) {
        res.status(401).json({ message: 'Authentication is required.' });
        return;
      }
      sessionGuard(req, res, error => {
        if (error) return next(error);
        req.auth = Object.freeze({ userId: req.serverSession.userId,
          accessToken: req.serverSession.accessToken });
        next();
      });
    },
  });
}

let runtime;
export function getServerAuthRuntime() {
  runtime ||= createServerAuthRuntime();
  return runtime;
}
