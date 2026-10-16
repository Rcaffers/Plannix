import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerAuthRuntime } from './serverAuthRuntime.js';
import { validateProductionEnv } from '../config/env.js';

const config={authMode:'server',nodeEnv:'test',supabaseUrl:'https://synthetic.supabase.test',
  supabasePublishableKey:'synthetic-public',supabaseSecretKey:'synthetic-service',
  serverAuthOrigin:'https://app.plannix.test',
  serverAuthRateKey:Buffer.alloc(32,5).toString('base64url'),
  serverAuthRateEpoch:'1',
  serverAuthCsrfKey:Buffer.alloc(32,3).toString('base64url')};
const environment={PLANNIX_SESSION_TOKEN_KEYS_JSON:JSON.stringify({test:Buffer.alloc(32,4).toString('base64url')}),
  PLANNIX_SESSION_TOKEN_ACTIVE_KEY_ID:'test'};

test('server mode fails closed without its private configuration',()=>{
  assert.throws(()=>createServerAuthRuntime({config:{...config,authMode:'bearer'}}),/disabled/);
  assert.throws(()=>createServerAuthRuntime({config:{...config,serverAuthRateKey:''}}),/Shared auth limiter/);
  assert.throws(()=>createServerAuthRuntime({config:{...config,serverAuthRateEpoch:''}}),/Shared auth limiter/);
  assert.throws(()=>createServerAuthRuntime({config:{...config,supabaseSecretKey:''}}),/unavailable/);
  assert.throws(()=>createServerAuthRuntime({config:{...config,serverAuthCsrfKey:'bad'},
    environment}),/CSRF key/);
  assert.throws(()=>createServerAuthRuntime({config,environment:{}}),/Session token unavailable/);
});

test('production cookie mode requires shared limiter and trusted ingress configuration',()=>{
  assert.throws(()=>createServerAuthRuntime({config:{...config,nodeEnv:'production'}}),
    /Shared auth limiter/);
  assert.throws(()=>validateProductionEnv({...config,nodeEnv:'production'}),
    /shared rate-limit/);
  const configured={...config,nodeEnv:'production',
    serverAuthRateKey:Buffer.alloc(32,5).toString('base64url'),
    serverAuthTrustedProxyCidrs:'127.0.0.0/24',
    serverAuthIngressCidrs:'127.0.0.0/24'};
  assert.doesNotThrow(()=>validateProductionEnv(configured));
  assert.doesNotThrow(()=>createServerAuthRuntime({config:configured,environment,
    createClientImpl:()=>({rpc:async()=>({data:{allowed:true,retry_after:30}})})}));
  assert.throws(()=>createServerAuthRuntime({config:{...configured,serverAuthTrustedProxyCidrs:'bad-cidr'},
    environment}),/Trusted proxy configuration/);
  for (const [field,value] of [
    ['serverAuthTrustedProxyCidrs','0.0.0.0/1'],
    ['serverAuthIngressCidrs','::/1'],
    ['serverAuthTrustedProxyCidrs','10.0.0.0/24,10.0.1.0/24'],
    ['serverAuthIngressCidrs','192.0.2.0/24,'],
    ['serverAuthTrustedProxyCidrs',','],
  ]) assert.throws(()=>createServerAuthRuntime({
    config:{...configured,[field]:value},environment,
  }),/Trusted proxy configuration/,`${field}: ${value}`);
});
