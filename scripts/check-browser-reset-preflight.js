// Read-only. Deliberately does not load .env or print raw configuration/errors.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createClient} from '@supabase/supabase-js';

export function evaluateBrowserResetPreflight(database, gatewayConfig) {
  const modes=typeof gatewayConfig==='string'
    ? [...gatewayConfig.matchAll(/^\s*db-tx-end\s*=\s*"([^"]+)"\s*$/gm)] : [];
  return Object.freeze({
    postgresSupported:database?.postgresSupported===true,
    fsyncEnabled:database?.fsyncEnabled===true,
    fullPageWritesEnabled:database?.fullPageWritesEnabled===true,
    synchronousCommitEnabled:database?.synchronousCommitEnabled===true,
    primary:database?.primary===true,
    gatewayAlwaysCommits:modes.length===1 && modes[0][1]==='commit',
  });
}

export async function runBrowserResetPreflight({args=process.argv.slice(2),environment=process.env}={}) {
  const value=name=>args[args.indexOf(name)+1];
  const known=new Set(['--gateway-config','--expected-project','--local-disposable']);
  for(let i=0;i<args.length;i++) {
    if(!known.has(args[i]) || args.indexOf(args[i])!==i) throw Error('invalid configuration');
    if(args[i]!=='--local-disposable' && (!args[++i] || known.has(args[i]))) throw Error('invalid configuration');
  }
  if(!args.includes('--gateway-config') || args.includes('--local-disposable')===args.includes('--expected-project'))
    throw Error('explicit target and gateway configuration required');
  const url=new URL(environment.SUPABASE_URL);
  const local=args.includes('--local-disposable');
  if(url.username || url.password || url.search || url.hash || url.pathname!=='/'
    || (local ? !['localhost','127.0.0.1'].includes(url.hostname) || !['http:','https:'].includes(url.protocol)
      : !/^[a-z]{20}$/.test(value('--expected-project')) || url.hostname!==`${value('--expected-project')}.supabase.co`
        || url.protocol!=='https:' || url.port)) throw Error('target mismatch');
  if(!environment.SUPABASE_SECRET_KEY) throw Error('service access required');
  const source=value('--gateway-config');
  const gateway=readFileSync(source==='-' ? 0 : source,'utf8');
  if(Buffer.byteLength(gateway)>262144) throw Error('configuration too large');
  const client=createClient(url.href,environment.SUPABASE_SECRET_KEY,
    {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const {data,error}=await client.rpc('plannix_auth_browser_reset_preflight',{}, {get:true})
    .retry(false).abortSignal(AbortSignal.timeout(5000));
  if(error) throw Error('database preflight unavailable');
  return evaluateBrowserResetPreflight(data,gateway);
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const checks=await runBrowserResetPreflight();
    console.log(JSON.stringify(checks));
    if(!Object.values(checks).every(Boolean)) process.exitCode=1;
  } catch {
    console.error('Browser reset preflight failed: verify explicit target, secure service access, actual gateway configuration and database prerequisites.');
    process.exitCode=1;
  }
}
