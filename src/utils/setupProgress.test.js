import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setupCompletion, setupGuideKey } from './setupProgress.js';

const saved = { yearSaved:true, layoutSaved:true, classesLoaded:true,
  savedClasses:[{ id:'class-a' }], recurringReady:true,
  recurring:[{ sessions:[{ classId:'class-a' }] }], timetableUnsaved:false };

test('partly configured accounts get progress from saved records', () => {
  assert.deepEqual(setupCompletion({ ...saved, layoutSaved:false, savedClasses:[], recurring:[] }),
    { year:true, layout:false, classes:false, placements:false });
  assert.deepEqual(setupCompletion(saved),
    { year:true, layout:true, classes:true, placements:true });
});

test('visits, drafts, failed loads and optimistic timetable edits do not complete setup', () => {
  assert.equal(setupCompletion({ ...saved, yearSaved:false }).year,false);
  assert.equal(setupCompletion({ ...saved, classesLoaded:false }).classes,false);
  assert.equal(setupCompletion({ ...saved, recurringReady:false }).placements,false);
  assert.equal(setupCompletion({ ...saved, timetableUnsaved:true }).placements,false);
  assert.equal(setupCompletion({ ...saved, recurring:[{ sessions:[{ classId:null }] }] }).placements,false);
  assert.deepEqual(setupCompletion({ ...saved, yearSelected:false }),
    { year:true, layout:false, classes:false, placements:false });
});

test('hidden guide preferences are scoped to account and step', () => {
  assert.notEqual(setupGuideKey('account-a','classes'),setupGuideKey('account-b','classes'));
  assert.notEqual(setupGuideKey('account-a','classes'),setupGuideKey('account-a','year'));
});
