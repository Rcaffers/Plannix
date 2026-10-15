// Server-session boundary mounted only in explicit server auth mode.
import express from 'express';
import { createHmac, randomUUID } from 'node:crypto';
import { createSessionRequestSecurity } from './sessionRequestSecurity.js';

const COOKIE_FLAGS = 'Path=/; Secure; HttpOnly; SameSite=Lax';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FLOW_ID = /^[0-9a-f]{32}$/;
const AUTH_CODE = /^[A-Za-z0-9_-]{1,2048}$/;
const EMAIL = /^[^\s@]{1,128}@[^\s@]{1,253}$/;
const fail = (status, message) => Object.assign(new Error(message), { status, safe:true });
const noCache = res => { res.set('Cache-Control','no-store'); res.set('Referrer-Policy','no-referrer'); };
const only = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const clearCookie = name => `${name}=; Max-Age=0; ${COOKIE_FLAGS}`;

export function createServerSessionRouter({ repository, identity, origin, csrfKey,
  providerDeadlineMs = 8000, now = () => Date.now(), requireLogoutVersion = false } = {}) {
  let target;
  try { target = new URL(origin); } catch { throw new Error('Exact application origin required.'); }
  if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password
    || target.pathname !== '/' || target.search || target.hash
    || (target.protocol === 'http:' && !['localhost','127.0.0.1'].includes(target.hostname))
    || !Buffer.isBuffer(csrfKey) || csrfKey.length < 32
    || !Number.isInteger(providerDeadlineMs) || providerDeadlineMs < 1
    || !repository?.resolve || !identity?.login) throw new Error('Stage 3 boundary is not configured.');
  const router = express.Router();
  const security = createSessionRequestSecurity({ origin, csrfKey });
  const limits = new Map();
  const guard = security.guard;
  const csrf = security.csrfFor;
  const verifyCsrf = security.verifyCsrf;

  function rate(req, category, maximum) {
    const key = `${category}:${createHmac('sha256',csrfKey).update(req.socket?.remoteAddress || '').digest('hex')}`;
    const current = now();
    for (const [name, entry] of limits) if (entry.until<=current) limits.delete(name);
    const entry = limits.get(key) || { count: 0, until: current+60000 };
    entry.count += 1;
    limits.set(key,entry);
    if (limits.size>10000) limits.delete(limits.keys().next().value);
    if (entry.count>maximum) throw fail(429,'Too many authentication attempts. Please wait before trying again.');
  }

  function cleanup(res, names) {
    for (const name of names || []) {
      if (/^__Host-plannix-[bsr]-[1-9][0-9]{0,15}$/.test(name)) res.append('Set-Cookie',clearCookie(name));
    }
  }

  async function resolve(req,res,{ allowMissing=false }={}) {
    const header = guard(req);
    const result = await repository.resolve(header);
    cleanup(res,result.cleanup);
    if (result.state==='missing' && allowMissing) return result;
    if (result.state!=='selected') throw fail(401,'Authentication is required.');
    return result;
  }

  async function deadline(promise) {
    let timer;
    try { return await Promise.race([promise,new Promise((_,reject) => {
      timer=setTimeout(() => reject(fail(503,'Authentication service is temporarily unavailable.')),
        providerDeadlineMs);
    })]); } finally { clearTimeout(timer); }
  }

  async function boundedMutation(operation, message) {
    const controller=new AbortController();
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(()=>operation(controller.signal)),
        new Promise((_,reject)=>{timer=setTimeout(()=>{
          controller.abort();
          reject(fail(503,message));
        },providerDeadlineMs);}),
      ]);
    } finally { clearTimeout(timer); }
  }

  function sendError(res,error) {
    const status = Number.isInteger(error?.status) && error.status>=400 && error.status<=599
      ? error.status : error?.kind==='credentials' ? 401
        : error?.kind==='confirmation' || error?.kind==='password' ? 403 : 503;
    const message = error?.kind==='confirmation' ? 'Please confirm your email before logging in.'
      : status===401 ? 'Authentication was not accepted.'
        : error?.kind==='password' ? 'Password verification failed.'
          : error?.safe ? error.message : 'Authentication service is temporarily unavailable.';
    res.status(status).json({ message });
  }

  function wrap(handler) {
    return async (req,res) => {
      noCache(res);
      try { await handler(req,res); }
      catch(error) { if (!res.headersSent) sendError(res,error); }
    };
  }

  router.use((req,res,next) => {
    noCache(res);
    try {
      guard(req);
      next();
    } catch(error) { sendError(res,error); }
  });
  router.use((req,res,next) => {
    if (!['GET','HEAD','OPTIONS'].includes(req.method) && !req.is('application/json')) {
      res.status(415).json({ message:'Authentication request body is invalid.' });
      return;
    }
    next();
  });
  router.use(express.json({ limit:'8kb', strict:true }));
  router.use((error, _req, res, _next) => {
    // body-parser errors may embed submitted passwords in message/body/stack.
    noCache(res);
    res.status(error?.status === 413 ? 413 : 400)
      .json({ message:'Authentication request body is invalid.' });
  });

  router.get('/bootstrap',wrap(async(req,res) => {
    if (Object.keys(req.query).length) throw fail(400,'Authentication request is invalid.');
    const chosen = await resolve(req,res,{allowMissing:true});
    if (chosen.state==='selected') return res.json({ ready:true, csrfToken:csrf(chosen.header) });
    rate(req,'bootstrap',15);
    const issued = await repository.issueBinding();
    if (issued.state!=='issued') throw fail(503,'Authentication service is temporarily unavailable.');
    res.append('Set-Cookie',issued.setCookie);
    return res.json({ ready:true, csrfToken:csrf(issued.setCookie.split(';')[0]) });
  }));

  router.get('/status',wrap(async(req,res) => {
    if (Object.keys(req.query).length) throw fail(400,'Authentication request is invalid.');
    const chosen = await resolve(req,res);
    if (!chosen.sessionName) return res.json({ authenticated:false, csrfToken:csrf(chosen.header) });
    const ordinary = await repository.readTokens(chosen.header,'ordinary');
    if (ordinary.state==='wrong-kind') {
      const recovery = await repository.inspect(chosen.header,'recovery');
      if (recovery.state==='current') return res.json({ authenticated:false, recovery:true,
        csrfToken:csrf(chosen.header) });
    }
    if (ordinary.state!=='current') return res.json({ authenticated:false,csrfToken:csrf(chosen.header) });
    await deadline(identity.validateAccess({ accessToken:ordinary.accessToken,
      expectedUserId:ordinary.ownerId }));
    return res.json({ authenticated:true,userId:ordinary.ownerId,
      sessionName:chosen.sessionName,csrfToken:csrf(chosen.header) });
  }));

  router.get('/me',wrap(async(req,res) => {
    if (Object.keys(req.query).length) throw fail(400,'Authentication request is invalid.');
    const chosen = await resolve(req,res);
    const tokens = await repository.readTokens(chosen.header,'ordinary');
    if (tokens.state!=='current') throw fail(401,'Authentication is required.');
    const user = await deadline(identity.loadCurrentUser({ accessToken:tokens.accessToken,
      expectedUserId:tokens.ownerId }));
    if (!user || user.id !== tokens.ownerId) throw fail(503,'Authentication service is temporarily unavailable.');
    return res.json({ user });
  }));

  router.put('/profile/name',wrap(async(req,res) => {
    if (!only(req.body,['firstName','lastName'])
      || ![req.body.firstName,req.body.lastName].every(value =>
        typeof value==='string' && value.trim().length>=1 && value.trim().length<=100)) {
      throw fail(400,'Profile details are invalid.');
    }
    const chosen = await resolve(req,res);
    security.verifyExpectedSession(req,chosen.sessionName);
    verifyCsrf(req,chosen.header);
    const tokens = await repository.readTokens(chosen.header,'ordinary');
    if (tokens.state!=='current') throw fail(401,'Authentication is required.');
    const user = await boundedMutation(signal=>identity.updateProfileName({ accessToken:tokens.accessToken,
      expectedUserId:tokens.ownerId, firstName:req.body.firstName.trim(),
      lastName:req.body.lastName.trim(),signal }),
    'Profile update could not be confirmed. Reload your profile before retrying.');
    if (user?.id !== tokens.ownerId) throw fail(503,'Authentication service is temporarily unavailable.');
    return res.json({ user });
  }));

  router.post('/profile/email',wrap(async(req,res) => {
    if (!only(req.body,['email']) || !EMAIL.test(req.body.email || '')) {
      throw fail(400,'Email address is invalid.');
    }
    rate(req,'email-change',5);
    const emailScope = await resolve(req,res);
    security.verifyExpectedSession(req,emailScope.sessionName);
    const { chosen,intentId } = await start(req,res,'ordinary');
    const tokens = await repository.readTokens(chosen.header,'ordinary');
    if (tokens.state!=='current') {
      await repository.settle(intentId,'failed').catch(() => {});
      throw fail(401,'Authentication is required.');
    }
    let setup; let claim;
    let providerAccepted=false;
    try {
      setup = await callbackSetup(chosen.header,'confirmation',intentId);
      claim = await repository.claimRefresh(chosen.header,tokens.tokenVersion);
      if (claim.state!=='claimed' || claim.ownerId!==tokens.ownerId) {
        throw fail(409,'Authentication changed. Reload and try again.');
      }
      const result = await boundedMutation(signal=>identity.requestEmailChange({
        accessToken:claim.accessToken, refreshToken:claim.refreshToken,
        expectedUserId:claim.ownerId, email:req.body.email.trim().toLowerCase(),
        ...setup,signal,
      }), 'Email change could not be confirmed. Check your email before retrying.');
      providerAccepted=true;
      const refreshed = await repository.finishRefresh(claim,{ accessToken:result.session.access_token,
        refreshToken:result.session.refresh_token });
      if (refreshed.state!=='refreshed') throw fail(409,'Authentication changed. Reload and try again.');
      claim=null;
      if (result.confirmationPending) {
        const ready = await repository.readyCallback(chosen.header,setup);
        if (ready.state!=='ready') throw fail(409,'Authentication changed. Reload and try again.');
        return res.json({ confirmationPending:true });
      }
      await repository.cancelCallback(chosen.header,setup);
      await deadline(identity.validateAccess({ accessToken:result.session.access_token,
        expectedUserId:tokens.ownerId }));
      return ordinaryFinish(res,intentId,{ user:{id:tokens.ownerId},session:result.session });
    } catch(error) {
      if (claim?.state==='claimed') await repository.releaseRefresh(claim).catch(() => {});
      if (setup) await repository.cancelCallback(chosen.header,setup).catch(() => {});
      await repository.settle(intentId,'failed').catch(() => {});
      throw providerAccepted
        ? fail(503,'Email change could not be confirmed. Check your email before retrying.')
        : error;
    }
  }));

  router.post('/profile/password',wrap(async(req,res) => {
    if (!only(req.body,['currentPassword','newPassword'])
      || ![req.body.currentPassword,req.body.newPassword].every(value =>
        typeof value==='string' && value.length>=8 && value.length<=128)) {
      throw fail(400,'Password details are invalid.');
    }
    rate(req,'password-change',5);
    const chosen = await resolve(req,res);
    security.verifyExpectedSession(req,chosen.sessionName);
    verifyCsrf(req,chosen.header);
    const tokens = await repository.readTokens(chosen.header,'ordinary');
    if (tokens.state!=='current') throw fail(401,'Authentication is required.');
    const owner = await deadline(identity.validateAccess({ accessToken:tokens.accessToken,
      expectedUserId:tokens.ownerId }));
    const claim = await repository.claimRefresh(chosen.header,tokens.tokenVersion);
    if (claim.state!=='claimed' || claim.ownerId!==tokens.ownerId) {
      throw fail(409,'Authentication changed. Reload and try again.');
    }
    let providerAccepted=false;
    try {
      const updated = await boundedMutation(signal=>identity.updateOrdinaryPassword({
        accessToken:claim.accessToken, refreshToken:claim.refreshToken,
        expectedUserId:claim.ownerId, email:owner.email,
        currentPassword:req.body.currentPassword, newPassword:req.body.newPassword,
        signal }), 'Password update could not be confirmed. Try signing in or using password recovery.');
      providerAccepted=true;
      const finished = await repository.finishRefresh(claim,{ accessToken:updated.access_token,
        refreshToken:updated.refresh_token });
      if (finished.state!=='refreshed') throw fail(409,'Authentication changed. Reload and try again.');
      return res.status(204).end();
    } catch(error) {
      await repository.releaseRefresh(claim).catch(() => {});
      throw providerAccepted
        ? fail(503,'Password update could not be confirmed. Try signing in or using password recovery.')
        : error;
    }
  }));

  async function start(req,res,kind) {
    const chosen = await resolve(req,res);
    verifyCsrf(req,chosen.header);
    const started = await repository.begin(chosen.header,kind);
    if (started.state!=='started') throw fail(409,'Authentication changed. Reload and try again.');
    return { chosen, intentId:started.intentId };
  }

  async function ordinaryFinish(res,intentId,result) {
    const settled = await repository.settle(intentId,'created', {
      confirmedOwnerId:result.user.id, accessToken:result.session.access_token,
      refreshToken:result.session.refresh_token });
    if (settled.state!=='created') throw fail(409,'Authentication changed. Reload and try again.');
    res.append('Set-Cookie',settled.setCookie);
    return res.json({ authenticated:true,user:result.user });
  }

  router.post('/login',wrap(async(req,res) => {
    if (!only(req.body,['email','password']) || !EMAIL.test(req.body.email || '')
      || typeof req.body.password!=='string' || req.body.password.length<1
      || req.body.password.length>128) throw fail(400,'Authentication request is invalid.');
    rate(req,'credential',8);
    const { intentId } = await start(req,res,'ordinary');
    try {
      const result = await deadline(identity.login({ email:req.body.email.trim().toLowerCase(),
        password:req.body.password }));
      await ordinaryFinish(res,intentId,result);
    } catch(error) {
      await repository.settle(intentId,'failed').catch(() => {});
      throw error;
    }
  }));

  async function callbackSetup(header,kind,intentId) {
    const state = randomUUID();
    const reserved = await repository.reserveCallback(header,{state,kind,intentId});
    if (reserved.state!=='reserved') throw fail(503,'Authentication service is temporarily unavailable.');
    const url = new URL('/__stage3/auth/callback',target);
    url.searchParams.set('state',state);
    url.searchParams.set('kind',kind);
    return { state, kind, redirectTo:url.toString(),
      onVerifier:async(flowId,verifier) => {
        const saved = await repository.attachCallback(header,{state,flowId,kind,verifier});
        if (saved.state!=='attached') throw fail(503,'Authentication service is temporarily unavailable.');
      } };
  }

  router.post('/signup',wrap(async(req,res) => {
    if (!only(req.body,['firstName','lastName','email','password'])
      || !EMAIL.test(req.body.email || '') || typeof req.body.password!=='string'
      || req.body.password.length<8 || req.body.password.length>128
      || ![req.body.firstName,req.body.lastName].every(value =>
        typeof value==='string' && value.trim().length>=1 && value.trim().length<=100)) {
      throw fail(400,'Authentication request is invalid.');
    }
    rate(req,'credential',8);
    const { chosen,intentId } = await start(req,res,'ordinary');
    let setup;
    try {
      setup = await callbackSetup(chosen.header,'confirmation',intentId);
      const result = await deadline(identity.signup({ email:req.body.email.trim().toLowerCase(),
        password:req.body.password, firstName:req.body.firstName.trim(),lastName:req.body.lastName.trim(),
        ...setup }));
      if (result.confirmationPending) {
        const ready = await repository.readyCallback(chosen.header,setup);
        if (ready.state!=='ready') throw fail(503,'Authentication service is temporarily unavailable.');
        return res.json({ confirmationPending:true });
      }
      await repository.cancelCallback(chosen.header,setup);
      await ordinaryFinish(res,intentId,result);
    } catch(error) {
      if (setup) await repository.cancelCallback(chosen.header,setup).catch(() => {});
      await repository.settle(intentId,'failed').catch(() => {});
      throw error;
    }
  }));

  router.post('/recover',wrap(async(req,res) => {
    if (!only(req.body,['email']) || !EMAIL.test(req.body.email || '')) {
      throw fail(400,'Authentication request is invalid.');
    }
    rate(req,'recovery',5);
    const chosen = await resolve(req,res);
    verifyCsrf(req,chosen.header);
    const started = await repository.begin(chosen.header,'recovery');
    if (started.state!=='started') throw fail(409,'Authentication changed. Reload and try again.');
    let setup;
    try {
      setup = await callbackSetup(chosen.header,'recovery',started.intentId);
      await deadline(identity.sendRecovery({ email:req.body.email.trim().toLowerCase(), ...setup }));
      const ready = await repository.readyCallback(chosen.header,setup);
      if (ready.state!=='ready') throw fail(503,'Authentication service is temporarily unavailable.');
    } catch {
      if (setup) await repository.cancelCallback(chosen.header,setup).catch(() => {});
      await repository.settle(started.intentId,'failed').catch(() => {});
      // Email issuance may have succeeded despite a timeout. Its link remains
      // unusable because the callback reservation is terminal or never ready.
    }
    return res.json({ message:'If an account exists for that email, a recovery link will be sent.' });
  }));

  router.get('/callback',wrap(async(req,res) => {
    const pairs = new URL(req.originalUrl,target).searchParams;
    const expected = ['code','kind','sb_flow_id','state'];
    if ([...pairs.keys()].sort().join(',')!==expected.join(',')
      || !UUID.test(pairs.get('state') || '') || !FLOW_ID.test(pairs.get('sb_flow_id') || '')
      || !AUTH_CODE.test(pairs.get('code') || '')
      || !['confirmation','recovery'].includes(pairs.get('kind'))) {
      throw fail(400,'Authentication callback is invalid.');
    }
    rate(req,'callback',10);
    const chosen = await resolve(req,res);
    const kind = pairs.get('kind');
    const claimed = await repository.claimCallback(chosen.header,{ state:pairs.get('state'),
      flowId:pairs.get('sb_flow_id'),kind });
    if (claimed.state!=='claimed') throw fail(400,'Authentication callback is invalid.');
    try {
      const result = await deadline(identity.exchange({ code:pairs.get('code'),
        flowId:pairs.get('sb_flow_id'),verifier:claimed.verifier }));
      if (result.kind!==(kind==='recovery'?'recovery':'ordinary')) throw fail(400,'Authentication callback is invalid.');
      const settled = await repository.settle(claimed.intentId,'created',{
        confirmedOwnerId:result.kind==='recovery'?result.userId:result.user.id,
        accessToken:result.session.access_token,refreshToken:result.session.refresh_token });
      if (settled.state!=='created') throw fail(409,'Authentication changed. Reload and try again.');
      res.append('Set-Cookie',settled.setCookie);
      return res.redirect(303,result.kind==='recovery'?'/reset-password'
        : result.redirectType==='email_change'?'/profile':'/settings');
    } catch(error) { await repository.settle(claimed.intentId,'failed').catch(() => {}); throw error; }
  }));

  router.post('/recovery/password',wrap(async(req,res) => {
    if (!only(req.body,['password']) || typeof req.body.password!=='string'
      || req.body.password.length<8 || req.body.password.length>128) throw fail(400,'Authentication request is invalid.');
    rate(req,'recovery-update',5);
    const chosen = await resolve(req,res);
    verifyCsrf(req,chosen.header);
    const tokens = await repository.readTokens(chosen.header,'recovery');
    if (tokens.state!=='current') throw fail(401,'Recovery session is required.');
    await deadline(identity.updateRecoveryPassword({ accessToken:tokens.accessToken,
      refreshToken:tokens.refreshToken,password:req.body.password,expectedUserId:tokens.ownerId }));
    const loggedOut = await repository.logout(chosen.header);
    cleanup(res,[loggedOut.cleanup].filter(Boolean));
    return res.status(204).end();
  }));

  router.post('/refresh',wrap(async(req,res) => {
    if (!only(req.body,[])) throw fail(400,'Authentication request is invalid.');
    const chosen = await resolve(req,res);
    verifyCsrf(req,chosen.header);
    const current = await repository.inspect(chosen.header,'ordinary');
    if (current.state!=='current') throw fail(401,'Authentication is required.');
    const claim = await repository.claimRefresh(chosen.header,current.tokenVersion);
    if (claim.state!=='claimed') throw fail(409,'Session refresh is already in progress or changed.');
    try {
      const refreshed = await deadline(identity.refresh({ refreshToken:claim.refreshToken,
        expectedUserId:claim.ownerId }));
      const finished = await repository.finishRefresh(claim,{accessToken:refreshed.access_token,
        refreshToken:refreshed.refresh_token});
      if (finished.state!=='refreshed') throw fail(409,'Session refresh changed.');
      return res.json({ refreshed:true,tokenVersion:finished.tokenVersion });
    } catch(error) { await repository.releaseRefresh(claim).catch(() => {}); throw error; }
  }));

  router.post('/logout',wrap(async(req,res) => {
    if (!only(req.body,requireLogoutVersion?['expectedSessionName']:[]))
      throw fail(400,'Authentication request is invalid.');
    const chosen = await resolve(req,res);
    if (!chosen.sessionName) return res.status(204).end();
    security.verifyExpectedSession(req,chosen.sessionName);
    verifyCsrf(req,chosen.header);
    if (requireLogoutVersion && chosen.sessionName!==req.body.expectedSessionName)
      throw fail(409,'Authentication changed. Reload and try again.');
    const result = await repository.logout(chosen.header);
    cleanup(res,[result.cleanup].filter(Boolean));
    return res.status(204).end();
  }));

  router.delete('/account',wrap(async(req,res) => {
    if (!only(req.body,requireLogoutVersion?['password','expectedSessionName']:['password'])
      || typeof req.body.password!=='string'
      || req.body.password.length<1 || req.body.password.length>128) throw fail(400,'Authentication request is invalid.');
    rate(req,'deletion',3);
    const chosen = await resolve(req,res);
    security.verifyExpectedSession(req,chosen.sessionName);
    verifyCsrf(req,chosen.header);
    if (requireLogoutVersion && chosen.sessionName!==req.body.expectedSessionName)
      throw fail(409,'Authentication changed. Reload and try again.');
    const tokens = await repository.readTokens(chosen.header,'ordinary');
    if (tokens.state!=='current') throw fail(401,'Authentication is required.');
    const verified = await deadline(identity.validateAccess({accessToken:tokens.accessToken,
      expectedUserId:tokens.ownerId}));
    await deadline(identity.deleteAccount({userId:tokens.ownerId,email:verified.email,
      password:req.body.password}));
    // auth.users deletion can cascade the private session row before logout.
    // The captured cookie name is an exact version and safe to clear after a
    // confirmed deletion, even when the row has already disappeared.
    await repository.logout(chosen.header).catch(() => {});
    cleanup(res,[chosen.sessionName]);
    return res.status(204).end();
  }));

  return router;
}
