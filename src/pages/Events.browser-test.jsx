import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import Events from './Events.jsx';
import '../styles/base.css';
import '../styles/accessibility.css';
export { importSourceError } from '../utils/importPreviewApi.js';
export const aiConnectionApi = { load: async () => ({ active: true, providerLabel: 'OpenAI' }) };
export const extractImportPreview = async () => ({ destination: 'events', entries: [] });

const YEAR_A = '10000000-0000-4000-8000-000000000001';
const YEAR_B = '10000000-0000-4000-8000-000000000002';
const USER_A = '30000000-0000-4000-8000-000000000001';
let nextEventNumber = 1;
let guard = () => true;
let selectedYear = YEAR_A;
const yearListeners = new Set();
const yearSetter = value => { selectedYear = value; for (const listener of yearListeners) listener(value); };
const records = new Map([[YEAR_A, []], [YEAR_B, []]]);
const calls = [];
let nextFailure = null;
let listGate = null;
let releasePendingUnmountList = null;
let mutationGate = null;
let missingBoundary = false;
const register = fn => { guard = fn; return () => { guard = () => true; }; };
export function useAcademicYear() {
  const [id, setId] = useState(selectedYear);
  React.useEffect(() => { yearListeners.add(setId); return () => yearListeners.delete(setId); }, []);
  return { academicYears: [{ id: YEAR_A }, { id: YEAR_B }], selectedAcademicYearId: id,
    academicYear: { id, label: id === YEAR_A ? '2026/27' : '2027/28',
      startDate: missingBoundary && id === YEAR_A ? '' : id === YEAR_A ? '2026-09-01' : '2027-09-01',
      endDate: id === YEAR_A ? '2027-08-31' : '2028-08-31' },
    isLoading: false, registerAcademicYearChangeGuard: register };
}
function fail() { const failure = nextFailure; nextFailure = null; if (failure) throw failure; }
export const eventApi = {
  async list(id, options) { calls.push({ action: 'list', id, signal: options.signal }); if (listGate) await listGate; fail(); return { events: structuredClone(records.get(id) || []) }; },
  async create(id, event) { calls.push({ action: 'create', id, event }); if (mutationGate) await mutationGate;
    const failure = nextFailure; nextFailure = null; if (failure && !failure.accepted) throw failure;
    const saved = { ...event, id: `20000000-0000-4000-8000-${String(nextEventNumber++).padStart(12, '0')}`, academicYearId: id, revision: 1 };
    records.set(id, [...records.get(id), saved]); if (failure) throw failure; return { event: saved }; },
  async update(id, revision, event) { calls.push({ action: 'update', id, revision, event });
    const failure = nextFailure; nextFailure = null; if (failure && !failure.accepted) throw failure;
    const yearId = [...records].find(([, items]) => items.some(x => x.id === id))?.[0]; const saved = { ...event, id, academicYearId: yearId, revision: revision + 1 };
    records.set(yearId, records.get(yearId).map(x => x.id === id ? saved : x)); if (failure) throw failure; return { event: saved }; },
  async remove(id, revision) { calls.push({ action: 'remove', id, revision });
    const failure = nextFailure; nextFailure = null; if (failure && !failure.accepted) throw failure;
    for (const [yearId, items] of records) records.set(yearId, items.filter(x => x.id !== id)); if (failure) throw failure; return { ok: true }; },
};
const host = document.createElement('div'); document.body.append(host);
const root = createRoot(host);
const router = createMemoryRouter([
  { path: '/settings/events', element: <Events userId={USER_A} /> },
  { path: '/settings', element: <main>Settings destination</main> },
  { path: '/profile', element: <main>Profile destination</main> },
], { initialEntries: ['/settings', '/settings/events', '/profile'], initialIndex: 1 });
root.render(<RouterProvider router={router} />);
window.eventsUnmountForTest = async () => {
  const signal = calls.filter(call => call.action === 'list').at(-1)?.signal;
  flushSync(() => root.unmount());
  releasePendingUnmountList?.();
  await settle();
  return Boolean(signal?.aborted && !host.querySelector('.events-page'));
};
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const settle = async () => { await tick(); await tick(); await tick(); };
const check = (condition, label) => { if (!condition) throw Error(label); results.push(label); };
const results = [];
const button = label => [...host.querySelectorAll('button')].find(el => el.textContent === label);
function click(label) { const target = button(label); if (!target) throw Error(`Missing button: ${label}`);
  if (target.closest('[hidden]')) { const toggle = host.querySelector('#events-list-toggle');
    if (!toggle || toggle.getAttribute('aria-expanded') !== 'false') throw Error(`Hidden button: ${label}`);
    flushSync(() => toggle.click()); }
  flushSync(() => target.click()); }
function input(id, value) {
  const node = host.querySelector(id);
  flushSync(() => { const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); });
}
function submit() { flushSync(() => host.querySelector('.events-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }
window.eventsStartRecoveryForUnmount = async () => {
  click('Add event'); await new Promise(resolve => requestAnimationFrame(resolve));
  input('#event-title', 'Unmount recovery draft'); input('#event-date', '2027-12-04');
  nextFailure = Object.assign(Error('Response lost'), { status: 503 }); submit(); await settle();
  listGate = new Promise(resolve => { releasePendingUnmountList = resolve; });
  click('Reload events'); await settle();
  return Boolean(host.querySelector('#event-title')?.value === 'Unmount recovery draft'
    && host.querySelector('.visually-hidden[aria-live]')?.textContent.includes('Loading events'));
};
async function run() {
  await settle();
  const cards = [...host.querySelectorAll('.events-page .settings-timetable-form')];
  const breadcrumb = host.querySelector('.settings-breadcrumb');
  check(breadcrumb?.textContent.trim() === 'Home / Settings / Events'
    && breadcrumb.querySelector('a[href="/"]')?.textContent === 'Home'
    && breadcrumb.querySelector('a[href="/settings"]')?.textContent === 'Settings'
    && breadcrumb.querySelectorAll('a').length === 2,
  'Events breadcrumb matches the linked settings-page hierarchy');
  const sections = [...host.querySelectorAll('.events-settings-card > .events-card-section')];
  check(cards.length === 1 && sections.length === 3
    && sections[0].contains(host.querySelector('.events-weekend-setting'))
    && sections[1].contains(host.querySelector('.events-list-heading'))
    && sections[2].contains(host.querySelector('.import-preview-panel')),
  'display preference, event list and AI preview share one settings card');
  check(getComputedStyle(cards[0]).backgroundImage.includes('gradient')
    && sections.slice(1).every(section => getComputedStyle(section).borderTopWidth === '1px')
    && !cards[0].querySelector('.settings-timetable-form')
    && getComputedStyle(sections[2].querySelector('.import-preview-controls')).borderTopWidth === '0px',
  'shared card keeps the settings tint and subtle section dividers without nested cards');
  const weekendSwitch = host.querySelector('input[role="switch"]');
  check(weekendSwitch?.checked && weekendSwitch.closest('label').textContent.includes('Show weekend events in timetable'),
    'Weekend event display switch is labelled and enabled by default');
  flushSync(() => weekendSwitch.click()); await settle();
  check(!weekendSwitch.checked && localStorage.getItem(`plannix_show_weekend_events_v1:${USER_A}`) === 'false'
    && !host.querySelector('.events-form'), 'Weekend switch persists independently of the event draft');
  flushSync(() => weekendSwitch.click()); await settle();
  check(weekendSwitch.checked && localStorage.getItem(`plannix_show_weekend_events_v1:${USER_A}`) === 'true',
    'Weekend switch restores the saved enabled preference');
  window.failPreferenceStorage = true;
  flushSync(() => weekendSwitch.click()); await settle();
  check(weekendSwitch.checked && host.querySelector('.events-weekend-setting [role="alert"]')?.getBoundingClientRect().height > 1,
    'Unavailable browser storage leaves preference unchanged and shows a visible error');
  window.failPreferenceStorage = false;
  flushSync(() => weekendSwitch.click()); await settle();
  check(!weekendSwitch.checked && !host.querySelector('.events-weekend-setting [role="alert"]'),
    'Successful preference retry clears the storage error');
  flushSync(() => weekendSwitch.click()); await settle();
  check(button('Show events (0)')?.getAttribute('aria-expanded') === 'false'
    && button('Show events (0)').getAttribute('aria-controls') === 'events-list-panel'
    && host.querySelector('#events-list-panel')?.hidden, 'loaded Events list starts collapsed with an accessible count');
  click('Show events (0)');
  check(!host.querySelector('#events-list-panel').hidden && host.textContent.includes('No events yet'), 'expanding reveals the empty state');
  click('Hide events');
  check(host.querySelector('#events-list-panel').hidden, 'collapsing leaves event data and editor controls available');
  check(host.querySelector('.visually-hidden[aria-live]') !== null, 'routine status hidden and accessible');
  check(getComputedStyle(host.querySelector('.visually-hidden[aria-live]')).position === 'absolute'
    && host.querySelector('.visually-hidden[aria-live]').getBoundingClientRect().height <= 1, 'routine status occupies no layout strip');
  check([...host.querySelectorAll('[role="status"]')].filter(node => node.textContent.includes('Loading events')).length <= 1,
    'only one event-list progress announcement exists');
  click('Add event'); await new Promise(resolve => requestAnimationFrame(resolve));
  check(document.activeElement.id === 'event-title', 'add focuses title');
  check(host.querySelector('.events-list-section > .events-form') && !host.querySelector('.events-form.settings-timetable-form'),
    'manual editor stays inside the Events card without a nested card');
  input('#event-title', 'Assembly'); input('#event-date', '2026-10-01'); submit(); await settle();
  check(calls.filter(x => x.action === 'create').length === 1, 'one all-day create');
  check(calls.find(x => x.action === 'create').event.startTime === null, 'all-day request has no times');
  check(host.textContent.includes('1 of 500 events'), 'canonical response updates count');
  check(button('Show events (1)') && host.querySelector('#events-list-panel').hidden, 'new saved event remains hidden until Show events is chosen');
  click('Show events (1)');
  check(!host.querySelector('#events-list-panel').hidden && button('Edit Assembly'), 'expanded list exposes saved event actions');
  click('Edit Assembly');
  check(host.querySelector('#event-title').value === 'Assembly', 'edit loads record');
  click('Hide events');
  check(host.querySelector('#events-list-panel').hidden && host.querySelector('#event-title').value === 'Assembly'
    && host.querySelector('.events-weekend-setting') && host.querySelector('.import-preview-panel'),
  'collapsing saved rows leaves the open editor, weekend preference and AI preview available');
  click('Show events (1)');
  input('#event-title', 'Unsaved switch draft');
  const callsBeforePreferenceChange = calls.length;
  flushSync(() => weekendSwitch.click()); await settle();
  check(!weekendSwitch.checked && host.textContent.includes('Assembly')
    && host.querySelector('#event-title').value === 'Unsaved switch draft'
    && calls.length === callsBeforePreferenceChange,
  'Hiding weekend cards does not remove saved events, alter the open draft or call the Events API');
  flushSync(() => weekendSwitch.click()); await settle();
  input('#event-title', 'Updated assembly'); input('#event-notes', 'Line one\nLine two'); submit(); await settle();
  check(calls.find(x => x.action === 'update').revision === 1, 'edit uses loaded revision');
  check(calls.find(x => x.action === 'update').event.notes === 'Line one\nLine two', 'multiline notes retained');
  click('Edit Updated assembly'); input('#event-title', 'Draft retained');
  input('#event-date', '2026-10-02'); input('#event-location', 'Draft room'); input('#event-notes', 'Draft notes');
  flushSync(() => host.querySelector('.events-check input').click());
  input('#event-startTime', '09:00'); input('#event-endTime', '10:00');
  nextFailure = Object.assign(Error('Changed elsewhere'), { status: 409 }); submit(); await settle();
  check(host.querySelector('#event-title').value === 'Draft retained', 'conflict retains draft');
  check(button('Reload latest') && button('Save event').disabled, 'conflict prevents stale retry');
  input('#event-title', 'Still a draft');
  check(button('Reload latest') && button('Save event').disabled, 'editing after conflict retains recovery');
  window.confirm = () => false;
  const beforeRejectedReload = calls.filter(x => x.action === 'list').length;
  click('Reload latest'); await settle();
  check(calls.filter(x => x.action === 'list').length === beforeRejectedReload, 'rejected discard confirmation makes no list request');
  check(host.querySelector('#event-title').value === 'Still a draft', 'declined reload retains draft');
  window.confirm = () => true;
  let releaseDestructiveReload;
  listGate = new Promise(resolve => { releaseDestructiveReload = resolve; });
  nextFailure = Object.assign(Error('Could not load events.'), { status: 503 });
  click('Reload latest'); await settle();
  const pendingReloadCount = calls.filter(x => x.action === 'list').length;
  check([...host.querySelectorAll('.events-form input, .events-form textarea, .events-form button')].every(node => node.disabled)
    && button('Reload latest').disabled && button('Add event').disabled,
  'confirmed destructive reload immediately disables fields and competing actions');
  input('#event-title', 'Attempted while disabled'); submit(); click('Cancel'); click('Reload latest'); await settle();
  check(calls.filter(x => x.action === 'list').length === pendingReloadCount
    && host.querySelector('#event-title').value === 'Still a draft', 'pending reload ignores input, Save, Cancel and repeat Reload');
  listGate = null; releaseDestructiveReload(); await settle();
  check(host.querySelector('#event-title').value === 'Still a draft'
    && host.querySelector('#event-date').value === '2026-10-02'
    && host.querySelector('#event-location').value === 'Draft room'
    && host.querySelector('#event-notes').value === 'Draft notes'
    && host.querySelector('#event-startTime').value === '09:00'
    && host.querySelector('#event-endTime').value === '10:00'
    && [...host.querySelectorAll('.events-form input, .events-form textarea')].every(node => !node.disabled)
    && button('Reload latest') && !button('Reload latest').disabled && button('Save event').disabled,
  'failed conflict reload retains every draft field and conflict while re-enabling editing');
  click('Reload latest'); await settle();
  check(!host.querySelector('.events-form'), 'confirmed reload replaces editor');
  click('Edit Updated assembly');
  check(host.querySelector('#event-date').value === '2026-10-01' && host.querySelector('#event-title').value === 'Updated assembly',
    'successful reload opens canonical record instead of discarded draft');
  click('Cancel'); await settle();
  click('Delete Updated assembly'); await settle();
  check(calls.find(x => x.action === 'remove').revision === 2, 'delete uses latest revision');
  check(host.textContent.includes('No events yet'), 'delete updates list');
  click('Add event'); input('#event-title', 'Timed event'); input('#event-date', '2026-11-03');
  flushSync(() => host.querySelector('.events-check input').click());
  input('#event-startTime', '09:00'); input('#event-endTime', '10:00');
  nextFailure = Object.assign(Error('An event with the same title, date and times already exists.'), { status: 409 });
  submit(); await settle();
  check(host.querySelector('#event-title').value === 'Timed event' && host.querySelector('.events-error'), 'duplicate failure retains timed draft visibly');
  check(!button('Save event').disabled, 'duplicate is editable, not a stale revision conflict');
  submit(); await settle();
  check(calls.filter(x => x.action === 'create').at(-1).event.startTime === '09:00', 'timed create uses paired local times');
  click('Edit Timed event');
  flushSync(() => host.querySelector('.events-check input').click());
  check(!host.querySelector('#event-startTime'), 'all-day choice hides timed fields');
  submit(); await settle();
  check(calls.filter(x => x.action === 'update').at(-1).event.startTime === null, 'timed-to-all-day edit never submits stale times');
  window.confirm = () => false;
  const removalsBefore = calls.filter(x => x.action === 'remove').length;
  click('Delete Timed event'); await settle();
  check(calls.filter(x => x.action === 'remove').length === removalsBefore && host.textContent.includes('Timed event'), 'cancelled delete preserves row');
  window.confirm = () => true;
  nextFailure = Object.assign(Error('Could not delete event.'), { status: 503 }); click('Delete Timed event'); await settle();
  check(host.textContent.includes('Timed event') && host.querySelector('.events-error') && button('Reload events'), 'uncertain delete preserves row and offers reconciliation');
  click('Reload events'); await settle();
  check(button('Retry delete') && button('Delete Timed event').disabled, 'unchanged revision permits only explicit delete retry');
  nextFailure = Object.assign(Error('Changed elsewhere'), { status: 409 }); click('Retry delete'); await settle();
  check(host.textContent.includes('Timed event') && button('Reload latest') && button('Delete Timed event').disabled, 'delete conflict blocks stale retry');
  click('Reload latest'); await settle();
  click('Delete Timed event'); await settle();
  click('Add event'); input('#event-title', 'Unsaved');
  window.confirm = () => false;
  check(guard() === false, 'academic-year guard protects draft');
  const navigation = new MouseEvent('click', { bubbles: true, cancelable: true });
  host.querySelector('.settings-breadcrumb a[href="/settings"]').dispatchEvent(navigation);
  await settle();
  check(navigation.defaultPrevented && router.state.location.pathname === '/settings/events'
    && host.querySelector('#event-title').value === 'Unsaved', 'route link cannot discard dirty event draft');
  window.confirm = () => true;
  check(guard() === true, 'academic-year guard permits confirmed discard');
  flushSync(() => yearSetter(YEAR_B)); await settle();
  check(host.textContent.includes('2027/28') && !host.querySelector('.events-form'), 'year scope resets editor');
  check(host.querySelector('#events-list-toggle')?.getAttribute('aria-expanded') === 'false', 'year change resets Events list visibility');
  records.set(YEAR_B, Array.from({ length: 500 }, (_, index) => ({ id: `cap-${index}`, academicYearId: YEAR_B,
    title: `Event ${index}`, date: '2027-10-01', startTime: null, endTime: null, location: null, notes: null, revision: 1 })));
  flushSync(() => yearSetter(YEAR_A)); await settle(); flushSync(() => yearSetter(YEAR_B)); await settle();
  check(host.textContent.includes('500 of 500 events') && button('Add event').disabled, 'combined 500-event cap disables addition');
  records.set(YEAR_B, []);
  flushSync(() => yearSetter(YEAR_A)); await settle(); flushSync(() => yearSetter(YEAR_B)); await settle();
  let releaseList;
  listGate = new Promise(resolve => { releaseList = resolve; });
  flushSync(() => yearSetter(YEAR_A)); await settle();
  const oldSignal = calls.filter(x => x.action === 'list').at(-1).signal;
  flushSync(() => yearSetter(YEAR_B)); await settle();
  check(oldSignal.aborted, 'year switch aborts previous list request');
  check(button('Add event').disabled && host.textContent.includes('Event count unavailable'), 'new year is not ready before complete list response');
  check(!host.querySelector('#events-list-toggle') && !host.querySelector('#events-list-panel'), 'pending list has no misleading count or toggle');
  check([...host.querySelectorAll('[role="status"]')].filter(node => node.textContent.includes('Loading events')).length === 1,
    'pending list has one loading announcement');
  listGate = null; releaseList(); await settle();
  check(host.textContent.includes('2027/28') && host.textContent.includes('No events yet'), 'stale prior-year list cannot replace current year');
  flushSync(() => yearSetter(null)); await settle();
  check(host.textContent.includes('No academic year is selected') && !button('Add event'), 'missing year gives guidance without editor');
  missingBoundary = true;
  flushSync(() => yearSetter(YEAR_A)); await settle();
  check(host.textContent.includes('Set both academic-year boundaries') && !button('Add event'), 'missing boundary blocks addition');
  missingBoundary = false;
  flushSync(() => yearSetter(YEAR_B)); await settle();
  click('Add event'); input('#event-title', 'Long location event'); input('#event-date', '2027-11-03');
  input('#event-location', 'A very long location '.repeat(9));
  nextFailure = Object.assign(Error('Could not save event.'), { status: 503 }); submit(); await settle();
  check(host.querySelector('#event-title').value === 'Long location event' && host.querySelector('.events-error') && button('Reload events'), 'uncertain create retains editor and offers reconciliation');
  const beforeRecovery = calls.filter(x => x.action === 'create').length;
  submit(); await settle();
  check(calls.filter(x => x.action === 'create').length === beforeRecovery, 'uncertain create cannot be blindly resubmitted');
  nextFailure = Object.assign(Error('Could not load events.'), { status: 503 }); click('Reload events'); await settle();
  check(host.querySelector('#event-title').value === 'Long location event' && button('Reload events'), 'failed recovery reload retains every draft field');
  click('Reload events'); await settle();
  check(button('Retry create') && host.querySelector('#event-location').value.startsWith('A very long'), 'no matching event permits explicit create retry');
  let releaseMutation;
  mutationGate = new Promise(resolve => { releaseMutation = resolve; });
  const beforeRetry = calls.filter(x => x.action === 'create').length;
  click('Retry create'); submit(); await settle();
  check(calls.filter(x => x.action === 'create').length === beforeRetry + 1, 'pending save blocks duplicate submission');
  mutationGate = null; releaseMutation(); await settle();
  check(host.textContent.includes('Long location event') && !host.querySelector('.events-error'), 'retry accepts canonical saved event');
  click('Add event'); input('#event-title', 'Accepted unseen event'); input('#event-date', '2027-12-01');
  nextFailure = Object.assign(Error('Transport failed after server acceptance'), { status: 503, accepted: true });
  submit(); await settle();
  check(button('Reload events') && !host.querySelector('.events-list')?.textContent.includes('Accepted unseen event'), 'accepted create with lost response is not fabricated locally');
  click('Reload events'); await settle();
  check(button('Open saved event') && host.querySelector('#event-title').value === 'Accepted unseen event', 'exact normalized key finds canonical saved event without discarding draft');
  click('Open saved event'); await settle();
  check(host.querySelector('#event-title').value === 'Accepted unseen event' && !button('Open saved event'), 'explicit choice opens saved event');
  click('Cancel'); await settle();
  const longLocationRecord = records.get(YEAR_B).find(item => item.title === 'Long location event');
  click('Edit Long location event'); input('#event-title', 'Updated after lost response');
  nextFailure = Object.assign(Error('Transport failed after server acceptance'), { status: 503, accepted: true });
  submit(); await settle();
  check(button('Reload events') && button('Save event').disabled, 'uncertain update blocks repeat submission');
  click('Reload events'); await settle();
  check(button('Open saved event'), 'accepted update with lost response reconciles by ID and revision');
  click('Open saved event'); await settle(); click('Cancel'); await settle();
  nextFailure = Object.assign(Error('Transport failed after server acceptance'), { status: 503, accepted: true });
  click('Delete Updated after lost response'); await settle();
  check(button('Reload events'), 'uncertain accepted delete offers reconciliation');
  click('Reload events'); await settle();
  check(button('Finish recovery') && !host.textContent.includes('Delete Updated after lost response'), 'accepted delete with lost response reconciles absent ID');
  click('Finish recovery'); await settle();
  records.set(YEAR_B, [...records.get(YEAR_B), longLocationRecord]);
  flushSync(() => yearSetter(YEAR_A)); await settle();
  click('Add event'); input('#event-title', 'Old-year late result'); input('#event-date', '2026-12-01');
  mutationGate = new Promise(resolve => { releaseMutation = resolve; });
  submit(); await settle();
  flushSync(() => yearSetter(YEAR_B)); await settle();
  mutationGate = null; releaseMutation(); await settle();
  check(host.textContent.includes('Long location event') && !host.textContent.includes('Old-year late result'), 'late mutation cannot alter another year’s list');
  click('Edit Long location event'); input('#event-title', 'Deleted elsewhere draft');
  records.set(YEAR_B, []);
  nextFailure = Object.assign(Error('Event or academic year was not found.'), { status: 404 });
  submit(); await settle();
  check(host.querySelector('#event-title').value === 'Deleted elsewhere draft' && button('Reload latest'), 'externally deleted event retains draft and shows recovery');
  click('Reload latest'); await settle();
  check(host.textContent.includes('This event no longer exists') && !host.querySelector('.events-form'), 'reloading deleted event gives clear guidance');
  nextFailure = Object.assign(Error('Could not load events.'), { status: 503, requestId: '30000000-0000-4000-8000-000000000001' });
  flushSync(() => yearSetter(YEAR_A)); await settle();
  check(host.querySelector('.events-error')?.textContent.includes('Support reference:') && button('Retry'), 'load error and support reference remain visible');
  check(button('Add event').disabled && !host.textContent.includes('0 of 500 events') && !host.textContent.includes('No events yet'), 'failed list blocks creation and does not claim zero events');
  check(!host.querySelector('#events-list-toggle') && !host.querySelector('#events-list-panel'), 'failed list has no event count or collapsed result');
  click('Retry'); await settle();
  check(!host.querySelector('.events-error') && host.textContent.includes('1 of 500 events') && !button('Add event').disabled, 'list retry restores complete canonical count and creation');
  flushSync(() => yearSetter(YEAR_B)); await settle();
  click('Add event'); input('#event-title', 'Dirty history draft');
  let prompts = 0;
  window.confirm = () => { prompts++; return false; };
  void router.navigate(-1); await settle();
  check(prompts === 1 && router.state.location.pathname === '/settings/events'
    && host.querySelector('#event-title').value === 'Dirty history draft' && host.textContent.includes('2027/28'), 'Back rejection preserves URL, year and draft with one prompt');
  window.confirm = () => { prompts++; return true; };
  void router.navigate(-1); await settle();
  check(prompts === 2 && router.state.location.pathname === '/settings', 'Back acceptance navigates exactly once');
  void router.navigate(1); await settle();
  check(router.state.location.pathname === '/settings/events' && !host.querySelector('.events-form'), 'Forward returns to clean Events page');
  click('Add event'); input('#event-title', 'Forward draft');
  window.confirm = () => { prompts++; return false; };
  void router.navigate(1); await settle();
  check(prompts === 3 && router.state.location.pathname === '/settings/events'
    && host.querySelector('#event-title').value === 'Forward draft', 'Forward rejection preserves draft with one prompt');
  window.confirm = () => { prompts++; return true; };
  void router.navigate(1); await settle();
  check(prompts === 4 && router.state.location.pathname === '/profile', 'Forward acceptance navigates exactly once');
  void router.navigate(-1); await settle();
  const cleanPromptCount = prompts;
  void router.navigate(-1); await settle();
  check(router.state.location.pathname === '/settings' && prompts === cleanPromptCount, 'clean Back navigation has no prompt');
  void router.navigate(1); await settle();
  check(router.state.location.pathname === '/settings/events' && prompts === cleanPromptCount, 'clean Forward navigation has no prompt');
  window.confirm = () => true;
  flushSync(() => yearSetter(YEAR_B)); await settle();
  click('Add event'); await new Promise(resolve => requestAnimationFrame(resolve));
  input('#event-title', 'Valid title'); input('#event-date', '2027-12-01');
  input('#event-location', `Room${String.fromCodePoint(0x200b)} one`);
  check(host.querySelector('#event-location').value.includes(String.fromCodePoint(0x200b)), 'location fixture contains zero-width character');
  check(/[\p{Cc}\p{Cf}]/u.test(host.querySelector('#event-location').value), 'browser classifies fixture as control or format text');
  submit(); await settle();
  check(document.activeElement?.id === 'event-location', 'invalid location focuses Location');
  input('#event-location', 'Room one'); input('#event-notes', `Line${String.fromCharCode(1)} two`); submit(); await settle();
  check(document.activeElement?.id === 'event-notes', 'invalid notes focuses Notes');
  click('Cancel'); await settle();
  records.set(YEAR_B, [...records.get(YEAR_B), { id: 'long-unbroken', academicYearId: YEAR_B,
    title: 'T'.repeat(200), date: '2027-12-02', startTime: null, endTime: null,
    location: 'L'.repeat(200), notes: null, revision: 1 }]);
  flushSync(() => yearSetter(YEAR_A)); await settle(); flushSync(() => yearSetter(YEAR_B)); await settle();
  for (const width of [320, 375, 390, 430, 768, 820, 1024, 1366]) {
    host.style.width = `${width}px`;
    host.style.setProperty('--container', 'min(1200px, calc(100% - 32px))');
    host.querySelector('.classes-subnav').style.display = width <= 720 ? 'none' : 'flex';
    check(host.scrollWidth <= width + 1, `${width}px no horizontal overflow (${host.scrollWidth}px)`);
    if (width <= 430) check([...host.querySelectorAll('.events-item-copy strong')].find(node => node.textContent === 'T'.repeat(200)).getBoundingClientRect().width <= width,
      `${width}px unbroken title stays within viewport`);
  }
  click(`Edit ${'T'.repeat(200)}`); input('#event-title', 'Discarded scope draft');
  nextFailure = Object.assign(Error('Changed elsewhere'), { status: 409 }); submit(); await settle();
  listGate = new Promise(resolve => { releaseList = resolve; });
  click('Reload latest'); await settle();
  check(button('Reload latest').disabled, 'destructive reload is busy before a scope change');
  flushSync(() => yearSetter(YEAR_A)); await settle();
  listGate = null; releaseList(); await settle();
  check(host.textContent.includes('2026/27') && !host.textContent.includes('Discarded scope draft')
    && !button('Reload latest'), 'old destructive reload cannot discard or restore another year’s editor');
  flushSync(() => yearSetter(YEAR_B)); await settle();
  click('Add event'); input('#event-title', 'Stale recovery draft'); input('#event-date', '2027-12-03');
  nextFailure = Object.assign(Error('Response lost'), { status: 503 }); submit(); await settle();
  listGate = new Promise(resolve => { releaseList = resolve; });
  click('Reload events'); await settle();
  flushSync(() => yearSetter(YEAR_A)); await settle();
  listGate = null; releaseList(); await settle();
  check(host.textContent.includes('2026/27') && !host.textContent.includes('Stale recovery draft') && !button('Retry create'),
    'late recovery result cannot update a different year');
  flushSync(() => yearSetter(YEAR_B)); await settle();
  input('#import-preview-text-events', 'Synthetic calendar entry'); click('Extract preview'); await settle();
  check(Boolean(host.querySelector('.import-preview-results')) && !host.querySelector('[name="import-destination"]'),
    'Events AI extraction stays in Events as an unsaved preview without destination selection');
  check(host.querySelector('.import-preview-year')?.textContent.trim() === 'Academic year: 2027/28',
    'Events AI section shows only the selected academic-year label');
  const aiYear = host.querySelector('.events-import-section .import-preview-year');
  const aiYearStyle = getComputedStyle(aiYear);
  const hintStyle = getComputedStyle(host.querySelector('.events-import-section .import-preview-panel > .settings-hint'));
  check(aiYear.classList.contains('settings-hint')
    && aiYearStyle.backgroundColor === 'rgba(0, 0, 0, 0)'
    && aiYearStyle.paddingLeft === '0px' && aiYearStyle.marginTop === '0px'
    && aiYearStyle.marginBottom === '16px'
    && aiYearStyle.color === hintStyle.color
    && aiYearStyle.fontSize === hintStyle.fontSize && aiYearStyle.lineHeight === hintStyle.lineHeight
    && Number(getComputedStyle(aiYear.querySelector('strong')).fontWeight) > Number(aiYearStyle.fontWeight),
  'Events AI year label uses the School Holiday hint typography and bold year without a badge');
  const aiPanel = host.querySelector('.events-import-section .import-preview-panel');
  const aiProvider = aiPanel.querySelector(':scope > .settings-hint:not(.import-preview-year)');
  const aiLegend = aiPanel.querySelector('.import-preview-controls legend');
  const aiChoices = aiPanel.querySelector('.import-preview-choices');
  const gap = (first, second) => Math.round(second.getBoundingClientRect().top - first.getBoundingClientRect().bottom);
  check(gap(aiYear, aiProvider) >= 14 && gap(aiProvider, aiLegend) >= 20
    && gap(aiLegend, aiChoices) >= 12,
  'Events AI year, provider, Import source and input controls have the holiday-section vertical rhythm');
  let previewPrompts = 0; window.confirm = () => { previewPrompts++; return false; };
  await router.navigate('/settings'); await settle();
  check(router.state.location.pathname === '/settings/events' && previewPrompts === 1,
    'Events route blocker protects preview edits with one prompt');
  window.confirm = () => true; click('Discard preview'); await settle();
  check(!host.querySelector('.import-preview-results') && Boolean(button('Add event')),
    'discarding import preview leaves manual event creation intact');
  document.body.dataset.testResult = 'passed';
  document.body.append(Object.assign(document.createElement('pre'), { textContent: `${results.length} Events browser assertions passed` }));
}
run().catch(error => { document.body.dataset.testResult = 'failed'; document.body.append(Object.assign(document.createElement('pre'), { textContent: error.stack })); });
