import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  env,
  requireSupabaseAdminConfig,
  requireSupabasePublicConfig,
  validateProductionEnv,
} from './env.js';

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

test('production validation requires public and Admin Supabase configuration', () => {
  assert.throws(() => validateProductionEnv({
    nodeEnv: 'production',
    supabaseUrl: 'https://project.example.test',
    supabasePublishableKey: '',
    supabaseSecretKey: 'test-secret-placeholder',
  }), /SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotThrow(() =>
    validateProductionEnv({
      nodeEnv: 'production',
      supabaseUrl: 'https://project.example.test',
      supabasePublishableKey: 'public-key',
      supabaseSecretKey: 'test-secret-placeholder',
    }),
  );
});

test('production startup requires separate server-only Supabase Admin configuration', () => {
  assert.throws(
    () => validateProductionEnv({
      nodeEnv: 'production',
      supabaseUrl: 'https://project.example.test',
      supabasePublishableKey: 'public-key',
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
      supabaseUrl: 'https://project.example.test',
      supabasePublishableKey: 'public-key',
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

test('removed legacy environment variables have no application configuration effect', () => {
  const source = fs.readFileSync(new URL('./env.js', import.meta.url), 'utf8');
  for (const removedName of [
    'SUPABASE_DB_URL', 'SUPABASE_POOLER_URL', 'DATABASE_URL', 'DB_SSL',
    'SESSION_COOKIE', 'COOKIE_SECURE', 'ENABLE_DEMO_USER',
    'PASSWORD_RESET_PUBLIC_URL', 'PASSWORD_RESET_TTL_HOURS',
  ]) {
    assert.equal(source.includes(removedName), false, removedName);
  }
  assert.equal(Object.hasOwn(env, 'cookieSecure'), false);
  assert.equal(Object.hasOwn(env, 'enableDemoUser'), false);
});
