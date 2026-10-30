import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { safeRequestReference } from './requestReference.js';

const requestId = '40000000-0000-4000-8000-000000000001';

test('support references retain only canonical error request IDs', () => {
  assert.equal(safeRequestReference({ requestId }), requestId);
  for (const value of [undefined, null, '', 'secret', ` ${requestId}`, `${requestId}\n`,
    '40000000-0000-4000-c000-000000000001', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
    { toString: () => requestId }, 123]) {
    assert.equal(safeRequestReference({ requestId: value }), '');
  }
  assert.equal(safeRequestReference(null), '');
  assert.equal(safeRequestReference(new Error('Public error')), '');
});

const operations = {
  AcademicYear: ['loadYear', 'saveAcademicYear'],
  Class: ['load', 'save'],
  TimetableLayout: ['load', 'save'],
  TimetableSession: ['loadRecurring', 'loadDate', 'removeOverride', 'saveBatch'],
};

for (const [context, names] of Object.entries(operations)) {
  test(`${context} operations clear references at start and success and validate failure references`, async () => {
    const source = await fs.readFile(new URL(`../context/${context}Context.jsx`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /setRequestReference\(result\.requestId/);
    for (const assignment of source.matchAll(/setRequestReference\((.*)\);/g)) {
      assert.match(assignment[1], /^(?:''|safeRequestReference\(\w+Error\))/);
    }
    for (const name of names) {
      const start = source.indexOf(`const ${name} = useCallback(async`);
      assert.ok(start >= 0, name);
      const body = source.slice(start, source.indexOf('\n  },', start));
      const [beforeTry, afterTry] = body.split(/\btry\s*\{/);
      assert.match(beforeTry, /setRequestReference\(''\)/, `${name} start`);
      const [success, failure] = afterTry.split(/\}\s*catch/);
      assert.match(success, /setRequestReference\(''\)/, `${name} success`);
      assert.match(failure, /setRequestReference\(safeRequestReference\(\w+Error\)\)/, `${name} failure`);
    }
  });
}

test('academic-year initial load and queued session saves clear previous references', async () => {
  const year = await fs.readFile(new URL('../context/AcademicYearContext.jsx', import.meta.url), 'utf8');
  assert.match(year, /useEffect\(\(\) => \{\s*clearUserAcademicYear\(\)/);
  assert.match(year, /setAcademicYears\(result.academicYears\);\s*setRequestReference\(''\)/);
  const sessions = await fs.readFile(new URL('../context/TimetableSessionContext.jsx', import.meta.url), 'utf8');
  assert.match(sessions, /onOptimistic:[\s\S]*?setRequestReference\(''\)/);
  assert.match(sessions, /const applyAuthoritative[\s\S]*?setRequestReference\(''\)/);
  assert.match(sessions, /onError:[\s\S]*?setRequestReference\(safeRequestReference\(saveError\)\)/);
  const classes = await fs.readFile(new URL('../context/ClassContext.jsx', import.meta.url), 'utf8');
  assert.match(classes, /setRequestReference\(''\);\s*const validationError = validateClassDraft/);
});

test('every support reference display requires its corresponding error', async () => {
  for (const [file, guard] of [
    ['pages/AcademicYear.jsx', 'error && requestReference'],
    ['pages/Classes.jsx', 'error && requestReference'],
    ['pages/Settings.jsx', 'layoutError && layoutRequestReference'],
    ['components/ProjectCard.jsx', 'sessionState.error && sessionState.requestReference'],
  ]) {
    const source = await fs.readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    const displays = source.split('\n').filter((line) => line.includes('Support reference:'));
    assert.ok(displays.length > 0, file);
    for (const display of displays) assert.ok(display.includes(`{${guard} ?`), file);
  }
});

test('generation guards precede success and failure reference updates', async () => {
  for (const [context, names] of Object.entries(operations)) {
    const source = await fs.readFile(new URL(`../context/${context}Context.jsx`, import.meta.url), 'utf8');
    const expected = context === 'TimetableSession' ? 'expected' : 'expectedGeneration';
    for (const name of names.filter((name) => !['removeOverride', 'saveBatch'].includes(name))) {
      const loadGeneration = context === 'TimetableSession'
        ? name === 'loadRecurring' ? 'recurringLoadGeneration' : 'datedLoadGeneration'
        : 'generation';
      const start = source.indexOf(`const ${name} = useCallback(async`);
      const body = source.slice(start, source.indexOf('\n  },', start));
      const success = body.split(/\btry\s*\{/)[1].split(/\}\s*catch/)[0];
      const failure = body.split(/\}\s*catch/)[1];
      assert.match(success, new RegExp(`if \\(${expected} !== ${loadGeneration}\\.current\\) return [^;]+;[\\s\\S]*setRequestReference\\(''\\)`));
      assert.match(failure, new RegExp(`if \\(${expected} === ${loadGeneration}\\.current\\) \\{[\\s\\S]*setRequestReference\\(safeRequestReference`));
    }
  }
});

test('stale recurring and dated results cannot replace a newer load or its support reference', async () => {
  const source = await fs.readFile(new URL('../context/TimetableSessionContext.jsx', import.meta.url), 'utf8');
  const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  };
  for (const [name, fetchName, resultKey, latestResult] of [
    ['loadRecurring', 'fetchRecurringTimetableSessions', 'recurring',
      { weeks: [{ weekId: 'new-week' }], revision: 12 }],
    ['loadDate', 'fetchDatedTimetableSessions', 'dated',
      { collectionId: 'new-date', revision: 22 }],
  ]) {
    const start = source.indexOf(`const ${name} = useCallback(`);
    assert.ok(start >= 0, name);
    const callbackStart = start + `const ${name} = useCallback(`.length;
    const callbackEnd = source.indexOf('\n  },', callbackStart);
    assert.ok(callbackEnd > callbackStart, name);
    const callback = source.slice(callbackStart, callbackEnd + 4)
      .replaceAll('import.meta.env.MODE', JSON.stringify('test'));
    const pending = [];
    const state = { recurring: null, dated: null, ready: false, revision: null,
      loading: false, error: '', reference: '', saved: false, conflict: false, unsaved: false };
    const setters = Object.fromEntries(Object.keys(state).map(key => [key,
      value => { state[key] = value; }]));
    const recurringLoadGeneration = { current: 0 };
    const datedLoadGeneration = { current: 0 };
    const dependencies = {
      scope: { organisationId: 'organisation', academicYearId: 'year', timetableId: 'timetable' },
      user: { id: 'user' }, resetSaveQueue: () => {}, recurringLoadGeneration,
      datedLoadGeneration, observeTimetableOperation: () => {}, safeRequestReference,
      [fetchName]: () => { const request = deferred(); pending.push(request); return request.promise; },
      setRecurring: setters.recurring, setRecurringReady: setters.ready,
      setDated: setters.dated, setRevision: setters.revision,
      setIsLoading: setters.loading, setError: setters.error,
      setRequestReference: setters.reference, setSaved: setters.saved,
      setConflict: setters.conflict, setUnsaved: setters.unsaved,
    };
    const load = new Function(...Object.keys(dependencies), `return (${callback});`)(
      ...Object.values(dependencies));
    const invoke = () => name === 'loadDate' ? load('2026-10-26') : load();

    const oldSuccess = invoke();
    const newSuccess = invoke();
    assert.equal(pending.length, 2, `${name} starts both requests`);
    pending[1].resolve(latestResult);
    assert.equal(await newSuccess, true);
    assert.equal(state[resultKey], name === 'loadRecurring' ? latestResult.weeks : latestResult);
    pending[0].resolve(name === 'loadRecurring'
      ? { weeks: [{ weekId: 'old-week' }], revision: 1 }
      : { collectionId: 'old-date', revision: 1 });
    assert.equal(await oldSuccess, false);
    assert.equal(state[resultKey], name === 'loadRecurring' ? latestResult.weeks : latestResult);
    assert.equal(state.revision, latestResult.revision);
    assert.deepEqual({ error: state.error, reference: state.reference, loading: state.loading },
      { error: '', reference: '', loading: false });

    const oldFailure = invoke();
    const newFailure = invoke();
    const currentError = Object.assign(new Error('Newer failure'), { requestId });
    pending[3].reject(currentError);
    assert.equal(await newFailure, false);
    pending[2].reject(Object.assign(new Error('Stale failure'), {
      requestId: '50000000-0000-4000-8000-000000000001',
    }));
    assert.equal(await oldFailure, false);
    assert.deepEqual({ error: state.error, reference: state.reference, loading: state.loading },
      { error: 'Newer failure', reference: requestId, loading: false });
  }
});

test('academic-year load clears a failed reference on retry and ignores stale outcomes', async () => {
  // Execute the actual callback with injected dependencies; no React renderer is installed.
  const source = await fs.readFile(new URL('../context/AcademicYearContext.jsx', import.meta.url), 'utf8');
  const start = source.indexOf('async (yearId, expectedGeneration');
  const callback = source.slice(start, source.indexOf(', [organisationId]);', start));
  const state = { error: '', reference: '' };
  const generation = { current: 1 };
  let resolveRequest;
  let rejectRequest;
  const load = new Function('organisationId', 'generation', 'fetchAcademicYearPlan',
    'normalizeAcademicYear', 'setIsLoading', 'setError', 'setRequestReference',
    'setAcademicYear', 'setSelectedAcademicYearId', 'safeRequestReference', `return (${callback});`)(
    'organisation', generation,
    () => new Promise((resolve, reject) => { resolveRequest = resolve; rejectRequest = reject; }),
    (plan) => plan, () => {}, (value) => { state.error = value; },
    (value) => { state.reference = value; }, () => {}, () => {}, safeRequestReference,
  );
  const failed = load('year');
  rejectRequest(Object.assign(new Error('Could not load the academic year.'), { requestId }));
  await failed;
  assert.deepEqual(state, { error: 'Could not load the academic year.', reference: requestId });
  const retry = load('year');
  assert.deepEqual(state, { error: '', reference: '' });
  resolveRequest({ plan: { id: 'year' }, requestId });
  await retry;
  assert.deepEqual(state, { error: '', reference: '' });

  for (const invalidId of [undefined, 'invalid']) {
    const invalid = load('year');
    rejectRequest(Object.assign(new Error('Public error'), { requestId: invalidId }));
    await invalid;
    assert.equal(state.error, 'Public error');
    assert.equal(state.reference, '');
  }
  for (const outcome of ['success', 'failure']) {
    const pending = load('old-year');
    generation.current += 1;
    state.error = 'Newer failure';
    state.reference = requestId;
    if (outcome === 'success') resolveRequest({ plan: { id: 'old-year' }, requestId });
    else rejectRequest(Object.assign(new Error('Stale failure'), { requestId: '50000000-0000-4000-8000-000000000001' }));
    await pending;
    assert.deepEqual(state, { error: 'Newer failure', reference: requestId });
  }
});
