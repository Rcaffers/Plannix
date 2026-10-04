import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const serverPath = fileURLToPath(new URL('../server.js', import.meta.url));
const harnessPath = fileURLToPath(new URL('./shutdownHarness.js', import.meta.url));

async function runShutdown(mode, { repeatSignal = false } = {}) {
  const child = spawn(process.execPath, ['--import', harnessPath, serverPath], {
    env: { PATH: process.env.PATH || '', SHUTDOWN_CASE: mode },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const startedAt = Date.now();
  let output = '';
  let errorOutput = '';
  let ready;
  const readyPromise = new Promise((resolve, reject) => { ready = { resolve, reject }; });
  child.stdout.on('data', chunk => {
    output += chunk.toString();
    if (output.includes('Plannix server is listening.')
      && (mode === 'disabled' || output.includes('synthetic-polling-started'))) ready.resolve();
  });
  child.stderr.on('data', chunk => { errorOutput += chunk.toString(); });
  child.on('error', ready.reject);
  child.on('exit', () => ready.reject(new Error('Server exited before listening.')));
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 19_000);
  try {
    await Promise.race([
      readyPromise,
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('Server did not start.')), 3_000)),
    ]);
    const signalledAt = Date.now();
    child.kill('SIGTERM');
    if (repeatSignal) child.kill('SIGINT');
    const [code, signal] = await once(child, 'exit');
    return { code, signal, elapsed: Date.now() - signalledAt, total: Date.now() - startedAt, errorOutput };
  } finally {
    clearTimeout(watchdog);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await once(child, 'exit');
    }
  }
}

test('production signal handler exits promptly after clean polling and listener shutdown', async () => {
  const result = await runShutdown('clean');
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  assert.ok(result.elapsed < 5_000, `Clean shutdown took ${result.elapsed} ms.`);
});

test('production signal handler exits promptly when polling is disabled', async () => {
  const result = await runShutdown('disabled');
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  assert.ok(result.elapsed < 5_000, `Disabled-polling shutdown took ${result.elapsed} ms.`);
});

test('production hard deadline exits with an abort-ignoring live handle despite repeated signals', async () => {
  const result = await runShutdown('ignore', { repeatSignal: true });
  assert.equal(result.code, 1);
  assert.equal(result.signal, null);
  assert.ok(result.elapsed >= 13_000 && result.elapsed < 18_000,
    `Hard shutdown took ${result.elapsed} ms.`);
});

test('rejected polling cleanup retains the production hard deadline', async () => {
  const result = await runShutdown('reject');
  assert.equal(result.code, 1);
  assert.equal(result.signal, null);
  assert.ok(result.elapsed >= 13_000 && result.elapsed < 18_000,
    `Rejected cleanup shutdown took ${result.elapsed} ms.`);
});
