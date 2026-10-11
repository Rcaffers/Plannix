// Future application API middleware; Stage 3 tests mount it, production does not.
import { createSessionRequestSecurity } from './sessionRequestSecurity.js';

export function createRequireServerSession({ repository, identity, origin, csrfKey,
  providerDeadlineMs = 8000 }) {
  const security = createSessionRequestSecurity({ origin, csrfKey });
  if (!repository?.resolve || !repository?.readTokens || !identity?.validateAccess
    || !Number.isInteger(providerDeadlineMs) || providerDeadlineMs < 1)
    throw new Error('Server session unavailable.');
  return async function requireServerSession(req,res,next) {
    res.set('Cache-Control','no-store');
    try {
      const header=security.guard(req);
      const selected=await repository.resolve(header);
      if (selected.state!=='selected' || !selected.sessionName) {
        res.status(401).json({message:'Authentication is required.'});return;
      }
      security.verifyCsrf(req,selected.header);
      const tokens=await repository.readTokens(selected.header,'ordinary');
      if (tokens.state!=='current') {
        res.status(401).json({message:'Authentication is required.'});return;
      }
      let timer;
      try {
        await Promise.race([
          identity.validateAccess({accessToken:tokens.accessToken,expectedUserId:tokens.ownerId}),
          new Promise((_,reject) => {
            timer=setTimeout(() => reject(new Error('Identity deadline exceeded.')),providerDeadlineMs);
          }),
        ]);
      } finally { clearTimeout(timer); }
      req.serverSession=Object.freeze({userId:tokens.ownerId,accessToken:tokens.accessToken,
        sessionId:tokens.sessionId,tokenVersion:tokens.tokenVersion});
      next();
    } catch(error) {
      if (error?.status === 400 || error?.status === 403 || error?.status === 401) {
        res.status(error.status).json({message:error.status === 403
          ? 'Request verification failed.' : 'Authentication is required.'});return;
      }
      res.status(503).json({message:'Authentication service is temporarily unavailable.'});
    }
  };
}
