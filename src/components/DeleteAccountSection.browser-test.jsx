import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import DeleteAccountSection from './DeleteAccountSection.jsx';
import { deletionCalls } from './DeleteAccountSection.browser-mocks.js';
import '../styles/base.css';
import '../styles/accessibility.css';

window.fetch = () => { throw Error('External networking is blocked'); };
window.deletionEffects = [];
const statusRequests = [];
let statusReads = 0;
let failNextStatus = false;
let accountCurrent = true;
let showSection;
let rerenderParent;

function Harness() {
  const [show, setShow] = useState(true);
  const [, setVersion] = useState(0);
  showSection = setShow;
  rerenderParent = () => setVersion(value => value + 1);
  return <main>{show ? <DeleteAccountSection
    clearAuthenticatedUser={() => window.deletionEffects.push('clear-user')}
    getAccountDeletionSession={(options) => {
      if (options?.verifyLocal !== false) return Promise.resolve(accountCurrent
        ? { serverManaged:true,sessionName:'__Host-plannix-s-7',userId:'synthetic-a',generation:1 }
        : null);
      statusReads++;
      if (failNextStatus) { failNextStatus = false; return Promise.reject(Error('Synthetic status failure')); }
      return new Promise((resolve,reject) => statusRequests.push({ resolve,reject,signal:options.signal }));
    }}
    signOutAfterAccountDeletion={() => window.deletionEffects.push('sign-out')}
    isAccountDeletionSessionCurrent={() => accountCurrent}
  /> : <p id="unmounted">Section unmounted</p>}</main>;
}

createRoot(document.getElementById('root')).render(<StrictMode><Harness /></StrictMode>);
const tick = () => new Promise(resolve => setTimeout(resolve, 25));
const check = (value,message) => { if (!value) throw Error(message); };
const button = label => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === label);
const setPassword = value => {
  const input=document.querySelector('#delete-account-password');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
  input.dispatchEvent(new Event('input',{bubbles:true}));
};
async function startDeletion() {
  button('Delete account').click(); await tick();
  setPassword('synthetic-password'); await tick();
  button('Permanently delete account').click(); await tick();
}
async function mount() { showSection(true); await tick(); }
async function unmount() { showSection(false); await tick(); }

(async () => { try {
  await tick();
  await startDeletion();
  check(statusRequests.length===1 && deletionCalls.length===1,'first deletion reached status verification');
  const first=statusRequests[0];
  await unmount();
  check(first.signal.aborted,'unmount aborted the pending status request');
  first.resolve(null); await tick();
  check(window.deletionEffects.length===0 && document.querySelector('#unmounted'),
    'late success cannot clear, redirect or remount UI');
  check(deletionCalls.length===1,'removal is not repeated after remount');

  accountCurrent=false;
  await mount();
  await startDeletion();
  check(deletionCalls.length===1 && document.body.textContent.includes('session has expired'),
    'remounted editor checks the current session before another deletion');
  await unmount();
  accountCurrent=true;
  await mount();
  await startDeletion();
  const second=statusRequests[1];
  await unmount(); second.reject(Error('Late synthetic failure')); await tick();
  check(second.signal.aborted && window.deletionEffects.length===0,
    'late failure after unmount has no UI or account effects');

  await mount(); failNextStatus=true;
  await startDeletion(); await tick();
  check(button('Retry session check') && deletionCalls.length===3,
    'failed status offers Retry without repeating deletion');
  button('Retry session check').click(); await tick();
  const retry=statusRequests[2];
  await unmount(); retry.resolve(null); await tick();
  check(retry.signal.aborted && window.deletionEffects.length===0
    && deletionCalls.length===3,'late Retry after unmount cannot clear state or resend deletion');

  await mount(); await startDeletion();
  const rerendered=statusRequests[3];
  rerenderParent(); await tick();
  check(statusReads===5 && deletionCalls.length===4 && !rerendered.signal.aborted,
    'ordinary rerender preserves the pending controller');
  rerendered.reject(Error('Synthetic status failure')); await tick();
  check(button('Retry session check'),'same controller retains status-only recovery after rerender');
  await unmount();

  await mount(); await startDeletion();
  const newerAccount=statusRequests[4];
  accountCurrent=false;
  newerAccount.resolve(null); await tick();
  check(window.deletionEffects.every(effect=>!['clear-user','clear-layout','clear-year','sign-out'].includes(effect)),
    'newer-account guard prevents cleanup and redirect');
  await unmount();
  check(deletionCalls.length===5,'no remount or retry repeated an accepted deletion');
  document.body.dataset.testResult='passed';
} catch (error) {
  document.body.dataset.testResult='failed';
  document.body.dataset.testError=error.stack || error.message;
} })();
