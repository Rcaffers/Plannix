// Application API guard used only when explicit server auth mode is enabled.
import { createSessionRequestSecurity } from './sessionRequestSecurity.js';

export function createRequireServerSession({ repository, identity, origin, csrfKey,
  providerDeadlineMs = 8000 }) {
  const security = createSessionRequestSecurity({ origin, csrfKey });
  if (!repository?.resolveForApplication || !identity?.validateAccess
    || !Number.isInteger(providerDeadlineMs) || providerDeadlineMs < 1)
    throw new Error('Server session unavailable.');
  return async function requireServerSession(req,res,next) {
    res.set('Cache-Control','no-store');
    try {
      const header=security.guard(req);
      const selected=await repository.resolveForApplication(header);
      if (selected.state!=='current' || !selected.sessionName) {
        res.status(401).json({message:'Authentication is required.'});return;
      }
      security.verifyCsrf(req,selected.header);
      security.verifyExpectedSession(req,selected.sessionName);
      const tokens=selected;
      const bounded = async work => {
        let timer;
        try {
          return await Promise.race([Promise.resolve().then(work),new Promise((_,reject) => {
            timer=setTimeout(() => reject(new Error('Identity deadline exceeded.')),providerDeadlineMs);
          })]);
        } finally { clearTimeout(timer); }
      };
      let accessToken=tokens.accessToken;
      let tokenVersion=tokens.tokenVersion;
      try {
        await bounded(() => identity.validateAccess({accessToken,expectedUserId:tokens.ownerId}));
      } catch {
        if (!repository?.claimRefresh || !repository?.finishRefresh
          || !repository?.releaseRefresh || !identity?.refresh) {
          res.status(503).json({message:'Authentication service is temporarily unavailable.'});return;
        }
        // A cookie can outlive its provider access token. The database claim
        // serializes refresh across replicas; a failed or stale claim never
        // authorizes this application request with the old token.
        const claim=await repository.claimRefresh(selected.header,tokens.tokenVersion);
        if (claim.state!=='claimed' || claim.ownerId!==tokens.ownerId) {
          res.status(503).json({message:'Authentication service is temporarily unavailable.'});return;
        }
        try {
          const refreshed=await bounded(() => identity.refresh({refreshToken:claim.refreshToken,
            expectedUserId:claim.ownerId}));
          const finished=await repository.finishRefresh(claim,{accessToken:refreshed.access_token,
            refreshToken:refreshed.refresh_token});
          if (finished.state!=='refreshed') {
            res.status(503).json({message:'Authentication service is temporarily unavailable.'});return;
          }
          accessToken=refreshed.access_token;
          tokenVersion=finished.tokenVersion;
        } catch {
          res.status(503).json({message:'Authentication service is temporarily unavailable.'});return;
        } finally { await repository.releaseRefresh(claim).catch(() => {}); }
      }
      req.serverSession=Object.freeze({userId:tokens.ownerId,accessToken,
        sessionId:tokens.sessionId,tokenVersion});
      next();
    } catch(error) {
      if ([400,401,403,409].includes(error?.status)) {
        res.status(error.status).json({message:error.status === 403
          ? 'Request verification failed.' : error.status === 409
            ? 'Authentication changed. Reload and try again.' : 'Authentication is required.'});return;
      }
      res.status(503).json({message:'Authentication service is temporarily unavailable.'});
    }
  };
}
