import { AI_LIMITS } from './generationConfig.js';
import { aiError, safeAiError } from './generationErrors.js';

function statusError(status) {
  if (status === 401 || status === 403) return aiError('AI_CREDENTIAL_REJECTED');
  if (status === 429) return aiError('AI_RATE_LIMITED');
  if (status >= 500 || status === 408) return aiError('AI_PROVIDER_UNAVAILABLE');
  if (status >= 300 && status < 400) return aiError('AI_INVALID_RESPONSE');
  return aiError('AI_CONFIGURATION_ERROR');
}

// Called only with adapter-owned endpoints, never arbitrary caller destinations.
export async function requestProviderJson({ endpoint, headers, body, extract, validate, apiKey }, {
  fetchImpl = globalThis.fetch, timeoutMs = AI_LIMITS.timeoutMs,
} = {}) {
  const controller = new AbortController();
  let response, reader, timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(aiError('AI_TIMEOUT')); }, timeoutMs);
  });
  const operation = async () => {
    response = await fetchImpl(endpoint, { method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(body), signal: controller.signal });
    if (controller.signal.aborted) throw aiError('AI_TIMEOUT');
    if (response.redirected) throw aiError('AI_INVALID_RESPONSE');
    if (!response.ok) throw statusError(response.status);
    if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw aiError('AI_INVALID_RESPONSE');
    const advertised = response.headers.get('content-length');
    if (advertised && (!/^\d+$/.test(advertised) || Number(advertised) > AI_LIMITS.responseBytes)) throw aiError('AI_INVALID_RESPONSE');
    if (!response.body) throw aiError('AI_INVALID_RESPONSE');
    reader = response.body.getReader();
    const chunks = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (controller.signal.aborted) throw aiError('AI_TIMEOUT');
      if (done) break;
      size += value.byteLength;
      if (size > AI_LIMITS.responseBytes) throw aiError('AI_INVALID_RESPONSE');
      chunks.push(value);
    }
    let parsed;
    try {
      const envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
      const text = extract(envelope);
      if (typeof text !== 'string' || !text.trim()) throw Error();
      parsed = JSON.parse(text);
      // Even a provider echo of the credential cannot escape as validated data.
      if (!validate(parsed) || JSON.stringify(parsed).includes(JSON.stringify(apiKey).slice(1, -1))) throw Error();
    } catch { throw aiError('AI_INVALID_RESPONSE'); }
    return parsed;
  };
  try {
    return await Promise.race([operation(), deadline]);
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError') throw aiError('AI_TIMEOUT');
    throw safeAiError(error);
  } finally {
    clearTimeout(timer);
    controller.abort();
    // Cancellation must never hold up an error or expose a rejected body error.
    try { void (reader ? reader.cancel() : response?.body?.cancel())?.catch(() => {}); } catch { /* safe cleanup */ }
  }
}
