import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  env,
  requireSupabaseAdminConfig,
  requireSupabasePublicConfig,
  validateProductionEnv,
} from './env.js';

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
    validateProductionEnv({
      nodeEnv: 'production',
      enableDemoUser: false,
      supabaseUrl: 'https://project.example.test',
      supabaseSecretKey: 'test-secret-placeholder',
    }),
  );
});

test('production startup requires separate server-only Supabase Admin configuration', () => {
  assert.throws(
    () => validateProductionEnv({
      nodeEnv: 'production',
      enableDemoUser: false,
      supabaseUrl: 'https://project.example.test',
      supabaseSecretKey: '',
    }),
    /SUPABASE_SECRET_KEY/,
  );
  assert.deepEqual(requireSupabaseAdminConfig({
    supabaseUrl: 'https://project.example.test',
    supabasePublishableKey: 'public-placeholder',
    supabaseSecretKey: 'secret-placeholder',
  }), {
    url: 'https://project.example.test',
    secretKey: 'secret-placeholder',
  });
  assert.equal(typeof env.supabaseSecretKey, 'string');
});

test('Admin configuration does not accept legacy privileged variable names or log secrets', () => {
  const source = fs.readFileSync(new URL('./env.js', import.meta.url), 'utf8');
  assert.equal(/SERVICE_ROLE/i.test(source), false);
  const captured = [];
  const original = console.error;
  console.error = (entry) => captured.push(String(entry));
  try {
    assert.throws(() => validateProductionEnv({
      nodeEnv: 'production',
      enableDemoUser: false,
      supabaseUrl: 'https://project.example.test',
      supabaseSecretKey: '',
    }));
  } finally {
    console.error = original;
  }
  assert.deepEqual(captured, []);
});

test('legacy automatic migration configuration is absent', () => {
  assert.equal(Object.hasOwn(env, 'autoRunMigrations'), false);
});
