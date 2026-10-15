import test from 'node:test';
import assert from 'node:assert/strict';
import { abandonPending, collectCommittedIds } from './timetableCommitAttribution.js';

const context = { sessionName:'session-1', generation:3 };
const scope = { providerId:'provider-1', observerId:1, context, userId:'account-A' };
const pendingOperation = (id, channel = 'saving', overrides = {}) => [id, {
  id, providerId:'provider-1', observerId:1, userId:'account-A',
  sessionName:'session-1', generation:3, commitChannel:channel, ...overrides,
}];
const collect = (pending, abandoned, markers, overrides = {}) => collectCommittedIds(
  pending, abandoned, { ...scope, committedMarkers:markers, ...overrides });

test('duplicate errors cannot attribute two IDs to one causally marked render', () => {
  const pending = new Map([pendingOperation('error-1'),pendingOperation('error-2')]);
  const abandoned = [];
  assert.deepEqual(collect(pending, abandoned, ['error-2']),['error-2']);
  assert.deepEqual(abandoned,[{ id:'error-1', reason:'superseded-update' }]);
  assert.equal(pending.size,0);
});

test('identical successful values cannot attribute an unrelated operation', () => {
  const pending = new Map([pendingOperation('success-1'),pendingOperation('success-2')]);
  const abandoned = [];
  assert.deepEqual(collect(pending, abandoned, ['success-2']),['success-2']);
  assert.deepEqual(abandoned,[{ id:'success-1', reason:'superseded-update' }]);
});

test('a batched commit can carry causally applied markers from distinct state writes', () => {
  const pending = new Map([pendingOperation('queued-success','revision'),
    pendingOperation('final-success','saving')]);
  const abandoned = [];
  assert.deepEqual(collect(pending,abandoned,['queued-success','final-success']),
    ['queued-success','final-success']);
  assert.deepEqual(abandoned,[]);
  assert.equal(pending.size,0);
});

test('unmount before commit abandons its IDs; same-context remount cannot inherit them', () => {
  const pending = new Map([pendingOperation('id-1')]);
  const abandoned = [];
  abandonPending(pending, abandoned, { providerId:'provider-1', observerId:1,
    reason:'observer-unmount' });
  assert.deepEqual(abandoned,[{ id:'id-1', reason:'observer-unmount' }]);
  assert.deepEqual(collect(pending, abandoned, ['id-1'], { observerId:2 }),[]);
  assert.equal(pending.size,0);
});

test('Retry is a distinct ID; a commit without its marker cannot claim it', () => {
  const pending = new Map([pendingOperation('retry-2')]);
  const abandoned = [];
  assert.deepEqual(collect(pending,abandoned,[]),[]);
  assert.deepEqual(collect(pending,abandoned,['retry-2']),['retry-2']);
  assert.equal(pending.size,0);
});

test('provider and session replacement cannot claim an old marker', () => {
  const pending = new Map([pendingOperation('id-1')]);
  const abandoned = [];
  assert.deepEqual(collect(pending,abandoned,['id-1'],{ providerId:'provider-2' }),[]);
  assert.deepEqual(abandoned,[{ id:'id-1', reason:'context-changed' }]);
});
