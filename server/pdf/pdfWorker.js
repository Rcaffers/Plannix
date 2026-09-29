import { parentPort, workerData } from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import dgram from 'node:dgram';
import dns from 'node:dns';
import fs from 'node:fs';
import childProcess from 'node:child_process';
import { PDF_LIMITS } from './pdfConfig.js';
import { PDF_ERROR_CODES, pdfError } from './pdfErrors.js';
import { normalizePdfText } from './pdfText.js';

// Defence in depth for this fixed text-only worker, not an OS security sandbox.
let forbiddenActivity = false;
const denied = () => { forbiddenActivity = true; throw pdfError('PDF_PROCESSING_FAILED'); };
globalThis.fetch = denied;
globalThis.WebSocket = denied;
for (const [object, names] of [
  [net, ['connect', 'createConnection', 'createServer']],
  [net.Socket.prototype, ['connect']], [http, ['request', 'get']], [https, ['request', 'get']],
  [tls, ['connect']], [dgram, ['createSocket']], [dns, ['lookup', 'resolve']],
  [childProcess, ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork']],
  [fs, ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'createWriteStream', 'rename', 'renameSync', 'unlink', 'unlinkSync', 'mkdir', 'mkdirSync', 'rm', 'rmSync', 'truncate', 'truncateSync', 'symlink', 'symlinkSync', 'link', 'linkSync', 'copyFile', 'copyFileSync']],
  [fs.promises, ['writeFile', 'appendFile', 'rename', 'unlink', 'mkdir', 'rm', 'truncate', 'symlink', 'link', 'copyFile']],
]) for (const name of names) object[name] = denied;
syncBuiltinESMExports();
let repairedCrossReferences = false;
// PDF.js can otherwise repair a broken xref even with stopAtErrors. Observe its
// pinned recovery diagnostic in memory and reject; never forward diagnostics.
for (const key of ['log', 'info', 'warn', 'error', 'debug', 'trace']) console[key] = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('Indexing all PDF objects')) repairedCrossReferences = true;
};

// Keep a referenced timer while awaiting cleanup: a pending promise alone does
// not keep a worker alive. Observe rejections even after the timeout wins.
async function boundedCleanup(operation) {
  let timer;
  const observed = Promise.resolve().then(operation).catch(() => {});
  try {
    await Promise.race([observed, new Promise(resolve => { timer = setTimeout(resolve, PDF_LIMITS.cleanupMs); })]);
  } finally { clearTimeout(timer); }
}

let task;
let asynchronousFailure = false;
let fatalResolve;
const fatal = new Promise(resolve => { fatalResolve = resolve; });
const failClosed = () => {
  asynchronousFailure = true;
  fatalResolve({ error: 'PDF_PROCESSING_FAILED' });
};
// Parser-internal detached failures must not become uncaught Node diagnostics.
// They abort this operation; they are never logged or allowed to become success.
process.on('unhandledRejection', failClosed);
process.on('uncaughtException', failClosed);
// Keep unresolved parser promises alive until the parent enforces its deadline.
// This local watchdog is a second bound, not an extension of the parent limit.
const keepAlive = setTimeout(() => fatalResolve({ error: 'PDF_TIMEOUT' }), PDF_LIMITS.deadlineMs);

async function parse() {
  let response;
  try {
    // Mozilla's Node-compatible legacy build provides required JS polyfills.
    // No rendering occurs; resource factories below deny external resources.
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { WorkerMessageHandler } = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    fs.open = fs.openSync = fs.promises.open = denied;
    syncBuiltinESMExports();
    globalThis.pdfjsWorker = { WorkerMessageHandler };
    globalThis.eval = denied;
    globalThis.Function = denied;
    class NoResources { fetch() { return Promise.reject(pdfError('PDF_PROCESSING_FAILED')); } create() { denied(); } }
    task = getDocument({ data: workerData.data, verbosity: 1, stopAtErrors: true,
      useWorkerFetch: false, useWasm: false, enableXfa: false, disableFontFace: true,
      useSystemFonts: false, isOffscreenCanvasSupported: false, isImageDecoderSupported: false,
      disableRange: true, disableStream: true, disableAutoFetch: true,
      CanvasFactory: NoResources, BinaryDataFactory: NoResources, maxImageSize: 0,
    });
    const document = await task.promise;
    if (repairedCrossReferences) throw pdfError('PDF_INVALID');
    if (await document.getPermissions() !== null) throw pdfError('PDF_ENCRYPTED');
    if (!Number.isInteger(document.numPages) || document.numPages < 1) throw pdfError('PDF_INVALID');
    if (document.numPages > PDF_LIMITS.pages) throw pdfError('PDF_TOO_MANY_PAGES');
    const pages = [];
    let count = 0, rawBytes = 0;
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const reader = page.streamTextContent({ disableNormalization: true }).getReader();
      let text = '';
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          for (const item of chunk.value.items) {
            if (typeof item.str !== 'string') continue;
            rawBytes += Buffer.byteLength(item.str);
            if (++count > PDF_LIMITS.textItems || rawBytes > PDF_LIMITS.rawTextBytes) throw pdfError('PDF_TEXT_TOO_LARGE');
            text += item.str + (item.hasEOL ? '\n' : ' ');
          }
        }
      } finally { await boundedCleanup(() => reader.cancel()); reader.releaseLock(); page.cleanup(); }
      pages.push(normalizePdfText(text));
      // Enforce cumulative, normalized UTF-8 bytes without silently truncating.
      normalizePdfText(pages.join('\n\n'));
    }
    const text = normalizePdfText(pages.join('\n\n'));
    if (!/[\p{L}\p{N}]/u.test(text)) throw pdfError('PDF_NO_TEXT');
    if (forbiddenActivity) throw pdfError('PDF_PROCESSING_FAILED');
    response = { text, pageCount: document.numPages };
  } catch (error) {
    response = { error: error?.name === 'PasswordException' ? 'PDF_ENCRYPTED'
      : error?.name === 'InvalidPDFException' ? 'PDF_INVALID'
        : PDF_ERROR_CODES.includes(error?.code) ? error.code : 'PDF_PROCESSING_FAILED' };
  }
  return response;
}

const parsing = parse();
let response = await Promise.race([parsing, fatal]);
if (task) await boundedCleanup(() => task.destroy());
if (workerData.data.byteLength) workerData.data.fill(0);
if (asynchronousFailure) response = { error: 'PDF_PROCESSING_FAILED' };
parentPort.postMessage(response);
parentPort.close();
clearTimeout(keepAlive);
// Fault listeners remain scoped to this disposable worker until native exit:
// PDF.js may reject a detached promise after its destroy promise has settled.
