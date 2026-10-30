// Test-only build audit. Does not write tracked dist or print environment values.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const output = await mkdtemp(path.join(tmpdir(), 'plannix-server-auth-bundle-'));
try {
  const build = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'build',
      '--outDir', output, '--emptyOutDir'], {
      cwd: process.cwd(), env: { ...process.env, VITE_PLANNIX_AUTH_MODE:'server' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr.resume();
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve(true)
      : reject(new Error(`Temporary server-auth build failed (${code}).`)));
  });
  assert.equal(build, true);
  assert.deepEqual(JSON.parse(await readFile(path.join(output, 'auth-mode.json'), 'utf8')),
    { version:1, authMode:'server' });
  const assets = await readdir(path.join(output, 'assets'));
  const scripts = await Promise.all(assets.filter(name => name.endsWith('.js'))
    .map(name => readFile(path.join(output, 'assets', name), 'utf8')));
  const text = scripts.join('\n');
  for (const marker of ['refresh_token', 'supabase.auth.token', 'detectSessionInUrl',
    'plannix-server-stage3']) {
    assert.equal(text.includes(marker), false, `Browser SDK marker remains: ${marker}`);
  }
  assert.equal(text.includes('Browser Supabase access is unavailable'), true);
  for (const marker of ['__plannixTimetableOperationObserver',
    '__plannixAuthTestObserver', '__timetablePendingUpdateIds', '__recoveryPlanner',
    'profile-gate-terminal', 'deletion-reconcile-terminal',
    'subscription-terminal', 'recovery-verification-terminal',
    'recovery-verification-disposed', 'recovery-view-mount',
    'recovery-view-unmount', 'recovery-submit-terminal',
    'save-update-start', 'testCommitIds']) {
    assert.equal(text.includes(marker), false, `Test observer remains in server bundle: ${marker}`);
  }
  process.stdout.write('Server-auth browser bundle excludes Supabase session storage and refresh code.\n');
  const bearerOutput = path.join(output, 'bearer');
  const bearerBuild = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'build',
      '--outDir', bearerOutput, '--emptyOutDir'], {
      cwd: process.cwd(), env: { ...process.env, VITE_PLANNIX_AUTH_MODE:'bearer' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr.resume();
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve(true)
      : reject(new Error(`Temporary bearer build failed (${code}).`)));
  });
  assert.equal(bearerBuild, true);
  const bearerAssets = await readdir(path.join(bearerOutput, 'assets'));
  const bearerText = (await Promise.all(bearerAssets.filter(name => name.endsWith('.js'))
    .map(name => readFile(path.join(bearerOutput, 'assets', name), 'utf8')))).join('\n');
  for (const marker of ['__plannixTimetableOperationObserver',
    '__plannixAuthTestObserver', '__timetablePendingUpdateIds', '__recoveryPlanner',
    'profile-gate-terminal', 'deletion-reconcile-terminal',
    'subscription-terminal', 'recovery-verification-terminal',
    'recovery-verification-disposed', 'recovery-view-mount',
    'recovery-view-unmount', 'recovery-submit-terminal',
    'save-update-start', 'testCommitIds']) {
    assert.equal(bearerText.includes(marker), false, `Test observer remains in bearer bundle: ${marker}`);
  }
  process.stdout.write('Both production auth modes exclude Stage 4 test observers.\n');
} finally { await rm(output, { recursive:true, force:true }); }
