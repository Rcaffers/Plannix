import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';
import { createPrivateSessionRepository } from './privateSessionRepository.js';
import { createSessionTokenCipherFromEnvironment } from './sessionTokenCrypto.js';
import { createServerSupabaseIdentity } from './serverSupabaseIdentity.js';
import { createRequireServerSession } from './requireServerSession.js';
import { createServerSessionRouter } from './serverSessionRouter.js';
import { createDistributedAuthLimiter } from './distributedAuthLimiter.js';

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
    || (config.nodeEnv === 'production'
      && (!config.serverAuthTrustedProxyCidrs || !config.serverAuthIngressCidrs)))
    throw new Error('Shared auth limiter configuration is required.');
  if (!config.supabaseUrl || !config.supabasePublishableKey || !config.supabaseSecretKey) {
    throw new Error('Server auth provider configuration is unavailable.');
  }
  const service = createClientImpl(config.supabaseUrl, config.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const repository = createPrivateSessionRepository({
    rpc: (name, args) => service.rpc(name, args),
    cipher: createSessionTokenCipherFromEnvironment(environment),
  });
  const limiterKey = csrfKey(config.serverAuthRateKey);
  const limiter = createDistributedAuthLimiter({
    rpc:(name,args) => service.rpc(name,args), key:limiterKey,
    epoch:Number(config.serverAuthRateEpoch),
    trustedPeerCidrs:config.serverAuthTrustedProxyCidrs
      ? config.serverAuthTrustedProxyCidrs.split(',').map(value=>value.trim()) : [],
    trustedIngressCidrs:config.serverAuthIngressCidrs
      ? config.serverAuthIngressCidrs.split(',').map(value=>value.trim()) : [],
  });
  const identity = createServerSupabaseIdentity({ url: config.supabaseUrl,
    publishableKey: config.supabasePublishableKey, secretKey: config.supabaseSecretKey });
  const options = { repository, identity, origin: config.serverAuthOrigin,
    csrfKey: csrfKey(config.serverAuthCsrfKey), limiter, requireLogoutVersion: true };
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
