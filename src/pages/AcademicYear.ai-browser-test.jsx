import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MemoryRouter } from 'react-router-dom';
import AcademicYear from './AcademicYear.jsx';
import { createHolidayExtractionApi } from '../utils/holidayExtractionApi.js';
import { ApiError } from '../utils/api.js';
import { AI_PROVIDERS } from '../../shared/aiProviders.js';
import '../styles/base.css';

const base = { id: 'year-a', label: '2026/27', startDate: '2026-09-01', endDate: '2027-08-31', holidays: [] };
const suggestion = { label: 'Autumn break', startDate: '2026-10-20', endDate: '2026-10-28' };
let metadata = null, metadataFailure = false, metadataGate = null;
let failSave = false;
let initialHolidays = [];
let publicGate = null;
let publicResults = [{ name: 'Public day', date: '2026-12-25' }];
let holidays = [suggestion], status = 200, message = 'PRIVATE upstream detail', gate = null;
const requests = [], saves = [], publicCalls = [], publicSignals = [], reloads = [];
// The auth SDK may probe storage when imported; holiday interactions must never use it.
const initialStorageCalls = window.testStorageCalls;
export const aiConnectionApi = { async load() { if (metadataGate) await metadataGate; if (metadataFailure) throw new ApiError('safe metadata error'); return metadata; } };
export const extractSchoolHolidays = createHolidayExtractionApi({ getSession: async () => ({ access_token: 'synthetic-test-session' }), fetchImpl: async (url, options) => {
  requests.push({ url, ...options });
  const returned = structuredClone(holidays);
  if (gate) await gate; // Intentionally ignore AbortSignal to test stale-result protection too.
  return new Response(JSON.stringify(status === 200 ? { holidays: returned } : { message }), { status, headers: { 'retry-after': '30', 'x-request-id': '00000000-0000-4000-8000-000000000001' } });
} });
export const fetchHolidayCountries = async () => [{ countryCode: 'GB', name: 'United Kingdom' }];
export const resolveCountryFromCoordinates = async () => ({ countryCode: 'GB', countryName: 'United Kingdom' });
export const fetchPublicHolidays = async ({ year }, { signal } = {}) => { publicSignals.push(signal); publicCalls.push(year); if (publicGate) await publicGate; return year === 2026 ? structuredClone(publicResults) : []; };
export function useAcademicYear() {
  const [year, setYear] = useState(() => ({ ...structuredClone(base), holidays: structuredClone(initialHolidays) }));
  const [saveError, setSaveError] = useState('');
  const persisted = useRef(new Map());
  return { academicYears: [base, { ...base, id: 'year-b', label: 'Other year' }], selectedAcademicYearId: year.id, academicYear: year,
    isLoading: false, isSaving: false, error: saveError, requestReference: '',
    selectAcademicYear: async id => { reloads.push(id); setYear(structuredClone(persisted.current.get(id) || { ...base, id })); }, createAcademicYear: () => setYear({ ...structuredClone(base), id: null }),
    saveAcademicYear: async draft => { saves.push(structuredClone(draft)); if (failSave) { setSaveError('Could not save academic year. Try again.'); return null; } setSaveError(''); persisted.current.set(draft.id, structuredClone(draft)); setYear(draft); return draft; } };
}
const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
const results = []; const measurements = [];
const check = (condition, message) => { if (!condition) throw Error(message); results.push(message); };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function settle() { await tick(); await tick(); await tick(); }
const button = label => [...host.querySelectorAll('button')].find(el => el.textContent === label);
const click = label => { if (!button(label)) throw Error(`Missing button ${label}`); flushSync(() => button(label).click()); };
function input(selector, value) {
  const el = host.querySelector(selector); if (!el) throw Error(`Missing input ${selector}`);
  flushSync(() => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}
const connected = provider => ({ provider: provider.id, providerLabel: provider.label, active: true, lastFour: '0000' });
async function mount(connection = connected(AI_PROVIDERS[0])) {
  failSave = false; metadata = connection; metadataFailure = false; metadataGate = null; holidays = [suggestion]; status = 200; gate = null;
  requests.length = 0; saves.length = 0;
  flushSync(() => root.render(<MemoryRouter key={Math.random()} initialEntries={['/settings/academic-year']}><AcademicYear /></MemoryRouter>)); await settle();
}
async function extract() { input('#school-holiday-text', 'Synthetic calendar text'); click('Extract holidays'); await settle(); }
const manualRows = () => host.querySelectorAll('[id^="holiday-label-"]');
async function run() {
  window.confirm = () => true;
  initialHolidays = [{ ...suggestion, id: 'school-1', holidayType: 'school' }, { ...suggestion, id: 'public-1', label: 'Public fixture', holidayType: 'public' }];
  await mount();
  const panel = type => host.querySelector(`#${type}-holidays-panel`);
  const toggle = type => host.querySelector(`#${type}-holidays-toggle`);
  check(panel('school').hidden && panel('public').hidden, 'Both lists initially collapsed with saved rows');
  check(toggle('school').textContent === 'Show school holidays (1)' && toggle('public').textContent === 'Show public holidays (1)', 'Category-specific counts');
  check(['school', 'public'].every(type => toggle(type).getAttribute('aria-expanded') === 'false' && toggle(type).getAttribute('aria-controls') === panel(type).id), 'Accessible stable panel references and collapsed state');
  const hiddenInput = panel('school').querySelector('input'); hiddenInput.focus();
  check(document.activeElement !== hiddenInput && !hiddenInput.getClientRects().length, 'Collapsed inputs invisible and cannot receive focus');
  click('Show school holidays (1)'); check(!panel('school').hidden && panel('public').hidden, 'School toggle independent');
  click('Show public holidays (1)'); click('Hide school holidays'); check(panel('school').hidden && !panel('public').hidden, 'Public toggle independent');
  click('Hide public holidays'); click('Save academic year'); await settle();
  check(saves[0].holidays.length === 2 && saves[0].holidays[1].holidayType === 'public', 'Collapsed holidays retained unchanged in save payload');
  let confirms = 0; window.confirm = () => { confirms++; return true; };
  click('Show school holidays (1)'); input('#academic-year-selector', 'year-b'); await settle();
  check(!confirms && panel('school').hidden && panel('public').hidden, 'Toggles do not dirty draft; year switch collapses both');
  window.confirm = () => true;
  initialHolidays = []; await mount(); const beforePublic = publicCalls.length;
  click('+ Add public holiday');
  check(!panel('public').hidden && panel('school').hidden && publicCalls.length === beforePublic && !host.querySelector('#holiday-country-input'), 'Manual public addition without location makes no API request');
  const publicInput = panel('public').querySelector('input'); const publicId = publicInput.id.replace('holiday-label-', '');
  check(document.activeElement === publicInput, 'Manual public addition focuses first editable field');
  input(`#${publicInput.id}`, 'Manual public day'); input(`#holiday-start-${publicId}`, '2026-12-25'); input(`#holiday-end-${publicId}`, '2026-12-25');
  click('Hide public holidays'); failSave = true; click('Save academic year'); await settle();
  check(!panel('public').hidden && saves[0].holidays[0].holidayType === 'public' && host.querySelector('[role=alert]') === document.activeElement, 'Failed save reveals holidays and focuses visible error; explicit public category');
  failSave = false; click('Save academic year'); await settle();
  check(saves.length === 2 && saves[1].holidays[0].label === 'Manual public day', 'Manual public draft persists only through academic-year Save');
  click('+ Add holiday'); check(!panel('school').hidden && document.activeElement.closest('#school-holidays-panel'), 'Manual school addition expands and focuses school row');
  click('Hide school holidays'); const saveCount = saves.length; click('Save academic year'); await settle();
  check(!panel('school').hidden && document.activeElement.closest('#school-holidays-panel') && saves.length === saveCount, 'Hidden invalid holiday expands and focuses without saving');
  const schoolInput = panel('school').querySelector('input'); const schoolId = schoolInput.id.replace('holiday-label-', '');
  input(`#${schoolInput.id}`, ' MANUAL   public day '); input(`#holiday-start-${schoolId}`, '2026-12-25'); input(`#holiday-end-${schoolId}`, '2026-12-25');
  click('Save academic year'); check(saves.length === saveCount && host.textContent.includes('already exists'), 'Cross-category manual duplicate blocks Save');
  flushSync(() => panel('school').querySelector('.settings-holiday-remove').click());
  check(panel('school').textContent.includes('No school holidays yet') && toggle('school').getAttribute('aria-label').includes('(0)'), 'Removing final row updates count and empty state');
  initialHolidays = Array.from({ length: 100 }, (_, i) => ({ ...suggestion, id: `limit-${i}`, label: `Holiday ${i}`, holidayType: i % 2 ? 'public' : 'school' }));
  await mount(); check(button('+ Add holiday').disabled && button('+ Add public holiday').disabled, 'Combined hundred-holiday limit blocks both manual controls');
  click('Choose country'); input('#holiday-country-input', 'GB'); click('Import holidays'); await settle();
  check(host.textContent.includes('no more than 100') && manualRows().length === 100 && panel('public').hidden, 'Over-limit location import rejects atomically with visible error');
  initialHolidays = [{ ...suggestion, id: 'school-public-date', label: ' PUBLIC   day ', startDate: '2026-12-25', endDate: '2026-12-25', holidayType: 'school' }];
  await mount(); click('Choose country'); input('#holiday-country-input', 'GB'); click('Import holidays'); await settle();
  check(manualRows().length === 1 && toggle('public').getAttribute('aria-label').includes('(0)'), 'Location import skips normalized school-category duplicate');
  initialHolidays = []; await mount(); let releasePublic;
  publicGate = new Promise(resolve => { releasePublic = resolve; });
  click('Choose country'); input('#holiday-country-input', 'GB'); click('Import holidays'); await settle();
  input('#academic-year-selector', 'year-b'); await settle(); releasePublic(); publicGate = null; await settle();
  check(manualRows().length === 0 && panel('public').hidden, 'Late public import cannot add rows or expand a newly selected year');
  for (const change of ['boundary', 'location']) {
    await mount(); publicGate = new Promise(resolve => { releasePublic = resolve; });
    click('Choose country'); input('#holiday-country-input', 'GB'); click('Import holidays'); await settle();
    if (change === 'boundary') input('#academic-year-end', '2027-07-31');
    else input('#holiday-country-input', 'Unavailable location');
    releasePublic(); publicGate = null; await settle();
    check(manualRows().length === 0 && panel('public').hidden, `Late public response ignored after ${change} change`);
  }
  for (const trigger of ['year', 'start', 'end', 'location', 'replacement', 'unmount']) {
    for (const outcome of ['success', 'failure']) {
      initialHolidays = [{ ...suggestion, id: 'preserved', holidayType: 'school' }];
      await mount(); let resolvePending, rejectPending;
      publicGate = new Promise((resolve, reject) => { resolvePending = resolve; rejectPending = reject; });
      click('Choose country'); input('#holiday-country-input', 'GB'); click('Import holidays'); await settle();
      const pendingSignal = publicSignals.at(-1);
      if (trigger === 'year') input('#academic-year-selector', 'year-b');
      if (trigger === 'start') input('#academic-year-start', '2026-09-02');
      if (trigger === 'end') input('#academic-year-end', '2027-07-31');
      if (trigger === 'location') input('#holiday-country-input', 'Changed location');
      if (trigger === 'replacement') { click('Choose country'); publicGate = null; click('Import holidays'); }
      if (trigger === 'unmount') flushSync(() => root.render(null));
      await settle();
      check(pendingSignal?.aborted, `Public transport aborted on ${trigger} (${outcome})`);
      if (outcome === 'success') resolvePending(); else rejectPending(new Error('STALE public import failure'));
      publicGate = null; await settle();
      check(!host.textContent.includes('STALE'), `Stale public ${outcome} ignored after ${trigger}`);
      if (!['year', 'unmount'].includes(trigger)) check(host.querySelector('#holiday-label-preserved')?.value === suggestion.label, `${trigger} cancellation retains imported draft rows`);
    }
  }
  initialHolidays = [];
  for (const action of ['+ Add holiday', '+ Add public holiday', 'AI', 'location']) {
    initialHolidays = Array.from({ length: 99 }, (_, i) => ({ ...suggestion, id: `edge-${i}`, label: `Holiday ${i}`, holidayType: i % 2 ? 'school' : 'public' }));
    await mount();
    if (action === 'AI') { await extract(); click('Add selected holidays'); }
    else if (action === 'location') { click('Choose country'); input('#holiday-country-input', 'GB'); click('Import holidays'); await settle(); }
    else click(action);
    check(manualRows().length === 100, `${action} accepts 99 to 100 combined rows`);
    if (action === 'AI') { holidays = [{ ...suggestion, label: 'Excess holiday' }]; await extract(); check(button('Add selected holidays').disabled, 'AI prevents 100 to 101'); }
    else if (action !== 'location') check(button(action).disabled, `${action} prevents 100 to 101`);
    check(manualRows().length === 100, `${action} limit leaves complete draft intact`);
  }
  initialHolidays = Array.from({ length: 99 }, (_, i) => ({ ...suggestion, id: `batch-${i}`, label: `Holiday ${i}`, holidayType: i % 2 ? 'school' : 'public' }));
  await mount(); publicResults = [{ name: 'Public one', date: '2026-12-25' }, { name: 'Public two', date: '2026-12-26' }];
  click('Choose country'); input('#holiday-country-input', 'GB'); click('Import holidays'); await settle();
  check(manualRows().length === 99 && host.textContent.includes('no more than 100'), 'Location batch 99 to 101 rejects atomically without first addition');
  publicResults = [{ name: 'Public day', date: '2026-12-25' }];
  initialHolidays = [{ ...suggestion, id: 'mixed-school', holidayType: 'school' }, { ...suggestion, id: 'mixed-public', label: 'Public fixture', holidayType: 'public' }];
  await mount(); failSave = true; click('Save academic year'); await settle();
  check(manualRows().length === 2 && saves[0].holidays.map(h => h.holidayType).join(',') === 'school,public' && !panel('school').hidden && !panel('public').hidden, 'Failed save preserves and reveals complete mixed-category draft');
  failSave = false; click('Save academic year'); await settle();
  input('#academic-year-selector', 'year-b'); await settle(); input('#academic-year-selector', 'year-a'); await settle();
  check(reloads.at(-1) === 'year-a' && manualRows().length === 2 && panel('school').hidden && panel('public').hidden && toggle('school').textContent.includes('(1)') && toggle('public').textContent.includes('(1)'), 'Independent mocked saved-plan reload restores both categories and collapsed lists');
  initialHolidays = Array.from({ length: 101 }, (_, i) => ({ ...suggestion, id: `overflow-${i}`, label: `Holiday ${i}`, holidayType: i % 2 ? 'school' : 'public' }));
  await mount(); check(button('+ Add holiday').disabled && button('+ Add public holiday').disabled, 'Already oversized mixed draft cannot accept manual additions');

  initialHolidays = [];
  publicCalls.length = 0;
  for (const provider of AI_PROVIDERS) { await mount(connected(provider)); check(host.textContent.includes(`Connected to ${provider.label}`), `${provider.label} connected controls`); }
  await mount(null); check(!host.querySelector('textarea') && !button('Extract holidays') && host.querySelector('a[href="/profile"]'), 'Disconnected guidance and Profile link without form');
  metadataFailure = true; flushSync(() => root.render(<MemoryRouter key="error"><AcademicYear /></MemoryRouter>)); await settle();
  check(host.querySelector('[role="alert"]') && button('Retry connection'), 'Metadata error and accessible retry');
  metadataFailure = false; metadata = connected(AI_PROVIDERS[1]); click('Retry connection'); await settle(); check(host.querySelector('textarea'), 'Metadata retry recovers');
  let release; metadataGate = new Promise(resolve => { release = resolve; });
  flushSync(() => root.render(<MemoryRouter key="loading"><AcademicYear /></MemoryRouter>));
  check(host.textContent.includes('Loading AI connection'), 'Metadata loading status'); release(); await settle();
  await mount(); check(button('Extract holidays').disabled, 'Empty pasted text disabled');
  input('#school-holiday-text', 'é'.repeat(25001)); check(button('Extract holidays').disabled && host.textContent.includes('50,002'), 'Multibyte text limit');
  input('#school-holiday-text', 'Calendar'); input('#academic-year-start', ''); check(button('Extract holidays').disabled, 'Missing boundaries disabled'); input('#academic-year-start', base.startDate);
  gate = new Promise(resolve => { release = resolve; });
  flushSync(() => { button('Extract holidays').click(); button('Extract holidays').click(); }); await settle();
  check(requests.length === 1 && host.querySelector('textarea').matches(':disabled'), 'Duplicate extraction blocked and controls disabled');
  check(Object.keys(JSON.parse(requests[0].body)).sort().join(',') === 'academicYearEndDate,academicYearStartDate,text', 'Exact three-field authenticated extraction payload');
  click('Cancel extraction'); check(requests[0].signal.aborted, 'Cancel aborts pending request'); release(); await settle(); check(!host.querySelector('#school-holiday-review-heading'), 'Cancelled response ignored'); gate = null;
  await extract(); check(document.activeElement.id === 'school-holiday-review-heading', 'Success focuses review heading');
  check(manualRows().length === 0 && saves.length === 0, 'Suggestions remain outside draft and persistence');
  input('#suggestion-0-label', 'Edited break'); input('#suggestion-0-startDate', '2026-10-19'); input('#suggestion-0-endDate', '2026-10-29');
  input('#academic-year-start', '2026-11-01'); check(button('Add selected holidays').disabled && host.querySelector('[aria-invalid="true"]'), 'Boundary edits visibly revalidate review');
  input('#academic-year-start', base.startDate); input('#suggestion-0-label', ''); check(button('Add selected holidays').disabled, 'Invalid edited label blocks addition'); input('#suggestion-0-label', 'Edited break');
  click('Add selected holidays'); check(manualRows().length === 1 && saves.length === 0 && host.querySelector('[role="status"]').textContent.includes('1 holidays added'), 'Add changes draft only and announces result');
  check(!host.querySelector('#school-holidays-panel').hidden && document.activeElement.closest('#school-holidays-panel'), 'AI addition expands school list and focuses new row');
  holidays = [{ label: ' edited   break ', startDate: '2026-10-19', endDate: '2026-10-29' }, { ...suggestion, label: 'Overlapping closure' }]; await extract();
  click('Add selected holidays'); check(manualRows().length === 2 && host.textContent.includes('1 exact duplicates skipped'), 'Exact duplicate skipped; differently labelled overlap kept');
  holidays = [suggestion, { ...suggestion, label: 'Second suggestion' }]; await extract();
  flushSync(() => host.querySelector('input[type="checkbox"]').click());
  click('Add selected holidays'); check(manualRows().length === 3 && [...manualRows()].some(el => el.value === 'Second suggestion'), 'Exclude control omits suggestion');
  holidays = []; await extract(); check(host.textContent.includes('No reliable holiday suggestions') && button('Add selected holidays').disabled, 'Zero suggestions reviewed safely'); click('Discard suggestions');
  holidays = [suggestion]; await extract(); click('Discard suggestions'); check(manualRows().length === 3, 'Discard leaves draft unchanged');
  click('Choose country'); input('#holiday-country-input', 'GB'); const aiBefore = requests.length; click('Import holidays'); await settle();
  check(manualRows().length === 4 && publicCalls.length === 2 && requests.length === aiBefore, 'Public import uses independent location API');
  check(!host.querySelector('#public-holidays-panel').hidden, 'Location import expands public list');
  check(document.activeElement.closest('#public-holidays-panel') && document.activeElement.value === 'Public day', 'Location import focuses first genuinely new public row');
  check(host.querySelectorAll('[aria-labelledby=public-holidays-heading] [id^=holiday-label-]').length === 1 && host.querySelectorAll('[aria-labelledby=school-holidays-heading] [id^=holiday-label-]').length === 3, 'School and public rows occupy separate sections');
  click('Import holidays'); await settle(); check(manualRows().length === 4, 'Public exact duplicates skipped');
  check(document.activeElement.id === 'public-holiday-import-status', 'Duplicate-only import focuses accessible status summary');
  click('+ Add holiday'); check(manualRows().length === 5, 'Manual add preserved');
  const last = [...host.querySelectorAll('[aria-labelledby=school-holidays-heading] [id^=holiday-label-]')].at(-1); const id = last.id.replace('holiday-label-', '');
  input(`#${last.id}`, 'Manual closure'); input(`#holiday-start-${id}`, '2027-01-04'); input(`#holiday-end-${id}`, '2027-01-04');
  input('[aria-labelledby=public-holidays-heading] [id^=holiday-label-]', 'Reviewed public day');
  click('Save academic year'); await settle(); check(saves.length === 1 && saves[0].holidays.length === 5, 'Only Save academic year persists combined manual/public/AI draft');
  check(saves[0].holidays.filter(h => h.holidayType === 'school').length === 4 && saves[0].holidays.filter(h => h.holidayType === 'public').length === 1, 'Save retains school/manual/AI and public categories');
  check(saves[0].holidays.find(h => h.holidayType === 'public').label === 'Reviewed public day', 'Editing a public holiday preserves its category');
  check(host.querySelectorAll('[aria-labelledby=public-holidays-heading] [id^=holiday-label-]').length === 1, 'Saved context reload preserves public section');
  flushSync(() => [...host.querySelectorAll('[aria-labelledby=school-holidays-heading] .settings-holiday-remove')].at(-1).click()); check(manualRows().length === 4, 'Manual removal preserved');
  for (const code of [400, 401, 403, 409, 422, 429, 502, 503, 504, 500]) {
    status = code; await extract();
    check(host.querySelector('[role="alert"]') === document.activeElement && !host.textContent.includes('PRIVATE') && host.textContent.includes('Support reference:'), `Status ${code}: safe alert, focus and reference`);
    check(manualRows().length === 4 && saves.length === 1, `Status ${code}: draft and persistence unchanged`);
    if (code === 429) check(host.textContent.includes('30 seconds'), 'Retry-After shown');
  }
  status = 409; message = 'Connect an AI provider in Profile before extracting holidays.'; metadata = null; await extract();
  check(!host.querySelector('textarea') && host.textContent.includes('Connect an AI provider'), 'Missing connection refreshes metadata and Profile guidance');
  await mount(); gate = new Promise(resolve => { release = resolve; }); input('#school-holiday-text', 'Calendar'); click('Extract holidays'); await settle();
  const old = requests[0]; input('#academic-year-selector', 'year-b'); await settle();
  check(old.signal.aborted && host.querySelector('textarea').value === '', 'Year switch aborts and clears source text'); release(); await settle(); check(!host.querySelector('#school-holiday-review-heading'), 'Late old-year result ignored');
  gate = null; await extract(); input('#academic-year-selector', 'year-a'); await settle(); check(!host.querySelector('#school-holiday-review-heading') && !host.querySelector('[role="alert"]'), 'Year switch clears pending review and errors');
  gate = new Promise(resolve => { release = resolve; }); input('#school-holiday-text', 'Calendar'); click('Extract holidays'); await settle(); const unmounted = requests.at(-1);
  flushSync(() => root.render(null)); check(unmounted.signal.aborted, 'Unmount aborts extraction'); release(); await settle();
  await mount(); await extract(); click('Add selected holidays'); failSave = true; click('Save academic year'); await settle();
  check(host.textContent.includes('Could not save academic year') && manualRows().length === 1 && !host.querySelector('.settings-saved'), 'Save failure preserves combined draft and visible error');
  failSave = false; click('Save academic year'); await settle(); check(host.querySelector('.settings-saved'), 'Existing save retry succeeds');
  status = 502; await extract(); check(host.querySelector('.school-holiday-error'), 'Extraction error present before year switch');
  input('#academic-year-selector', 'year-b'); await settle();
  check(!host.querySelector('.school-holiday-error') && host.querySelector('textarea').value === '', 'Year switch clears actual extraction error and text');
  await mount(); gate = new Promise(resolve => { release = resolve; });
  input('#school-holiday-text', 'Date change extraction'); click('Extract holidays'); await settle();
  const datedRequest = requests.at(-1); input('#academic-year-end', '2027-07-31');
  check(datedRequest.signal.aborted, 'Boundary change aborts pending extraction'); release(); await settle();
  check(!host.querySelector('#school-holiday-review-heading'), 'Old-boundary response ignored');
  await mount(); gate = new Promise(resolve => { release = resolve; });
  input('#school-holiday-text', 'Old extraction'); click('Extract holidays'); await settle();
  const replaced = requests.at(-1); click('Cancel extraction'); gate = null;
  holidays = [{ ...suggestion, label: 'Replacement suggestion' }]; await extract();
  release(); await settle();
  check(replaced.signal.aborted && host.querySelector('#suggestion-0-label').value === 'Replacement suggestion', 'Replacement extraction ignores old completion');
  check(window.testNetworkCalls === 0 && window.testStorageCalls === initialStorageCalls, 'No native network or holiday-workflow browser storage access');
  click('Choose country'); input('#holiday-country-input', 'GB'); click('Import holidays'); await settle();
  for (const width of [320, 375, 390, 430, 820, 1366]) {
    window.frameElement.style.width = `${width}px`; await settle();
    const section = host.querySelector('.school-holiday-ai').getBoundingClientRect();
    const textarea = host.querySelector('textarea').getBoundingClientRect();
    const overflow = [...host.querySelectorAll('input, textarea, button')].filter(el => el.getBoundingClientRect().width && (el.getBoundingClientRect().right > innerWidth + 1 || el.getBoundingClientRect().left < -1));
    check(document.documentElement.scrollWidth <= innerWidth && !overflow.length, `${width}px no document/control overflow`);
    check(textarea.right <= section.right && textarea.left >= section.left, `${width}px textarea fits import section`);
    for (const type of ['school', 'public']) {
      if (!panel(type).hidden) flushSync(() => toggle(type).click());
      check(panel(type).getBoundingClientRect().height === 0, `${width}px collapsed ${type} panel occupies no space`);
      flushSync(() => toggle(type).click());
      check(toggle(type).getAttribute('aria-expanded') === 'true', `${width}px ${type} toggle expanded state`);
    }
    check(document.documentElement.scrollWidth <= innerWidth, `${width}px expanded lists do not overflow`);
    measurements.push({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, importWidth: Math.round(section.width), textareaWidth: Math.round(textarea.width) });
  }
  check([...host.querySelectorAll('.school-holiday-review input')].every(el => el.labels?.length), 'Review controls have associated unique labels');
  click('Discard suggestions'); input('#school-holiday-text', 'Keyboard test calendar'); button('Extract holidays').focus();
}
run().then(() => { parent.document.body.dataset.testResult = 'passed'; }, error => { parent.document.body.dataset.testResult = 'failed'; results.push(error.stack); }).finally(() => {
  const pre = parent.document.createElement('pre'); pre.textContent = JSON.stringify({ assertions: results, measurements }, null, 2); parent.document.body.append(pre);
});
