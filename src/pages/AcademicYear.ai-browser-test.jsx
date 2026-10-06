import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import AcademicYear from './AcademicYear.jsx';
import { importSourceError } from '../utils/importPreviewApi.js';
import '../styles/base.css';
import '../styles/accessibility.css';

const A = '91000000-0000-4000-8000-000000000001', B = '91000000-0000-4000-8000-000000000002';
const initial = { id: A, label: '2026/27', startDate: '2026-09-01', endDate: '2027-08-31', holidays: [] };
const other = { id: B, label: '2027/28', startDate: '2027-09-01', endDate: '2028-08-31', holidays: [] };
let year = structuredClone(initial), provider = { active: true, providerLabel: 'OpenAI' }, providerLoads = 0, fail = false, gate;
const listeners = new Set(), saves = [], requests = [], legacyCalls = [], publicCalls = [];
const setYear = value => { year = structuredClone(value); for (const listener of listeners) listener(year); };
export function useAcademicYear() {
  const [current, update] = useState(year);
  useEffect(() => { listeners.add(update); return () => listeners.delete(update); }, []);
  return { academicYears: [initial, other], selectedAcademicYearId: current.id, academicYear: current,
    isLoading: false, isSaving: false, error: '', requestReference: '', registerAcademicYearChangeGuard: () => () => {},
    selectAcademicYear: async id => setYear(id === B ? other : initial), createAcademicYear: () => setYear({ ...initial, id: null }),
    saveAcademicYear: async draft => { saves.push(structuredClone(draft)); setYear(draft); return draft; } };
}
export const aiConnectionApi = { load: async () => { providerLoads++; return provider; } };
export const pdfFileError = file => file instanceof Blob && file.type === 'application/pdf' && file.size <= 10 * 1024 * 1024 ? '' : 'Choose one PDF no larger than 10 MiB.';
export const extractSchoolHolidays = async input => { legacyCalls.push({ mode: 'text', input });
  return [{ label: 'Reviewed INSET Day', startDate: '2026-09-02', endDate: '2026-09-02' }]; };
export const extractSchoolHolidaysFromPdf = async input => { legacyCalls.push({ mode: 'pdf', input });
  return { holidays: [{ label: 'PDF INSET Day', startDate: '2026-09-04', endDate: '2026-09-04' }] }; };
export { importSourceError };
export const extractImportPreview = async (input, { signal }) => {
  requests.push({ input, signal }); if (gate) await gate;
  if (fail) throw Object.assign(Error('Could not extract a preview.'), { requestId: '91000000-0000-4000-8000-000000000009' });
  return { destination: 'holidays', entries: [{ label: `${input.mode.toUpperCase()}${input.file?.type === 'image/jpeg' ? ' JPEG' : ''} INSET Day`, startDate: '2026-09-03', endDate: '2026-09-03',
    sourceDate: input.file?.name?.startsWith('ambiguous') ? '03/04/2027' : '3 September 2026' }] };
};
export const fetchHolidayCountries = async () => [{ countryCode: 'GB', name: 'United Kingdom' }];
export const resolveCountryFromCoordinates = async () => ({ countryCode: 'GB', countryName: 'United Kingdom' });
export const fetchPublicHolidays = async ({ year: requested }) => { publicCalls.push(requested); return requested === 2026 ? [{ name: 'Public day', date: '2026-12-25' }] : []; };

const host = document.createElement('div'); document.body.append(host);
const router = createMemoryRouter([{ path: '/settings/academic-year', element: <AcademicYear userId="91000000-0000-4000-8000-000000000011" /> },
  { path: '/settings', element: <p>Settings</p> }], { initialEntries: ['/settings/academic-year'] });
const root = createRoot(host); root.render(<RouterProvider router={router} />);
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
const checks = []; const check = (value, label) => { if (!value) throw Error(`${label}: ${host.textContent.slice(-700)}`); checks.push(label); };
const button = label => [...host.querySelectorAll('button')].find(node => node.textContent === label);
const click = label => { const node = button(label); if (!node) throw Error(`Missing ${label}`); flushSync(() => node.click()); };
const input = (selector, value) => { const node = host.querySelector(selector); if (!node) throw Error(`Missing ${selector}`);
  flushSync(() => { const proto = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value);
    node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); }); };
const chooseFile = (name, type) => { const node = host.querySelector('#school-holiday-file');
  const transfer = new DataTransfer(); const file = new File(['synthetic calendar'], name, { type }); transfer.items.add(file);
  Object.defineProperty(node, 'files', { configurable: true, value: transfer.files });
  flushSync(() => node.dispatchEvent(new Event('change', { bubbles: true }))); return file; };
async function run() {
  await settle();
  document.body.dataset.step = 'initial';
  check(host.textContent.includes('School holidays and closures') && host.querySelectorAll('#school-holiday-ai-heading').length === 1
    && !host.querySelector('.import-preview-panel')
    && !host.textContent.includes('Editable document preview'), 'one holiday AI section has no separate document-preview interface');
  check(host.querySelector('.school-holiday-ai > .settings-hint')?.textContent.trim() === 'Academic year: 2026/27'
    && [...host.querySelectorAll('.school-holiday-ai p')].filter(node => node.textContent.startsWith('Academic year:')).length === 1,
  'holiday AI shows one selected academic-year label');
  check(providerLoads === 1 && [...host.querySelectorAll('.school-holiday-ai p')].filter(node => node.textContent.startsWith('Connected to OpenAI.')).length === 1,
    'holiday AI loads and describes the provider once');
  check(['Paste text', 'Upload PDF', 'Upload image', 'Upload Excel', 'Upload CSV'].every(label => button(label))
    && host.querySelector('.school-holiday-modes[aria-label="Holiday extraction method"]'),
  'all five source methods use one holiday extraction control group');
  check(getComputedStyle(host.querySelector('.school-holiday-ai')).borderLeftWidth === '0px'
    && !host.querySelector('.school-holiday-ai .settings-timetable-form'), 'holiday AI does not add a nested settings card');
  check(button('+ Add holiday') && button('Save academic year'), 'manual holiday and Save remain separate');
  input('#school-holiday-text', 'INSET Day 2 Wednesday 2 September 2026'); click('Extract holidays'); await settle();
  document.body.dataset.step = 'extracted';
  check(host.querySelector('#suggestion-0-label')?.value === 'Reviewed INSET Day' && saves.length === 0,
    'pasted-text extraction enters the shared review without saving');
  let reviewOnlyPrompts = 0; window.confirm = () => { reviewOnlyPrompts++; return false; };
  await router.navigate('/settings'); await settle();
  check(router.state.location.pathname === '/settings/academic-year' && reviewOnlyPrompts === 1
    && host.querySelector('#suggestion-0-label')?.value === 'Reviewed INSET Day',
    'unsaved AI review alone blocks navigation with one prompt');
  window.confirm = () => true;
  input('#suggestion-0-label', 'Corrected INSET Day');
  check(host.querySelector('#suggestion-0-label').value === 'Corrected INSET Day' && !host.querySelector('#school-holidays-panel input'),
    'review correction does not mutate the draft');
  flushSync(() => host.querySelector('.school-holiday-include input').click());
  check(button('Add selected holidays').disabled, 'unselected suggestion cannot be added');
  flushSync(() => host.querySelector('.school-holiday-include input').click());
  check(Boolean(button('Add selected holidays')) && !host.querySelector('#school-holidays-panel input') && saves.length === 0,
    'established extraction reviews suggestions without changing draft or persisted holidays');
  click('Add selected holidays'); await settle();
  check(host.querySelector('#school-holidays-panel input')?.value === 'Corrected INSET Day' && saves.length === 0,
    'explicit Add selected holidays merges the reviewed school holiday into the draft only');
  click('Save academic year'); await settle();
  check(saves.length === 1 && saves[0].holidays.some(holiday => holiday.label === 'Corrected INSET Day'),
    'Save academic year remains the persistence action for reviewed holidays');
  for (const [mode, filename, type, action, label] of [
    ['pdf', 'calendar.pdf', 'application/pdf', 'Extract holidays from PDF', 'PDF INSET Day'],
    ['image', 'calendar.png', 'image/png', 'Extract holidays from image', 'IMAGE INSET Day'],
    ['image', 'calendar.jpg', 'image/jpeg', 'Extract holidays from image', 'IMAGE JPEG INSET Day'],
    ['xlsx', 'calendar.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Extract holidays from Excel file', 'XLSX INSET Day'],
    ['csv', 'calendar.csv', 'text/csv', 'Extract holidays from CSV file', 'CSV INSET Day'],
  ]) {
    click({ pdf: 'Upload PDF', image: 'Upload image', xlsx: 'Upload Excel', csv: 'Upload CSV' }[mode]);
    if (mode === 'image') check(host.querySelector('#school-holiday-file')?.accept.includes('image/jpeg'),
      'image picker accepts JPEG as well as PNG');
    const file = chooseFile(filename, type), beforeSave = saves.length;
    click(action); await settle();
    check(host.querySelector('#suggestion-0-label')?.value === label && saves.length === beforeSave,
      `${mode} extraction enters the same review without saving`);
    if (mode === 'pdf') check(legacyCalls.at(-1)?.mode === 'pdf' && legacyCalls.at(-1)?.input.file === file,
      'PDF retains the bounded established extraction service');
    else check(requests.at(-1)?.input.mode === mode && requests.at(-1)?.input.file === file
      && requests.at(-1)?.input.destination === 'holidays', `${mode} uses the bounded document extraction service`);
    if (mode === 'image') {
      flushSync(() => host.querySelector('.school-holiday-include input').click());
      check(button('Add selected holidays').disabled, 'document suggestion selection controls draft addition');
      flushSync(() => host.querySelector('.school-holiday-include input').click());
    }
    input('#suggestion-0-label', `${label} corrected`);
    click('Add selected holidays'); await settle();
    check([...host.querySelectorAll('#school-holidays-panel input')].some(node => node.value === `${label} corrected`) && saves.length === beforeSave,
      `${mode} corrected suggestion enters only the draft`);
    click('Save academic year'); await settle();
    check(saves.length === beforeSave + 1 && saves.at(-1).holidays.some(holiday => holiday.label === `${label} corrected`),
      `${mode} reviewed suggestion persists only after Save academic year`);
  }
  click('Upload image'); chooseFile('stale.png', 'image/png');
  let release; gate = new Promise(resolve => { release = resolve; });
  click('Extract holidays from image'); await settle();
  const staleSignal = requests.at(-1).signal;
  click('Upload Excel'); gate = null; release(); await settle();
  check(staleSignal.aborted && !host.querySelector('.school-holiday-review'),
    'switching formats cancels work and ignores a non-cooperative late response');
  chooseFile('late.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  gate = new Promise(resolve => { release = resolve; });
  click('Extract holidays from Excel file'); await settle();
  const oldYearSignal = requests.at(-1).signal;
  flushSync(() => setYear(other)); await settle(); gate = null; release(); await settle();
  check(oldYearSignal.aborted && !host.querySelector('.school-holiday-review')
    && host.querySelector('.school-holiday-ai > .settings-hint')?.textContent.includes('2027/28'),
  'year change rejects a non-cooperative late extraction result');
  flushSync(() => setYear(saves.at(-1))); await settle();
  click('Upload Excel');
  chooseFile('duplicate.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  click('Extract holidays from Excel file'); await settle();
  input('#suggestion-0-label', 'XLSX INSET Day corrected');
  const beforeDuplicateCount = year.holidays.length, beforeDuplicateSave = saves.length;
  click('Add selected holidays'); await settle();
  check(year.holidays.length === beforeDuplicateCount && saves.length === beforeDuplicateSave
    && !host.querySelector('.school-holiday-review'), 'exact document duplicates are skipped without changing the saved year');
  chooseFile('ambiguous.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  click('Extract holidays from Excel file'); await settle();
  check(host.textContent.includes('Confirm the ambiguous source date') && button('Add selected holidays').disabled,
    'ambiguous document dates remain visible and cannot be added without correction');
  input('#suggestion-0-startDate', '2027-04-03'); input('#suggestion-0-endDate', '2027-04-03');
  check(!button('Add selected holidays').disabled, 'correcting both ambiguous dates enables draft addition');
  click('+ Add holiday'); await settle();
  document.body.dataset.step = 'manual school';
  check(host.querySelector('#school-holidays-panel input') && host.querySelector('#school-holidays-toggle').getAttribute('aria-expanded') === 'true', 'manual addition still expands school list');
  click('+ Add public holiday'); await settle();
  check(host.querySelector('#public-holidays-panel input') && host.querySelector('#public-holidays-toggle').getAttribute('aria-expanded') === 'true', 'manual public holiday remains available');
  check(requests.every(call => call.input.destination === 'holidays') && publicCalls.length === 0, 'AI never chooses event destination or calls location import');
  let prompts = 0; window.confirm = () => { prompts++; return false; };
  await router.navigate('/settings'); await settle();
  check(router.state.location.pathname === '/settings/academic-year' && prompts === 1
    && host.querySelector('#school-holidays-panel input') && host.querySelector('.school-holiday-review'),
  'combined manual draft and AI review block route navigation with one confirmation');
  check(window.__plannixConfirmImportPreviewDiscard === undefined && window.__plannixConfirmAcademicYearDiscard?.() === false
    && prompts === 2, 'sign-out uses one combined Academic Year confirmation and preserves both edits on rejection');
  window.confirm = () => true; click('Discard suggestions'); await settle();
  // Keep an already-saved holiday expanded for the runner's native date-input measurements.
  flushSync(() => setYear({ ...initial, holidays: [
    { id: '91000000-0000-4000-8000-000000000021', label: 'Saved half-term',
      startDate: '2026-10-26', endDate: '2026-10-30', holidayType: 'school' },
    { id: '91000000-0000-4000-8000-000000000022', label: 'Saved INSET day',
      startDate: '2027-01-04', endDate: '2027-01-04', holidayType: 'school' },
  ] }));
  await settle();
  if (host.querySelector('#school-holidays-toggle')?.getAttribute('aria-expanded') !== 'true') {
    click('Show school holidays (2)'); await settle();
  }
  check(host.querySelectorAll('#school-holidays-panel .settings-holiday-card').length === 2
    && host.querySelector('#school-holidays-panel input[type="date"]')?.value === '2026-10-26'
    && host.querySelector('#school-holidays-toggle').getAttribute('aria-expanded') === 'true',
  'saved school holiday dates are expanded for responsive checks');
  document.body.dataset.testResult = 'passed'; const report = document.createElement('pre'); report.style.whiteSpace = 'pre-wrap'; report.style.overflowWrap = 'anywhere'; report.textContent = checks.join('\n'); document.body.append(report);
}
window.verifyAcademicYearSignOut = async () => {
  let prompts = 0; window.confirm = () => { prompts++; return true; };
  const allowed = window.__plannixConfirmAcademicYearDiscard?.();
  flushSync(() => root.unmount()); await settle();
  const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload);
  return { allowed, prompts, previewGuardRemoved: window.__plannixConfirmImportPreviewDiscard === undefined,
    yearGuardRemoved: window.__plannixConfirmAcademicYearDiscard === undefined, unloadBlocked: unload.defaultPrevented };
};
run().catch(error => { document.body.dataset.testResult = 'failed'; const pre = document.createElement('pre'); pre.textContent = error.stack; document.body.append(pre); });
