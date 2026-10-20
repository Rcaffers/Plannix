import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

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
function header(req, name) {
  const raw = req.rawHeaders;
  if (raw !== undefined) {
    if (!Array.isArray(raw)) throw unavailable();
    const matches = [];
    for (let i=0; i<raw.length; i+=2) {
      if (typeof raw[i] !== 'string' || typeof raw[i+1] !== 'string') throw unavailable();
      if (raw[i].toLowerCase() === name) matches.push(raw[i+1]);
    }
    if (matches.length > 1) throw unavailable();
    return matches[0];
  }
  // Synthetic requests may not provide rawHeaders. Node HTTP requests do.
  const value = req.headers?.[name];
  if (Array.isArray(value)) throw unavailable();
  return value;
}

export function normalizedIp(value) {
  if (typeof value !== 'string' || value !== value.trim() || value.length > 64
    || /[,\s%\[\]]/.test(value)) return null;
  const family = isIP(value);
  if (family === 4) {
    const address = value.split('.').map(Number).join('.');
    return address === '0.0.0.0' || address === '255.255.255.255' ? null : address;
  }
  if (family !== 6) return null;
  try {
    // The URL parser canonicalizes equivalent IPv6 spellings. Map IPv4-mapped
    // IPv6 to IPv4 so the same visitor cannot consume two independent buckets.
    const canonical = new URL(`http://[${value}]/`).hostname.slice(1,-1);
    if (canonical === '::') return null;
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
    if (!mapped) return canonical;
    const high = Number.parseInt(mapped[1],16);
    const low = Number.parseInt(mapped[2],16);
    const address = `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
    return address === '0.0.0.0' || address === '255.255.255.255' ? null : address;
  } catch { return null; }
}

const proxyIdentityHeaders = ['do-connecting-ip','x-forwarded-for','forwarded',
  'x-real-ip','cf-connecting-ip','true-client-ip','x-client-ip'];

function networkIdentity(req, mode) {
  if (mode === 'direct') {
    if (proxyIdentityHeaders.some(name=>header(req,name) !== undefined)) throw unavailable();
    const peer = normalizedIp(req.socket?.remoteAddress);
    if (!peer) throw unavailable();
    return peer;
  }
  // This mode relies on a separately verified, unbypassable managed ingress
  // that removes every client-supplied copy before setting its own header.
  // In particular, synthetic req.headers and socket/Express proxy state are
  // never a substitute for the raw platform header.
  if (!Array.isArray(req.rawHeaders) || req.rawHeaders.length % 2) throw unavailable();
  const visitor = header(req,'do-connecting-ip');
  const normalized = normalizedIp(visitor);
  if (!normalized) throw unavailable();
  return normalized;
}

export function createDistributedAuthLimiter({ rpc, key, mode,
  epoch, deadlineMs = 3000 } = {}) {
  if (typeof rpc !== 'function' || !Buffer.isBuffer(key) || key.length < 32
    || !Number.isSafeInteger(epoch) || epoch < 1
    || !['digitalocean-managed','direct'].includes(mode)
    || !Number.isInteger(deadlineMs)
    || deadlineMs<1 || deadlineMs>3000) throw new Error('Shared auth limiter is not configured.');
  const hash = (category, scope, identity) => createHmac('sha256',key)
    .update(`${category}\0${scope}\0${identity}`).digest('hex');
  const keyTag = createHmac('sha256',key).update('plannix-auth-rate-key-v1').digest('hex');
  return Object.freeze({
    async check(req, category, { bindingName, email } = {}) {
      const policy = POLICY[category];
      if (!policy) throw new Error('Unknown auth rate category.');
      const network = networkIdentity(req,mode);
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
        rpc('plannix_auth_rate_attempt',{ attempts:keys, expected_epoch:epoch,
          expected_key_tag:keyTag }),
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
