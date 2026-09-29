import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

test('real workers: stress, active cancellation, hard deadline, cleanup and subsequent extraction', { timeout: 45000 }, async () => {
  let result;
  try {
    result = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./pdfLifecycleProbe.js', import.meta.url))], {
      env: {}, timeout: 42000, maxBuffer: 100000,
    });
  } catch { assert.fail('Isolated lifecycle probe failed; diagnostic content withheld.'); }
  assert.equal(result.stderr.length, 0, 'No worker/native diagnostic may escape to parent stderr');
  let summary;
  try { summary = JSON.parse(result.stdout); } catch { assert.fail('Unexpected parent output; content withheld.'); }
  assert.deepEqual(summary, { operations: 12, stressOperations: 120000, clean: true });
});
