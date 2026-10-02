import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import ImportPreviewPanel from './ImportPreviewPanel.jsx';
import '../styles/base.css';
import '../styles/accessibility.css';

const A = '91000000-0000-4000-8000-000000000001', B = '91000000-0000-4000-8000-000000000002';
const years = { [A]: { id: A, label: '2026/27', startDate: '2026-09-01', endDate: '2027-08-31', holidays: [{ label: 'INSET Day', startDate: '2026-09-01', endDate: '2026-09-01' }] },
  [B]: { id: B, label: '2027/28', startDate: '2027-09-01', endDate: '2028-08-31', holidays: [] } };
let changeYear, extractionGate, fail = false; const calls = [];
export function useAcademicYear() { const [id, setId] = useState(A); changeYear = setId;
  return { selectedAcademicYearId: id, academicYear: years[id], isLoading: false, registerAcademicYearChangeGuard: () => () => {} }; }
export const aiConnectionApi = { load: async () => ({ active: true, providerLabel: 'OpenAI' }) };
export { importSourceError } from '../utils/importPreviewApi.js';
export const extractImportPreview = async (input, { signal }) => {
  calls.push({ input, signal }); if (extractionGate) await extractionGate;
  if (fail) throw Object.assign(Error('Safe mocked extraction error'), { requestId: '91000000-0000-4000-8000-000000000009' });
  return { entries: input.destination === 'holidays'
    ? [{ label: 'INSET Day', startDate: '2026-09-01', endDate: '2026-09-01', sourceDate: '1 September 2026' }]
    : [{ title: 'Assembly', date: '2027-03-28', sourceDate: '28 March 2027', allDay: true, startTime: '', endTime: '', location: 'Hall', notes: '' },
      { title: 'Trip', date: '', sourceDate: '03/04/2027', allDay: false, startTime: '', endTime: '', location: '', notes: '' }] };
};
const host = document.createElement('div'); document.body.append(host);
const panel = destination => <main className="settings-page"><div className="container settings-inner--wide"><h1>{destination === 'events' ? 'Events' : 'Academic year'}</h1>
  <ImportPreviewPanel userId="91000000-0000-4000-8000-000000000011" destination={destination} manageNavigation
    existing={destination === 'events' ? [{ title: 'Assembly', date: '2027-03-28', startTime: null, endTime: null }] : years[A].holidays} />
</div></main>;
const router = createMemoryRouter([{ path: '/settings/academic-year', element: panel('holidays') },
  { path: '/settings/events', element: panel('events') }, { path: '/settings', element: <p>Settings</p> }], { initialEntries: ['/settings/academic-year'] });
const root = createRoot(host); flushSync(() => root.render(<RouterProvider router={router} />));
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
const checks = []; const check = (value, label) => { if (!value) throw Error(label); checks.push(label); };
const click = label => { const button = [...host.querySelectorAll('button')].find(node => node.textContent === label);
  if (!button) throw Error(`Missing ${label}`); flushSync(() => button.click()); };
const input = (selector, value) => { const node = host.querySelector(selector); if (!node) throw Error(`Missing ${selector}`);
  flushSync(() => { const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); }); };
const mode = value => flushSync(() => host.querySelector(`input[value="${value}"]`).click());
const choose = (name, type) => { const node = host.querySelector('input[type="file"]'); const transfer = new DataTransfer();
  const file = new File(['fixture'], name, { type }); transfer.items.add(file);
  Object.defineProperty(node, 'files', { configurable: true, value: transfer.files });
  flushSync(() => node.dispatchEvent(new Event('change', { bubbles: true }))); return file; };
async function run() {
  await settle();
  check(host.querySelector('.import-preview-year')?.textContent.trim() === 'Academic year: 2026/27',
    'holiday preview shows the selected year label without boundaries');
  check(host.textContent.includes('Preview only — not saved') && !host.querySelector('[name="import-destination"]'), 'holiday destination comes from section');
  input('#import-preview-text-holidays', 'INSET Day'); click('Extract preview'); await settle();
  check(host.querySelectorAll('.import-preview-entry').length === 1 && host.textContent.includes('Possible duplicate'), 'holiday suggestions are editable in section');
  input('#import-0-label', 'Corrected INSET Day'); check(host.querySelector('#import-0-label').value === 'Corrected INSET Day', 'preview corrections stay local');
  let prompts = 0; window.confirm = () => { prompts++; return false; }; await router.navigate('/settings/events'); await settle();
  check(router.state.location.pathname === '/settings/academic-year' && prompts === 1, 'preview blocks navigation');
  window.confirm = () => true; click('Discard preview'); await settle(); await router.navigate('/settings/events'); await settle();
  check(host.querySelector('.import-preview-year')?.textContent.trim() === 'Academic year: 2026/27',
    'event preview shows the selected year label without boundaries');
  check(host.textContent.includes('Import events with AI') && !host.querySelector('[name="import-destination"]'), 'event destination comes from section');
  input('#import-preview-text-events', 'Assembly and Trip'); click('Extract preview'); await settle();
  check(host.querySelectorAll('.import-preview-entry').length === 2 && host.textContent.includes('Confirm the ambiguous source date'), 'event preview flags ambiguity');
  check(host.textContent.includes('Possible duplicate') && host.textContent.includes('Choose All day or enter valid paired times'), 'duplicate and missing times visible');
  click('Discard preview'); await settle();
  for (const [kind, name, type] of [['pdf', 'calendar.pdf', 'application/pdf'], ['image', 'calendar.png', 'image/png'],
    ['xlsx', 'calendar.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], ['csv', 'calendar.csv', 'text/csv']]) {
    mode(kind); const file = choose(name, type); click('Extract preview'); await settle();
    check(calls.at(-1).input.file === file && calls.at(-1).input.mode === kind && host.textContent.includes('selected') && !host.textContent.includes(name), `${kind} file is transient`);
    click('Discard preview'); await settle();
  }
  mode('text'); fail = true; input('#import-preview-text-events', 'Retry'); click('Extract preview'); await settle();
  check(host.querySelector('.import-preview-error')?.textContent.includes('Support reference'), 'safe error and support reference visible');
  fail = false; click('Retry extraction'); await settle(); click('Discard preview'); await settle();
  let release; extractionGate = new Promise(resolve => { release = resolve; }); click('Extract preview'); await settle(); const signal = calls.at(-1).signal;
  flushSync(() => changeYear(B)); await settle(); extractionGate = null; release(); await settle();
  check(signal.aborted && !host.querySelector('.import-preview-results'), 'old-year result cannot appear');
  let rejectLate; extractionGate = new Promise((_, reject) => { rejectLate = reject; });
  input('#import-preview-text-events', 'Late failure'); click('Extract preview'); await settle();
  flushSync(() => changeYear(A)); await settle(); extractionGate = null; rejectLate(Error('Stale failure')); await settle();
  check(!host.querySelector('.import-preview-error'), 'old-year failure cannot appear after scope change');
  check(!host.querySelector('button[type="submit"]') && !host.textContent.includes('Save academic year'), 'preview has no write action');
  document.body.dataset.testResult = 'passed'; const report = document.createElement('pre'); report.style.whiteSpace = 'pre-wrap'; report.style.overflowWrap = 'anywhere'; report.textContent = checks.join('\n'); document.body.append(report);
}
run().catch(error => { document.body.dataset.testResult = 'failed'; const pre = document.createElement('pre'); pre.textContent = error.stack; document.body.append(pre); });
