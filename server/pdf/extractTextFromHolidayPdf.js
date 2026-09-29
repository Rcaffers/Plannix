import { Worker } from 'node:worker_threads';
import { PDF_LIMITS } from './pdfConfig.js';
import { pdfError, PDF_ERROR_CODES } from './pdfErrors.js';
import { normalizePdfText } from './pdfText.js';

const WORKER_URL = new URL('./pdfWorker.js', import.meta.url);

// Injection is for orchestration tests only; callers cannot provide a path or limits.
export function createPdfExtractor({ WorkerClass = Worker } = {}) {
  return async function extractTextFromHolidayPdf(input) {
    let data, signal;
    try {
      if (!input || Object.keys(input).some(key => !['data', 'signal'].includes(key))) throw 0;
      ({ data, signal } = input);
      if (signal !== undefined && !(signal instanceof AbortSignal)) throw 0;
      if (!(data instanceof Uint8Array) || !(data.buffer instanceof ArrayBuffer) || !data.byteLength) throw 0;
    } catch { throw pdfError('PDF_INVALID'); }
    if (signal?.aborted) throw pdfError('PDF_CANCELLED');
    if (data.byteLength > PDF_LIMITS.fileBytes) throw pdfError('PDF_TOO_LARGE');
    const header = Buffer.from(data.buffer, data.byteOffset, Math.min(data.byteLength, 1024)).toString('latin1');
    if (!/%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(header)) throw pdfError('PDF_INVALID');
    const tail = Buffer.from(data.buffer, data.byteOffset + Math.max(0, data.byteLength - 1024), Math.min(data.byteLength, 1024)).toString('latin1');
    if (!/startxref\s+\d+\s+%%EOF\s*$/.test(tail)) throw pdfError('PDF_INVALID');
    const copy = new Uint8Array(data);
    let worker;
    try {
      worker = new WorkerClass(WORKER_URL, {
        workerData: { data: copy }, transferList: [copy.buffer], env: {}, execArgv: [],
        stdout: true, stderr: true,
        resourceLimits: { maxOldGenerationSizeMb: PDF_LIMITS.heapMb, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
      });
    } catch { if (copy.byteLength) copy.fill(0); throw pdfError('PDF_PROCESSING_FAILED'); }
    return new Promise((resolve, reject) => {
      let settled = false, received = false, result;
      const discard = () => {};
      worker.stdout?.on('data', discard);
      worker.stderr?.on('data', discard);
      const finish = async (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        worker.removeListener('message', message);
        worker.removeListener('exit', exit);
        // Keep the safe error listener until termination has completed.
        try { await worker.terminate(); } catch { code = code || 'PDF_PROCESSING_FAILED'; }
        worker.removeListener('error', error);
        worker.stdout?.removeListener('data', discard);
        worker.stderr?.removeListener('data', discard);
        if (signal?.aborted) code = 'PDF_CANCELLED';
        if (code) reject(pdfError(code)); else resolve(result);
      };
      const abort = () => { void finish('PDF_CANCELLED'); };
      const error = () => { void finish('PDF_PROCESSING_FAILED'); };
      const message = (value) => {
        if (settled) return;
        if (received) return void finish('PDF_PROCESSING_FAILED');
        received = true;
        try {
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw 0;
          if (Object.keys(value).length === 1 && PDF_ERROR_CODES.includes(value.error)) {
            result = { error: value.error }; return;
          }
          if (Object.keys(value).sort().join(',') !== 'pageCount,text' || typeof value.text !== 'string'
            || !Number.isInteger(value.pageCount) || value.pageCount < 1 || value.pageCount > PDF_LIMITS.pages
            || normalizePdfText(value.text) !== value.text || !/[\p{L}\p{N}]/u.test(value.text)) throw 0;
          result = { text: value.text, pageCount: value.pageCount };
        } catch { void finish('PDF_PROCESSING_FAILED'); }
      };
      const exit = (code) => void finish(code !== 0 || !received ? 'PDF_PROCESSING_FAILED' : result?.error);
      const timer = setTimeout(() => void finish('PDF_TIMEOUT'), PDF_LIMITS.deadlineMs);
      worker.on('message', message);
      worker.on('error', error);
      worker.on('exit', exit);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  };
}
export const extractTextFromHolidayPdf = createPdfExtractor();
