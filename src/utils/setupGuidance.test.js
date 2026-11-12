import assert from 'node:assert/strict';
import { test } from 'node:test';
import { beginSetupGuidanceSave, finishSetupGuidanceSave, restoreSetupGuidance,
  setSetupGuidanceVisible, setupGuidancePreference } from './setupGuidance.js';

function browser(run) {
  const previousWindow = globalThis.window;
  const previousStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.window = new EventTarget();
  globalThis.localStorage = { getItem:key => values.get(key) ?? null,
    setItem:(key,value) => values.set(key,String(value)) };
  try { run(); } finally { globalThis.window = previousWindow; globalThis.localStorage = previousStorage; }
}

test('a successful save hides only its account and step; a failed save does not finish', () => browser(() => {
  const ticket = beginSetupGuidanceSave('a','classes');
  assert.equal(setupGuidancePreference('a','classes'),null);
  assert.equal(finishSetupGuidanceSave(ticket),true);
  assert.equal(setupGuidancePreference('a','classes'),'hidden');
  assert.equal(setupGuidancePreference('b','classes'),null);
  assert.equal(setupGuidancePreference('a','year'),null);
}));

test('restoring instructions survives a late pre-restore save and is consumed by a later success', () => browser(() => {
  const oldSave = beginSetupGuidanceSave('a','classes');
  assert.equal(restoreSetupGuidance('a'),true);
  assert.equal(setupGuidancePreference('a','classes'),'shown');
  assert.equal(setupGuidancePreference('a','year'),'shown');
  assert.equal(finishSetupGuidanceSave(oldSave),false);
  assert.equal(setupGuidancePreference('a','classes'),'shown');
  const newSave = beginSetupGuidanceSave('a','classes');
  assert.equal(finishSetupGuidanceSave(newSave),true);
  assert.equal(setupGuidancePreference('a','classes'),'hidden');
  assert.equal(setupGuidancePreference('a','year'),'shown');
}));

test('manual dismissal remains account scoped after restoration', () => browser(() => {
  restoreSetupGuidance('a');
  setSetupGuidanceVisible('a','ai',false);
  assert.equal(setupGuidancePreference('a','ai'),'hidden');
  assert.equal(setupGuidancePreference('b','ai'),null);
}));

test('manual visibility still changes when browser storage rejects writes', () => browser(() => {
  globalThis.localStorage.setItem = () => { throw Error('blocked'); };
  assert.equal(restoreSetupGuidance('storage-blocked'),false);
  assert.equal(setupGuidancePreference('storage-blocked','year'),'shown');
  assert.equal(setSetupGuidanceVisible('storage-blocked','year',false),false);
  assert.equal(setupGuidancePreference('storage-blocked','year'),'hidden');
}));
