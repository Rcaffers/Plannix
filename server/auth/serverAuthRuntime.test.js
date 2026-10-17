import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerAuthRuntime } from './serverAuthRuntime.js';
import { validateProductionEnv } from '../config/env.js';

const config={authMode:'server',nodeEnv:'test',supabaseUrl:'https://synthetic.supabase.test',
  supabasePublishableKey:'synthetic-public',supabaseSecretKey:'synthetic-service',
  serverAuthOrigin:'https://app.plannix.test',
  serverAuthRateKey:Buffer.alloc(32,5).toString('base64url'),
  serverAuthRateEpoch:'1',
  serverAuthNetworkIdentityMode:'direct',
  serverAuthCsrfKey:Buffer.alloc(32,3).toString('base64url')};
const environment={PLANNIX_SESSION_TOKEN_KEYS_JSON:JSON.stringify({test:Buffer.alloc(32,4).toString('base64url')}),
  PLANNIX_SESSION_TOKEN_ACTIVE_KEY_ID:'test'};

test('server mode fails closed without its private configuration',()=>{
  assert.throws(()=>createServerAuthRuntime({config:{...config,authMode:'bearer'}}),/disabled/);
  assert.throws(()=>createServerAuthRuntime({config:{...config,serverAuthRateKey:''}}),/Shared auth limiter/);
  assert.throws(()=>createServerAuthRuntime({config:{...config,serverAuthRateEpoch:''}}),/Shared auth limiter/);
  for (const mode of ['', 'auto', 'proxy'])
    assert.throws(()=>createServerAuthRuntime({config:{...config,
      serverAuthNetworkIdentityMode:mode}}),/Shared auth limiter/);
  assert.throws(()=>createServerAuthRuntime({config:{...config,supabaseSecretKey:''}}),/unavailable/);
  assert.throws(()=>createServerAuthRuntime({config:{...config,serverAuthCsrfKey:'bad'},
    environment}),/CSRF key/);
  assert.throws(()=>createServerAuthRuntime({config,environment:{}}),/Session token unavailable/);
});

test('production cookie mode requires an explicit identity mode without CIDRs',()=>{
  assert.throws(()=>createServerAuthRuntime({config:{...config,nodeEnv:'production',
    serverAuthNetworkIdentityMode:''}}),/Shared auth limiter/);
  assert.throws(()=>validateProductionEnv({...config,nodeEnv:'production',
    serverAuthNetworkIdentityMode:''}),/shared rate-limit/);
  const configured={...config,nodeEnv:'production',
    serverAuthRateKey:Buffer.alloc(32,5).toString('base64url')};
  for (const mode of ['direct','digitalocean-managed']) {
    const selected={...configured,serverAuthNetworkIdentityMode:mode};
    assert.doesNotThrow(()=>validateProductionEnv(selected));
    assert.doesNotThrow(()=>createServerAuthRuntime({config:selected,environment,
      createClientImpl:()=>({rpc:async()=>({data:{allowed:true,retry_after:30}})})}));
  }
});

test('default bearer mode does not require network identity configuration',()=>{
  assert.doesNotThrow(()=>validateProductionEnv({...config,nodeEnv:'production',
    authMode:'bearer',serverAuthNetworkIdentityMode:'',
    supabaseUrl:'https://synthetic.supabase.test',
    supabasePublishableKey:'synthetic-public',supabaseSecretKey:'synthetic-service'}));
});
