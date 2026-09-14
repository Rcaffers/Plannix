import assert from 'node:assert/strict';
import test from 'node:test';
import { env, requireSupabasePublicConfig, validateProductionEnv } from './env.js';

test('production validation rejects demo-user creation', () => {
  assert.throws(
    () => validateProductionEnv({ nodeEnv: 'production', enableDemoUser: true }),
    /ENABLE_DEMO_USER/,
  );
});

test('Supabase public configuration remains optional until requested', () => {
  assert.throws(
    () => requireSupabasePublicConfig({ supabaseUrl: '', supabasePublishableKey: '' }),
    /SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY/,
  );
  assert.deepEqual(requireSupabasePublicConfig({
    supabaseUrl: 'https://project.example.test',
    supabasePublishableKey: 'public-key',
  }), { url: 'https://project.example.test', publishableKey: 'public-key' });
  assert.equal(typeof env.supabaseUrl, 'string');
  assert.equal(typeof env.supabasePublishableKey, 'string');
});

test('production validation allows demo-user creation to remain disabled', () => {
  assert.doesNotThrow(() =>
    validateProductionEnv({ nodeEnv: 'production', enableDemoUser: false }),
  );
});

test('legacy automatic migration configuration is absent', () => {
  assert.equal(Object.hasOwn(env, 'autoRunMigrations'), false);
});
