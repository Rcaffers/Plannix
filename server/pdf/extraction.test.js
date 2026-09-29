import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import dgram from 'node:dgram';
import { syncBuiltinESMExports } from 'node:module';
import { syntheticPdf } from './pdfFixtures.js';

// Installed BEFORE importing any PDF module; no native fetch can be captured.
const restore = [];
let networkCalls = 0;
for (const [object, keys] of [[globalThis, ['fetch']], [net, ['connect', 'createConnection']],
  [net.Socket.prototype, ['connect']], [http, ['request', 'get']], [https, ['request', 'get']],
  [tls, ['connect']], [dgram, ['createSocket']]]) {
  for (const key of keys) {
    const original = object[key];
    object[key] = () => { networkCalls++; throw new Error('PDF test network disabled'); };
    restore.push(() => { object[key] = original; });
  }
}
syncBuiltinESMExports();
after(() => { assert.equal(networkCalls, 0); restore.forEach(fn => fn()); syncBuiltinESMExports(); });
const { extractTextFromHolidayPdf: extract } = await import('./extractTextFromHolidayPdf.js');
const { normalizePdfText } = await import('./pdfText.js');
const { PDF_LIMITS } = await import('./pdfConfig.js');
const rejects = (data, code) => assert.rejects(extract({ data }), error => error.code === code && !error.cause);

test('real parser: one page returns only bounded plain text and page count', async () => {
  assert.deepEqual(await extract({ data: syntheticPdf() }), { text: 'School holiday', pageCount: 1 });
});
test('real parser: page order and Unicode', async () => {
  assert.deepEqual(await extract({ data: syntheticPdf(['First', 'Café']) }), { text: 'First\n\nCafé', pageCount: 2 });
});
test('normalization preserves lines, NFC; removes nulls and rejects controls', () => {
  assert.equal(normalizePdfText('  Cafe\u0301\0\t  holiday\r\n\r\n\r\n End '), 'Café holiday\n\nEnd');
  for (const value of ['x\u202ey', 'x\u0001y']) assert.throws(() => normalizePdfText(value), { code: 'PDF_INVALID' });
});
test('real parser: repeated whitespace', async () => {
  assert.equal((await extract({ data: syntheticPdf(['  School    holiday  ']) })).text, 'School holiday');
});
test('rejects empty/wrong type/header/truncation safely', async () => {
  for (const data of [Buffer.alloc(0), 'file.pdf', {}, new Uint16Array(2), Buffer.from('not pdf'), syntheticPdf().subarray(0, 90), Buffer.concat([Buffer.alloc(1024, 32), syntheticPdf()])]) await rejects(data, 'PDF_INVALID');
});
test('real parser: zero pages and malformed content', async () => {
  await rejects(syntheticPdf([]), 'PDF_INVALID');
  await rejects(Buffer.from('%PDF-1.7\ninvalid\nstartxref\n0\n%%EOF\n'), 'PDF_INVALID');
});
test('real parser: encrypted and no-text PDFs', async () => {
  await rejects(syntheticPdf(['Secret fixture'], { encrypted: true }), 'PDF_ENCRYPTED');
  await rejects(syntheticPdf(['Secret fixture'], { encrypted: true, emptyPassword: true }), 'PDF_ENCRYPTED');
  await rejects(syntheticPdf([''], { imageOnly: true }), 'PDF_NO_TEXT');
  await rejects(syntheticPdf(['']), 'PDF_NO_TEXT');
});
test('real parser: page limits', async () => {
  assert.equal((await extract({ data: syntheticPdf(Array(50).fill('Holiday')) })).pageCount, 50);
  await rejects(syntheticPdf(Array(51).fill('Holiday')), 'PDF_TOO_MANY_PAGES');
});
test('real parser: 50,000 bytes accepted, 50,001 rejected, multibyte measured as bytes', async () => {
  assert.equal(Buffer.byteLength((await extract({ data: syntheticPdf(['a'.repeat(50000)]) })).text), 50000);
  await rejects(syntheticPdf(['a'.repeat(50001)]), 'PDF_TEXT_TOO_LARGE');
  assert.equal(Buffer.byteLength((await extract({ data: syntheticPdf(['é'.repeat(25000)]) })).text), 50000);
  await rejects(syntheticPdf(['é'.repeat(25001)]), 'PDF_TEXT_TOO_LARGE');
});
test('real parser: maximum file bytes accepted, excess rejected before parsing', async () => {
  const base = syntheticPdf();
  const data = syntheticPdf(undefined, { padding: PDF_LIMITS.fileBytes - base.length - 18 });
  // xref offsets grow with padding; add trailing whitespace to reach exact boundary.
  const exact = Buffer.concat([data, Buffer.alloc(PDF_LIMITS.fileBytes - data.length, 32)]);
  assert.equal(exact.length, PDF_LIMITS.fileBytes);
  assert.equal((await extract({ data: exact })).text, 'School holiday');
  await rejects(Buffer.concat([exact, Buffer.from(' ')]), 'PDF_TOO_LARGE');
});

test('real parser: broken cross references cannot be silently repaired', async () => {
  const broken = Buffer.from(syntheticPdf().toString('latin1').replace(/startxref\s+\d+/, 'startxref\n1'), 'latin1');
  await rejects(broken, 'PDF_INVALID');
});
