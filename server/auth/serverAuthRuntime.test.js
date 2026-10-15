import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerAuthRuntime } from './serverAuthRuntime.js';
import { validateProductionEnv } from '../config/env.js';

const config={authMode:'server',nodeEnv:'test',supabaseUrl:'https://synthetic.supabase.test',
  supabasePublishableKey:'synthetic-public',supabaseSecretKey:'synthetic-service',
  serverAuthOrigin:'https://app.plannix.test',
  serverAuthCsrfKey:Buffer.alloc(32,3).toString('base64url')};
const environment={PLANNIX_SESSION_TOKEN_KEYS_JSON:JSON.stringify({test:Buffer.alloc(32,4).toString('base64url')}),
  PLANNIX_SESSION_TOKEN_ACTIVE_KEY_ID:'test'};

test('server mode fails closed without its private configuration',()=>{
  assert.throws(()=>createServerAuthRuntime({config:{...config,authMode:'bearer'}}),/disabled/);
  assert.throws(()=>createServerAuthRuntime({config:{...config,supabaseSecretKey:''}}),/unavailable/);
  assert.throws(()=>createServerAuthRuntime({config:{...config,serverAuthCsrfKey:'bad'},
    environment}),/CSRF key/);
  assert.throws(()=>createServerAuthRuntime({config,environment:{}}),/Session token unavailable/);
});

test('production cookie mode remains blocked until shared auth rate limiting exists',()=>{
  assert.throws(()=>createServerAuthRuntime({config:{...config,nodeEnv:'production'}}),
    /Distributed auth rate limiting/);
  assert.throws(()=>validateProductionEnv({...config,nodeEnv:'production'}),
    /distributed rate limiting/);
});
