import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import proxyaddr from 'proxy-addr';

const POLICY = Object.freeze({
  bootstrap:{ network:60, binding:90 },
  status:{ network:180, binding:150 },
  me:{ network:180, binding:150 },
  login:{ network:20, binding:12, networkEmail:8 },
  signup:{ network:10, binding:8, networkEmail:5 },
  recovery:{ network:10, binding:8, networkEmail:5 },
  callback:{ network:25, binding:12 },
  emailChange:{ network:10, binding:6 },
  profileName:{ network:30, binding:20 },
  passwordChange:{ network:10, binding:6 },
  recoveryUpdate:{ network:10, binding:6 },
  refresh:{ network:120, binding:90 },
  logout:{ network:120, binding:90 },
  deletion:{ network:6, binding:4 },
});

function unavailable() {
  return Object.assign(new Error('Authentication service is temporarily unavailable.'),
    { status:503, safe:true });
}
function limited(seconds) {
  return Object.assign(new Error('Too many authentication attempts. Please wait before trying again.'),
    { status:429, safe:true, retryAfter:Math.max(1,Math.min(60,Math.ceil(seconds))) });
}
function proxyIdentity(req, trustedProxy) {
  const peer = req.socket?.remoteAddress;
  if (!peer || !isIP(peer)) throw unavailable();
  const forwarded = req.headers['x-forwarded-for'];
  if (!trustedProxy(peer)) {
    if (forwarded !== undefined) throw unavailable();
    return peer;
  }
  // The ingress must overwrite X-Forwarded-For. Appended client input is
  // rejected rather than accepted as a different network identity.
  if (typeof forwarded !== 'string' || forwarded.includes(',')) throw unavailable();
  const client = forwarded.trim();
  if (!isIP(client)) throw unavailable();
  return client;
}

export function createDistributedAuthLimiter({ rpc, key, trustedProxyCidrs = [],
  deadlineMs = 3000 } = {}) {
  if (typeof rpc !== 'function' || !Buffer.isBuffer(key) || key.length < 32
    || !Array.isArray(trustedProxyCidrs) || !Number.isInteger(deadlineMs)
    || deadlineMs<1 || deadlineMs>3000) throw new Error('Shared auth limiter is not configured.');
  if (trustedProxyCidrs.some(value=>typeof value!=='string' || !value.trim()
    || /^(?:0\.0\.0\.0\/0|::\/0|all)$/i.test(value.trim())))
    throw new Error('Trusted proxy configuration is invalid.');
  let trustedProxy;
  try { trustedProxy = trustedProxyCidrs.length
    ? proxyaddr.compile(trustedProxyCidrs) : () => false; }
  catch { throw new Error('Trusted proxy configuration is invalid.'); }
  const hash = (category, scope, identity) => createHmac('sha256',key)
    .update(`${category}\0${scope}\0${identity}`).digest('hex');
  return Object.freeze({
    async check(req, category, { bindingName, email } = {}) {
      const policy = POLICY[category];
      if (!policy) throw new Error('Unknown auth rate category.');
      const network = proxyIdentity(req,trustedProxy);
      const keys = [{ key:hash(category,'network',network), maximum:policy.network }];
      if (bindingName && policy.binding)
        keys.push({ key:hash(category,'binding',bindingName), maximum:policy.binding });
      // An email bucket is deliberately paired with the network. A stranger
      // cannot globally exhaust the victim account's attempts from elsewhere.
      if (email && policy.networkEmail)
        keys.push({ key:hash(category,'network-email',`${network}\0${email.trim().toLowerCase()}`),
          maximum:policy.networkEmail });
      let result; let timer;
      try { result = await Promise.race([
        rpc('plannix_auth_rate_attempt',{ attempts:keys }),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(unavailable()),deadlineMs);}),
      ]); }
      catch { throw unavailable(); }
      finally { clearTimeout(timer); }
      if (result?.error || !result?.data || typeof result.data !== 'object') throw unavailable();
      const response = result.data;
      if (response.allowed === true) return;
      if (response.allowed === false && Number.isInteger(response.retry_after)
        && response.retry_after >= 1 && response.retry_after <= 60) throw limited(response.retry_after);
      throw unavailable();
    },
  });
}
