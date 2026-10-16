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

function singleIp(value) {
  return typeof value === 'string' && value === value.trim()
    && !value.includes(',') && isIP(value) ? value : null;
}

// Limit each family across the *whole* list, so several adjacent small CIDRs
// cannot silently amount to an internet-wide trust rule.
function compileNarrowCidrs(values) {
  if (!Array.isArray(values) || values.length > 32) throw new Error('Trusted proxy configuration is invalid.');
  const ranges = { 4:[], 6:[] };
  for (const value of values) {
    if (typeof value !== 'string' || value !== value.trim())
      throw new Error('Trusted proxy configuration is invalid.');
    const match = /^([^/]+)\/(0|[1-9][0-9]*)$/.exec(value);
    if (!match) throw new Error('Trusted proxy configuration is invalid.');
    const family = isIP(match[1]);
    const bits = Number(match[2]);
    const width = family === 4 ? 32 : 128;
    const minimum = family === 4 ? 24 : 64;
    if (!family || !Number.isSafeInteger(bits) || bits < minimum || bits > width)
      throw new Error('Trusted proxy configuration is invalid.');
    let parts;
    if (family === 4) parts = match[1].split('.').map(Number);
    else {
      if (match[1].includes('%')) throw new Error('Trusted proxy configuration is invalid.');
      let addressText = match[1].toLowerCase();
      // Parse embedded dotted IPv4 into the same 128-bit form as hexadecimal
      // IPv6 before checking the mapped-address range.
      if (addressText.includes('.')) {
        const colon = addressText.lastIndexOf(':');
        const dotted = addressText.slice(colon+1);
        if (colon < 0 || isIP(dotted) !== 4)
          throw new Error('Trusted proxy configuration is invalid.');
        const octets = dotted.split('.').map(Number);
        addressText = `${addressText.slice(0,colon+1)}${((octets[0]<<8)|octets[1]).toString(16)}:${((octets[2]<<8)|octets[3]).toString(16)}`;
      }
      const halves = addressText.split('::');
      if (halves.length > 2) throw new Error('Trusted proxy configuration is invalid.');
      const left = halves[0] ? halves[0].split(':') : [];
      const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
      const words = [...left, ...Array(8-left.length-right.length).fill('0'), ...right];
      if (words.length !== 8 || words.some(word=>!/^[0-9a-f]{1,4}$/.test(word)))
        throw new Error('Trusted proxy configuration is invalid.');
      parts = words.flatMap(word => [Number.parseInt(word,16) >> 8, Number.parseInt(word,16) & 255]);
    }
    const address = parts.reduce((total,part)=>(total << 8n) | BigInt(part),0n);
    const size = 1n << BigInt(width-bits);
    if (address % size !== 0n) throw new Error('Trusted proxy configuration is invalid.');
    if (family === 6) {
      const mappedStart = 0xffffn << 32n;
      const mappedEnd = mappedStart + (1n << 32n) - 1n;
      if (address <= mappedEnd && address + size - 1n >= mappedStart)
        throw new Error('Trusted proxy configuration is invalid.');
    }
    ranges[family].push({ start:address, end:address+size-1n, size });
  }
  for (const family of [4,6]) {
    const entries = ranges[family].sort((a,b)=>a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
    const maximum = 1n << BigInt(family === 4 ? 8 : 64);
    let coverage = 0n;
    for (let i=0;i<entries.length;i++) {
      if (i && entries[i].start <= entries[i-1].end)
        throw new Error('Trusted proxy configuration is invalid.');
      coverage += entries[i].size;
      if (coverage > maximum) throw new Error('Trusted proxy configuration is invalid.');
    }
  }
  try { return values.length ? proxyaddr.compile(values) : () => false; }
  catch { throw new Error('Trusted proxy configuration is invalid.'); }
}

function proxyIdentity(req, trustedPeer, trustedIngress) {
  const peer = req.socket?.remoteAddress;
  if (!peer || !isIP(peer)) throw unavailable();
  const forwarded = header(req,'x-forwarded-for');
  const connecting = header(req,'do-connecting-ip');
  // Competing client-IP claims are ambiguous. Do not silently choose one.
  if (header(req,'forwarded') !== undefined || header(req,'x-real-ip') !== undefined)
    throw unavailable();
  if (!trustedPeer(peer)) {
    if (forwarded !== undefined || connecting !== undefined) throw unavailable();
    return peer;
  }
  // App Platform documents do-connecting-ip as the visitor and XFF as its
  // ingress server. Neither is trusted unless the immediate peer is trusted.
  const client = singleIp(connecting);
  const ingress = singleIp(forwarded);
  if (!client || !ingress || !trustedIngress(ingress) || ingress === client) throw unavailable();
  return client;
}

export function createDistributedAuthLimiter({ rpc, key, trustedPeerCidrs = [],
  trustedIngressCidrs = [],
  epoch, deadlineMs = 3000 } = {}) {
  if (typeof rpc !== 'function' || !Buffer.isBuffer(key) || key.length < 32
    || !Number.isSafeInteger(epoch) || epoch < 1
    || !Array.isArray(trustedPeerCidrs) || !Array.isArray(trustedIngressCidrs)
    || !Number.isInteger(deadlineMs)
    || deadlineMs<1 || deadlineMs>3000) throw new Error('Shared auth limiter is not configured.');
  const trustedPeer = compileNarrowCidrs(trustedPeerCidrs);
  const trustedIngress = compileNarrowCidrs(trustedIngressCidrs);
  const hash = (category, scope, identity) => createHmac('sha256',key)
    .update(`${category}\0${scope}\0${identity}`).digest('hex');
  const keyTag = createHmac('sha256',key).update('plannix-auth-rate-key-v1').digest('hex');
  return Object.freeze({
    async check(req, category, { bindingName, email } = {}) {
      const policy = POLICY[category];
      if (!policy) throw new Error('Unknown auth rate category.');
      const network = proxyIdentity(req,trustedPeer,trustedIngress);
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
