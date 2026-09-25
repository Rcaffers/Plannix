import { useEffect, useRef, useState } from 'react';
import { AI_PROVIDERS, MAX_AI_KEY_LENGTH } from '../../shared/aiProviders.js';
import { aiConnectionApi } from '../utils/aiConnectionApi.js';
import { safeRequestReference } from '../utils/requestReference.js';

export default function AiProviderCard({ api = aiConnectionApi }) {
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
      const result = disconnect ? await api.disconnect()
        : await (connection ? api.replace : api.connect)({ provider, apiKey });
      if (expected !== generation.current) return;
      setConnection(result); setMode(result ? 'connected' : 'connect');
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
      <p className="settings-hint">This securely stores your connection; it does not test the key or send AI requests yet.</p></div>
    {connection ? <p className="profile-detail-value">{connection.active ? 'Connected' : 'Inactive'} · {connection.providerLabel} · Key ending in ••••{connection.lastFour}</p> : null}
    {loaded && mode === 'connected' ? <div className="settings-actions">
      <button className="settings-reset" type="button" disabled={busy} onClick={() => edit('replace')}>Replace API key</button>
      <button className="settings-reset" type="button" disabled={busy} onClick={() => edit('switch')}>Switch provider</button>
      <button className="settings-reset" type="button" disabled={busy} onClick={event => submit(event, true)}>Disconnect</button>
    </div> : null}
    {loaded && mode !== 'connected' ? <form className="profile-form profile-password-form" onSubmit={submit}>
      <label className="settings-field"><span>Provider</span><select aria-label="Provider" value={provider} disabled={busy || mode === 'replace'} onChange={event => setProvider(event.target.value)}>
        {AI_PROVIDERS.filter(p => mode !== 'switch' || p.id !== connection.provider).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select></label>
      <label className="settings-field"><span>API key</span><input aria-label="API key" type="password" value={apiKey} autoComplete="new-password" spellCheck={false}
        maxLength={MAX_AI_KEY_LENGTH} disabled={busy} onChange={event => setApiKey(event.target.value)} /></label>
      <div className="settings-actions"><button type="submit" className="settings-save" disabled={busy}>{mode === 'connect' ? 'Connect provider' : mode === 'replace' ? 'Replace API key' : 'Switch provider'}</button>
        {connection ? <button type="button" className="settings-reset" disabled={busy} onClick={() => { setApiKey(''); setMode('connected'); setError(''); }}>Cancel</button> : null}
      </div>
    </form> : null}
    <p role="status" aria-live="polite">{busy ? (loaded ? 'Saving connection…' : 'Loading connection…') : message}</p>
    {error ? <div><p className="profile-error" role="alert">{error}</p>{reference ? <p>Support reference: {reference}</p> : null}
      <button className="settings-reset" type="button" disabled={busy} onClick={load}>Reload connection</button></div> : null}
  </section>;
}
