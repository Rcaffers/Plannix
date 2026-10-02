import { parentPort, workerData } from 'node:worker_threads';
import readExcelFile from 'read-excel-file/node';
import { validateXlsxArchive } from './validateXlsxArchive.js';

function cell(value) {
  if (value == null) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  if (['string', 'number', 'boolean'].includes(typeof value)) return String(value);
  return '';
}

try {
  const safeArchive = await validateXlsxArchive(Buffer.from(workerData));
  const sheets = await readExcelFile(safeArchive);
  if (!Array.isArray(sheets) || sheets.length > 5) throw Error();
  let rows = 0;
  let text = '';
  for (const sheet of sheets) {
    if (!Array.isArray(sheet.data)) throw Error();
    text += `Sheet: ${String(sheet.sheet).slice(0, 80)}\n`;
    for (const row of sheet.data) {
      if (!Array.isArray(row) || row.length > 30 || ++rows > 500) throw Error();
      const line = row.map(cell).join(' | ');
      if (Buffer.byteLength(line, 'utf8') > 2000) throw Error();
      text += `${line}\n`;
      if (Buffer.byteLength(text, 'utf8') > 50_000) throw Error();
    }
  }
  if (!text.trim() || !rows) throw Error();
  parentPort.postMessage({ text });
} catch {
  parentPort.postMessage({ error: true });
}
