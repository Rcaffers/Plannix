import { useEffect, useId, useRef, useState } from 'react';
import { AI_PROVIDERS, MAX_AI_KEY_LENGTH } from '../../shared/aiProviders.js';
import { aiConnectionApi } from '../utils/aiConnectionApi.js';
import { safeRequestReference } from '../utils/requestReference.js';
import { beginSetupGuidanceSave, finishSetupGuidanceSave } from '../utils/setupGuidance.js';
import './AiProviderCard.css';

const GUIDES = {
  openai: {
    article: 'an', name: 'OpenAI',
    steps: [
      <>Create or sign in to an <a href="https://platform.openai.com/" target="_blank" rel="noopener noreferrer">OpenAI API platform account</a>.</>,
      <>Open <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">API keys</a>, create a key and copy it.</>,
      <>Check <a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noopener noreferrer">API billing</a> and the <a href="https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform" target="_blank" rel="noopener noreferrer">billing guide</a>. Paid API use needs an API payment method or available API credits. ChatGPT billing is separate; an eligible subscription may offer claimable API credits.</>,
    ],
  },
  anthropic: {
    article: 'an', name: 'Anthropic',
    steps: [
      <>Create or sign in to a <a href="https://platform.claude.com/" target="_blank" rel="noopener noreferrer">Claude Console account</a>.</>,
      <>Open <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener noreferrer">API keys</a>, create a key scoped to a workspace and copy it when shown. Plannix does not ask for a separate workspace ID.</>,
      <>Check <a href="https://platform.claude.com/settings/billing" target="_blank" rel="noopener noreferrer">Console billing</a> and the <a href="https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-claude-api-usage" target="_blank" rel="noopener noreferrer">API billing guide</a>. API use generally needs prepaid credits or an invoicing arrangement. A Claude chat plan does not itself provide an API key; eligible plans may offer separate API credits.</>,
    ],
  },
  google_gemini: {
    article: 'a', name: 'Google Gemini',
    steps: [
      <>Sign in to <a href="https://aistudio.google.com/api-keys" target="_blank" rel="noopener noreferrer">Google AI Studio</a> with a Google account and choose a project.</>,
      <>Copy an existing Gemini API key or create a new key on the <a href="https://aistudio.google.com/api-keys" target="_blank" rel="noopener noreferrer">API keys page</a>.</>,
      <>Check the project's <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer">Gemini API billing tier</a>. Free access is limited by model and quota; the model Plannix uses may need paid access. Paid access requires project billing and may require prepaid credits. A consumer Gemini subscription does not set up API billing for this key.</>,
    ],
  },
};

export default function AiProviderCard({ api = aiConnectionApi, userId = null }) {
  const [connection, setConnection] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('connect');
  const [provider, setProvider] = useState('openai');
  const [apiKey, setApiKey] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [reference, setReference] = useState('');
  const pending = useRef(false);
  const generation = useRef(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpTrigger = useRef(null);
  const helpClose = useRef(null);
  const restoreHelpFocus = useRef(false);
  const helpTitleId = useId();
  const helpDescriptionId = useId();
  const guide = GUIDES[mode === 'connected' && connection ? connection.provider : provider];

  useEffect(() => {
    if (!helpOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    helpClose.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; };
  }, [helpOpen]);

  useEffect(() => {
    if (!helpOpen && restoreHelpFocus.current) {
      restoreHelpFocus.current = false;
      helpTrigger.current?.focus();
    }
  }, [helpOpen]);

  function closeHelp() {
    restoreHelpFocus.current = true;
    setHelpOpen(false);
  }

  function helpKeyDown(event) {
    if (event.key === 'Escape') { event.preventDefault(); closeHelp(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...event.currentTarget.querySelectorAll('a[href], button:not([disabled])')];
    if (!focusable.length) { event.preventDefault(); return; }
    if (event.shiftKey && document.activeElement === focusable[0]) {
      event.preventDefault(); focusable.at(-1).focus();
    } else if (!event.shiftKey && document.activeElement === focusable.at(-1)) {
      event.preventDefault(); focusable[0].focus();
    }
  }

  const helpLink = <button ref={helpTrigger} type="button" className="ai-key-help-link"
    onClick={() => setHelpOpen(true)}>How to get {guide.article} {guide.name} API key</button>;

  async function load() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setReference(''); setApiKey('');
    const expected = ++generation.current;
    try {
      const result = await api.load();
      if (expected !== generation.current) return;
      setConnection(result); setMode(result ? 'connected' : 'connect'); setLoaded(true);
    } catch (failure) {
      if (expected !== generation.current) return;
      setError('Could not load your AI connection. Please try again.'); setReference(safeRequestReference(failure));
    } finally { if (expected === generation.current) { pending.current = false; setBusy(false); } }
  }
  useEffect(() => {
    void load();
    return () => { generation.current++; pending.current = false; };
  }, [api]);

  function edit(nextMode) {
    setApiKey(''); setError(''); setReference(''); setMessage('');
    setProvider(nextMode === 'replace' ? connection.provider : AI_PROVIDERS.find(p => p.id !== connection.provider).id);
    setMode(nextMode);
  }
  async function submit(event, disconnect = false) {
    event?.preventDefault();
    if (pending.current || !loaded) return;
    pending.current = true;
    const expected = generation.current;
    setError(''); setReference(''); setMessage('');
    try {
      if (disconnect && !window.confirm('Disconnect your AI provider?')) return;
      if (mode === 'switch' && !window.confirm('Switch AI provider? Your existing connection will be replaced only if this succeeds.')) return;
      setBusy(true);
      const guidanceSave = disconnect ? null : beginSetupGuidanceSave(userId, 'ai');
      const result = disconnect ? await api.disconnect()
        : await (connection ? api.replace : api.connect)({ provider, apiKey });
      if (expected !== generation.current) return;
      setConnection(result); setMode(result ? 'connected' : 'connect');
      if (result) finishSetupGuidanceSave(guidanceSave);
      setMessage(disconnect ? 'AI provider disconnected.' : 'AI provider connection saved.');
    } catch (failure) {
      if (expected !== generation.current) return;
      // A component boundary must not trust exception text, even from an API mock.
      setError('Could not confirm the change to your AI connection. Reload to check its status before trying again.');
      setReference(safeRequestReference(failure));
    } finally {
      if (expected === generation.current) { setApiKey(''); pending.current = false; setBusy(false); }
    }
  }
  return <section className="profile-card" aria-labelledby="ai-provider-title" aria-busy={busy}>
    <div><p className="profile-kicker">Personal connection</p><h2 id="ai-provider-title" className="settings-section-title">AI provider</h2>
      <p className="settings-hint">Use your own provider API key. Usage and charges belong to your provider account. Only one provider can be connected at a time.</p>
      <p className="settings-hint">Your API key is stored securely. Plannix only sends requests to your selected provider when you use an AI feature, such as holiday extraction. Saving a key does not verify it.</p></div>
    {connection ? <p className="profile-detail-value">{connection.active ? 'Connected' : 'Inactive'} · {connection.providerLabel} · Key ending in ••••{connection.lastFour}</p> : null}
    {loaded && mode === 'connected' ? helpLink : null}
    {loaded && mode === 'connected' ? <div className="settings-actions">
      <button className="settings-reset" type="button" disabled={busy} onClick={() => edit('replace')}>Replace API key</button>
      <button className="settings-reset" type="button" disabled={busy} onClick={() => edit('switch')}>Switch provider</button>
      <button className="settings-reset" type="button" disabled={busy} onClick={event => submit(event, true)}>Disconnect</button>
    </div> : null}
    {loaded && mode !== 'connected' ? <form className="profile-form profile-password-form" onSubmit={submit}>
      <label className="settings-field"><span>Provider</span><select aria-label="Provider" value={provider} disabled={busy || mode === 'replace'} onChange={event => { setApiKey(''); setProvider(event.target.value); setError(''); setReference(''); setMessage(''); }}>
        {AI_PROVIDERS.filter(p => mode !== 'switch' || p.id !== connection.provider).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select></label>
      {helpLink}
      <label className="settings-field"><span>API key</span><input aria-label="API key" type="password" value={apiKey} autoComplete="new-password" spellCheck={false}
        maxLength={MAX_AI_KEY_LENGTH} disabled={busy} onChange={event => setApiKey(event.target.value)} /></label>
      <div className="settings-actions"><button type="submit" className="settings-save" disabled={busy}>{mode === 'connect' ? 'Connect provider' : mode === 'replace' ? 'Replace API key' : 'Switch provider'}</button>
        {connection ? <button type="button" className="settings-reset" disabled={busy} onClick={() => { setApiKey(''); setMode('connected'); setError(''); }}>Cancel</button> : null}
      </div>
    </form> : null}
    <p className="visually-hidden" role="status">{busy ? (loaded ? 'Saving connection…' : 'Loading connection…') : message}</p>
    {error ? <div><p className="profile-error" role="alert">{error}</p>{reference ? <p>Support reference: {reference}</p> : null}
      <button className="settings-reset" type="button" disabled={busy} onClick={load}>Reload connection</button></div> : null}
    {helpOpen ? <div className="ai-key-help-backdrop" role="presentation" onClick={event => {
      if (event.target === event.currentTarget) closeHelp();
    }}>
      <div className="ai-key-help-dialog" role="dialog" aria-modal="true"
        aria-labelledby={helpTitleId} aria-describedby={helpDescriptionId} onKeyDown={helpKeyDown}>
        <div className="ai-key-help-toolbar"><h3 id={helpTitleId}>How to get {guide.article} {guide.name} API key</h3>
          <button ref={helpClose} type="button" className="ai-key-help-dismiss" aria-label="Close API key guide" onClick={closeHelp}>×</button></div>
        <div className="ai-key-help-body"><p id={helpDescriptionId}>Use a key for the selected provider. Provider API access and consumer chat subscriptions have separate settings.</p>
          <ol>{guide.steps.map((step, index) => <li key={index}>{step}</li>)}
            <li>Return to Plannix, paste the key into the API key field and choose {mode === 'connect' ? 'Connect provider' : mode === 'replace' ? 'Replace API key' : 'Switch provider'} to save it. Saving does not verify the key; try an AI feature to confirm it works.</li></ol>
          <p>To change a saved key, choose Replace API key. To use another provider, choose Switch provider. To remove the connection, choose Disconnect; a cancelled or failed switch keeps the existing connection.</p>
          <p>Official guide: <a href={guide.name === 'OpenAI' ? 'https://developers.openai.com/api/docs/quickstart' : guide.name === 'Anthropic' ? 'https://platform.claude.com/docs/en/get-api-key' : 'https://ai.google.dev/gemini-api/docs/api-key'} target="_blank" rel="noopener noreferrer">{guide.name} API key instructions</a>.</p>
        </div>
        <button type="button" className="settings-save ai-key-help-done" onClick={closeHelp}>Close guide</button>
      </div>
    </div> : null}
  </section>;
}
