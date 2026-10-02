import { Worker } from 'node:worker_threads';

export const IMPORT_TABULAR_BYTES = 2 * 1024 * 1024;
const invalid = () => Object.assign(Error('Invalid tabular document.'), { code: 'IMPORT_TABULAR_INVALID' });

export function extractCsvText(data) {
  if (!Buffer.isBuffer(data) || !data.length || data.length > IMPORT_TABULAR_BYTES) throw invalid();
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { throw invalid(); }
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);
  const rows = []; let row = [], cell = '', quoted = false, closed = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { cell += '"'; index++; }
      else if (character === '"') { quoted = false; closed = true; }
      else cell += character;
    } else if (character === '"' && !cell && !closed) quoted = true;
    else if (character === ',') { row.push(cell); cell = ''; closed = false; }
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index++;
      row.push(cell); rows.push(row); row = []; cell = ''; closed = false;
    } else if (closed || character === '"') throw invalid();
    else cell += character;
    if (Buffer.byteLength(cell, 'utf8') > 2000 || row.length > 30 || rows.length > 500) throw invalid();
  }
  if (quoted) throw invalid();
  if (cell || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length || rows.length > 500 || rows.some(value => value.length > 30)) throw invalid();
  const text = rows.map(value => value.join(' | ')).join('\n');
  if (!text.trim() || Buffer.byteLength(text, 'utf8') > 50_000) throw invalid();
  return text;
}

export function extractXlsxText(data, { signal, timeoutMs = 10_000,
  workerFactory = (url, options) => new Worker(url, options) } = {}) {
  if (!Buffer.isBuffer(data) || data.length < 4 || data.length > IMPORT_TABULAR_BYTES
    || data.subarray(0, 4).toString('hex') !== '504b0304') return Promise.reject(invalid());
  if (signal?.aborted) return Promise.reject(Object.assign(Error(), { code: 'AI_CANCELLED' }));
  return new Promise((resolve, reject) => {
    let worker;
    try { worker = workerFactory(new URL('./importTabularWorker.js', import.meta.url), {
      workerData: Uint8Array.from(data), resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 },
    }); } catch { reject(invalid()); return; }
    let done = false, timer;
    const finish = async (error, text) => {
      if (done) return;
      done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      try { await worker.terminate(); } catch { /* Worker failure is already reported safely. */ }
      if (error) reject(error); else resolve(text);
    };
    const abort = () => { void finish(Object.assign(Error(), { code: 'AI_CANCELLED' })); };
    timer = setTimeout(() => { void finish(invalid()); }, Math.max(1, Math.min(10_000, timeoutMs)));
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', value => { void finish(value?.error || typeof value?.text !== 'string' ? invalid() : null, value?.text); });
    worker.once('error', () => { void finish(invalid()); });
    worker.once('exit', () => { void finish(invalid()); });
    if (signal?.aborted) abort();
  });
}
