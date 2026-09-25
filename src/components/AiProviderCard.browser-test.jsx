import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MemoryRouter } from 'react-router-dom';
import Profile from '../pages/Profile.jsx';
import AiProviderCard from './AiProviderCard.jsx';
import { createAiConnectionApi } from '../utils/aiConnectionApi.js';
import { AI_PROVIDERS } from '../../shared/aiProviders.js';

const credential = 'fixture-browser-key-1234';
const calls = [];
let stored = null, fail = false, gate = null;
export const aiConnectionApi = createAiConnectionApi({ getSession: async () => ({ access_token: 'fixture-token' }), fetchImpl: async (url, init) => {
  calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null });
  if (gate) await gate;
  if (fail) return { ok: false, status: 500, headers: new Headers(), json: async () => ({ message: credential }) };
  if (['POST','PUT'].includes(init.method)) { const body = JSON.parse(init.body); stored = { provider: body.provider, lastFour: body.apiKey.slice(-4), active: true }; }
  if (init.method === 'DELETE') stored = null;
  return { ok: true, headers: new Headers(), json: async () => ({ connection: stored }) };
} });
const host = document.createElement('div'); document.body.append(host);
const root = createRoot(host);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function settle() { await tick(); await tick(); }
const check = (condition, message) => { if (!condition) throw Error(message); results.push(message); };
const results = [];
const button = label => [...host.querySelectorAll('button')].find(el => el.textContent === label);
const click = label => flushSync(() => button(label).click());
function input(selector, value) { const el=host.querySelector(selector); flushSync(() => {
  Object.getOwnPropertyDescriptor(el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set.call(el,value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}); }
function noCredential() {
  check(!host.innerHTML.includes(credential) && !host.textContent.includes(credential), 'Full credential never appears in resulting rendered output');
  check(!host.querySelector('input[aria-label="API key"]')?.value, 'Key input cleared after request');
}
async function mount(connection = null) {
  stored=connection; fail=false; gate=null; calls.length=0;
  flushSync(() => root.render(<AiProviderCard key={Math.random()} />)); await settle();
}
async function run() {
  for (const provider of AI_PROVIDERS) {
    await mount();
    check([...host.querySelectorAll('option')].map(el=>el.value).join(',') === AI_PROVIDERS.map(p=>p.id).join(','), 'Disconnected selector lists exactly three providers');
    check(host.querySelector('input[aria-label="API key"]').type === 'password', 'Credential uses password input');
    input('select',provider.id); input('input[aria-label="API key"]',credential);
    let release; gate=new Promise(resolve=>{release=resolve;});
    flushSync(() => { host.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); host.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); });
    await tick(); check(calls.filter(c=>c.method==='POST').length===1, 'Duplicate connection submissions prevented');
    release(); await settle(); gate=null;
    check(host.textContent.includes(provider.label) && host.textContent.includes('••••1234'), `${provider.label}: connected label and last four only`);
    noCredential();
    click('Replace API key'); input('input[aria-label="API key"]',credential); click('Replace API key'); await settle();
    check(calls.at(-1).method==='PUT' && calls.at(-1).body.provider===provider.id, 'Same-provider key replacement uses PUT'); noCredential();
    for (const destination of AI_PROVIDERS.filter(p=>p.id!==provider.id)) {
      await mount({ provider:provider.id,lastFour:'1234',active:true });
      click('Switch provider'); input('select',destination.id); input('input[aria-label="API key"]',credential);
      let confirmations=0; window.confirm=()=>{confirmations++;return false;}; click('Switch provider'); await settle();
      check(confirmations===1 && calls.length===1 && stored.provider===provider.id, 'Switch cancellation keeps original connection without request'); noCredential();
      input('input[aria-label="API key"]',credential); window.confirm=()=>{confirmations++;return true;}; fail=true;
      click('Switch provider'); await settle();
      check(stored.provider===provider.id && host.textContent.includes(provider.label) && host.querySelector('[role="alert"]'), 'Failed switch keeps original metadata and shows safe error'); noCredential();
      fail=false; input('input[aria-label="API key"]',credential); click('Switch provider'); await settle();
      check(calls.at(-1).method==='PUT' && calls.at(-1).body.provider===destination.id && host.textContent.includes(destination.label), `${provider.id} -> ${destination.id}: atomic switch uses PUT`); noCredential();
    }
    window.confirm=()=>false; const before=calls.length; click('Disconnect'); await settle(); check(calls.length===before && stored!==null,'Disconnect cancellation makes no request');
    window.confirm=()=>true; click('Disconnect'); await settle();
    check(calls.at(-1).method==='DELETE' && stored===null && button('Connect provider'), 'Confirmed disconnect returns to disconnected state'); noCredential();
  }
  await mount(); input('input[aria-label="API key"]',credential); fail=true; click('Connect provider'); await settle(); noCredential();
  check(Boolean(host.querySelector('[role="alert"]')), 'Failed connection is accessible and safe');
  fail=false; stored=null;
  flushSync(() => root.render(<MemoryRouter><Profile user={{id:'fixture-user',firstName:'Test',lastName:'User',email:'test@example.test'}} memberships={[]} /></MemoryRouter>)); await settle();
  const sections=[...host.querySelectorAll('section')];
  const ai=sections.findIndex(el=>el.querySelector('#ai-provider-title'));
  const password=sections.findIndex(el=>el.textContent.includes('Change password'));
  const memberships=sections.findIndex(el=>el.querySelector('#membership-title'));
  check(password < ai && ai < memberships && ai>=0, 'Actual Profile places AI card after password and before memberships');
  noCredential();
}
const originalConfirm=window.confirm;
run().then(()=>{document.body.dataset.testResult='passed';},error=>{document.body.dataset.testResult='failed';results.push(error.stack);}).finally(()=>{
 window.confirm=originalConfirm; const report=document.createElement('pre');report.textContent=JSON.stringify(results,null,2);document.body.append(report);
});
