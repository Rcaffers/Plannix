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
let year = structuredClone(initial), provider = { active: true, providerLabel: 'OpenAI' }, fail = false, gate;
const listeners = new Set(), saves = [], requests = [], publicCalls = [];
const setYear = value => { year = structuredClone(value); for (const listener of listeners) listener(year); };
export function useAcademicYear() {
  const [current, update] = useState(year);
  useEffect(() => { listeners.add(update); return () => listeners.delete(update); }, []);
  return { academicYears: [initial, other], selectedAcademicYearId: current.id, academicYear: current,
    isLoading: false, isSaving: false, error: '', requestReference: '', registerAcademicYearChangeGuard: () => () => {},
    selectAcademicYear: async id => setYear(id === B ? other : initial), createAcademicYear: () => setYear({ ...initial, id: null }),
    saveAcademicYear: async draft => { saves.push(structuredClone(draft)); setYear(draft); return draft; } };
}
export const aiConnectionApi = { load: async () => provider };
export const pdfFileError = () => '';
export const extractSchoolHolidays = async () => [{ label: 'Reviewed INSET Day', startDate: '2026-09-02', endDate: '2026-09-02' }];
export const extractSchoolHolidaysFromPdf = async () => ({ holidays: await extractSchoolHolidays() });
export { importSourceError };
export const extractImportPreview = async (input, { signal }) => {
  requests.push({ input, signal }); if (gate) await gate;
  if (fail) throw Object.assign(Error('Could not extract a preview.'), { requestId: '91000000-0000-4000-8000-000000000009' });
  return { destination: 'holidays', entries: [{ label: 'INSET Day', startDate: '2026-09-01', endDate: '2026-09-01', sourceDate: '1 September 2026' }] };
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
async function run() {
  await settle();
  document.body.dataset.step = 'initial';
  check(host.textContent.includes('School holidays and closures') && host.textContent.includes('Import school holidays and closures with AI')
    && host.textContent.includes('Preview calendar documents with AI'), 'draft import and preview are distinct within School holidays');
  check(host.querySelector('.school-holiday-ai > .settings-hint')?.textContent.trim() === 'Academic year: 2026/27'
    && host.querySelector('.import-preview-year')?.textContent.trim() === 'Academic year: 2026/27',
  'both holiday AI sections show only the selected academic-year label');
  check(!host.querySelector('[name="import-destination"]') && host.textContent.includes('Preview only — not saved'), 'section fixes holiday destination and marks preview unsaved');
  check(getComputedStyle(host.querySelector('.school-holiday-ai')).borderLeftWidth === '0px'
    && !host.querySelector('.school-holiday-ai .settings-timetable-form'), 'restored draft action does not add a nested settings card');
  check(button('+ Add holiday') && button('Save academic year'), 'manual holiday and Save remain separate');
  input('#import-preview-text-holidays', 'INSET Day 1 Tuesday 1 September 2026'); click('Extract preview'); await settle();
  document.body.dataset.step = 'extracted';
  check(host.querySelector('#import-0-label')?.value === 'INSET Day' && saves.length === 0, 'extraction shows editable preview without saving');
  input('#import-0-label', 'Corrected INSET Day');
  check(host.querySelector('#import-0-label').value === 'Corrected INSET Day' && !host.querySelector('#school-holidays-panel input'), 'editing preview does not mutate holiday draft');
  check(saves.length === 0 && host.querySelector('.import-preview-entry'), 'preview has not triggered academic-year persistence');
  window.confirm = () => true; click('Discard preview'); await settle();
  input('#school-holiday-text', 'INSET Day 2 Wednesday 2 September 2026'); click('Extract holidays'); await settle();
  check(Boolean(button('Add selected holidays')) && !host.querySelector('#school-holidays-panel input') && saves.length === 0,
    'established extraction reviews suggestions without changing draft or persisted holidays');
  click('Add selected holidays'); await settle();
  check(host.querySelector('#school-holidays-panel input')?.value === 'Reviewed INSET Day' && saves.length === 0,
    'explicit Add selected holidays merges the reviewed school holiday into the draft only');
  click('Save academic year'); await settle();
  check(saves.length === 1 && saves[0].holidays.some(holiday => holiday.label === 'Reviewed INSET Day'),
    'Save academic year remains the persistence action for reviewed holidays');
  click('+ Add holiday'); await settle();
  document.body.dataset.step = 'manual school';
  check(host.querySelector('#school-holidays-panel input') && host.querySelector('#school-holidays-toggle').getAttribute('aria-expanded') === 'true', 'manual addition still expands school list');
  click('+ Add public holiday'); await settle();
  check(host.querySelector('#public-holidays-panel input') && host.querySelector('#public-holidays-toggle').getAttribute('aria-expanded') === 'true', 'manual public holiday remains available');
  check(requests.every(call => call.input.destination === 'holidays') && publicCalls.length === 0, 'AI never chooses event destination or calls location import');
  input('#import-preview-text-holidays', 'Another calendar'); click('Extract preview'); await settle();
  let prompts = 0; window.confirm = () => { prompts++; return false; };
  await router.navigate('/settings'); await settle();
  check(router.state.location.pathname === '/settings/academic-year' && prompts === 1
    && host.querySelector('#school-holidays-panel input') && host.querySelector('.import-preview-results'),
  'combined manual draft and preview block route navigation with one confirmation');
  check(window.__plannixConfirmImportPreviewDiscard === undefined && window.__plannixConfirmAcademicYearDiscard?.() === false
    && prompts === 2, 'sign-out uses one combined Academic Year confirmation and preserves both edits on rejection');
  window.confirm = () => true; click('Discard preview'); await settle();
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
