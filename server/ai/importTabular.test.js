import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import { extractCsvText, extractXlsxText } from './importTabular.js';
import { validateXlsxArchive, XLSX_ARCHIVE_LIMITS } from './validateXlsxArchive.js';

const spreadsheet = () => Buffer.from(zipSync({
  '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
  '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
  'xl/workbook.xml': strToU8('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Calendar" sheetId="1" r:id="rId1"/></sheets></workbook>'),
  'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
  'xl/worksheets/sheet1.xml': strToU8('<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>INSET Day</t></is></c><c r="B1" t="inlineStr"><is><t>1 September 2026</t></is></c></row></sheetData></worksheet>'),
}));

test('CSV decoding is bounded, handles quoted cells and rejects malformed data', () => {
  assert.equal(extractCsvText(Buffer.from('Title,Date\n"INSET, Day",01/09/2026')), 'Title | Date\nINSET, Day | 01/09/2026');
  assert.throws(() => extractCsvText(Buffer.from('"Unclosed')), /Invalid tabular/);
  assert.throws(() => extractCsvText(Buffer.from([0xff])), /Invalid tabular/);
  assert.throws(() => extractCsvText(Buffer.alloc(2 * 1024 * 1024 + 1)), /Invalid tabular/);
});
test('XLSX is parsed in a bounded worker and malformed archives fail closed', async () => {
  assert.match(await extractXlsxText(spreadsheet()), /INSET Day \| 1 September 2026/);
  await assert.rejects(extractXlsxText(Buffer.from('not an xlsx')), /Invalid tabular/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(extractXlsxText(spreadsheet(), { signal: controller.signal }), error => error.code === 'AI_CANCELLED');
});

test('ZIP expansion checks entry count, expanded bytes and compression ratio before parser handoff', async () => {
  const safe = await validateXlsxArchive(spreadsheet());
  assert.ok(safe.length > 0 && safe.length < XLSX_ARCHIVE_LIMITS.totalBytes + 20_000);
  assert.equal(safe.readUInt16LE(8), 0, 'parser receives stored, non-expanding entries');
  const compressed = Buffer.from(zipSync({ 'xl/worksheets/sheet1.xml': Buffer.alloc(300_000, 65) }));
  await assert.rejects(validateXlsxArchive(compressed), /Invalid XLSX archive/);
  const oversized = Buffer.from(zipSync({ 'xl/worksheets/sheet1.xml': Buffer.alloc(XLSX_ARCHIVE_LIMITS.entryBytes + 1, 65) }));
  await assert.rejects(validateXlsxArchive(oversized), /Invalid XLSX archive/);
  const many = Object.fromEntries(Array.from({ length: XLSX_ARCHIVE_LIMITS.entries + 1 }, (_, index) => [`xl/sheet${index}.xml`, strToU8('x')]));
  await assert.rejects(validateXlsxArchive(Buffer.from(zipSync(many))), /Invalid XLSX archive/);
  const pattern = randomBytes(16_000), entries = Object.create(null);
  for (let index = 0; index < 9; index++) entries[`xl/sheet${index}.xml`] = Buffer.concat(Array(60).fill(pattern));
  const totalBomb = Buffer.from(zipSync(entries));
  assert.ok(totalBomb.length < 2 * 1024 * 1024, 'synthetic archive stays within upload limit');
  await assert.rejects(validateXlsxArchive(totalBomb), /Invalid XLSX archive/);
});

test('ZIP validation rejects misleading metadata, encryption, unsupported methods and damaged archives', async () => {
  const central = data => data.indexOf(Buffer.from('504b0102', 'hex'));
  const misleading = spreadsheet(), offset = central(misleading);
  misleading.writeUInt32LE(1, offset + 24); // Claimed size is smaller than actual streamed output.
  await assert.rejects(validateXlsxArchive(misleading), /Invalid XLSX archive/);
  const encrypted = spreadsheet(); encrypted.writeUInt16LE(encrypted.readUInt16LE(6) | 1, 6);
  encrypted.writeUInt16LE(encrypted.readUInt16LE(central(encrypted) + 8) | 1, central(encrypted) + 8);
  await assert.rejects(validateXlsxArchive(encrypted), /Invalid XLSX archive/);
  const method = spreadsheet(); method.writeUInt16LE(12, 8); method.writeUInt16LE(12, central(method) + 10);
  await assert.rejects(validateXlsxArchive(method), /Invalid XLSX archive/);
  await assert.rejects(validateXlsxArchive(spreadsheet().subarray(0, -3)), /Invalid XLSX archive/);
});

test('cancellation and timeout wait for worker termination before settling', async () => {
  class PausedWorker extends EventEmitter {
    calls = 0;
    terminate() { this.calls++; return new Promise(resolve => { this.release = resolve; }); }
  }
  for (const reason of ['timeout', 'abort']) {
    const worker = new PausedWorker(), controller = new AbortController();
    const pending = extractXlsxText(spreadsheet(), { signal: controller.signal, timeoutMs: reason === 'timeout' ? 1 : 10_000,
      workerFactory: () => worker });
    if (reason === 'abort') controller.abort();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(worker.calls, 1);
    let settled = false;
    void pending.finally(() => { settled = true; }).catch(() => {});
    await Promise.resolve();
    assert.equal(settled, false, 'operation remains pending until termination completes');
    worker.release(1);
    await assert.rejects(pending, error => reason === 'abort' ? error.code === 'AI_CANCELLED' : error.code === 'IMPORT_TABULAR_INVALID');
    assert.equal(settled, true);
  }
});
