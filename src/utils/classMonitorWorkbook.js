import { strToU8, zipSync } from 'fflate';

export const REPORT_COLUMNS = ['Date', 'Period', 'Class', 'Lesson title', 'Notes', 'Entry type'];

const xml = value => String(value ?? '').replace(/[\u0000-\u0008\u000b-\u000c\u000e-\u001f\ufffe\uffff]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const column = index => String.fromCharCode(65 + index);
const dateSerial = ymd => Math.round((Date.parse(`${ymd}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86400000);
const displayDate = ymd => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

function cell(value, address, isDate = false, isHeader = false) {
  if (isDate) return `<c r="${address}" s="1"><v>${dateSerial(value)}</v></c>`;
  // Inline strings are literal text, including values beginning with =, +, - or @.
  return `<c r="${address}" s="${isHeader ? 2 : 0}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

function sheet(rows, widths, freeze = true) {
  const columns = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('');
  const data = rows.map((row, index) => `<row r="${index + 1}">${row.map((value, position) =>
    cell(value.value, `${column(position)}${index + 1}`, value.date, index === 0)).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<sheetViews><sheetView workbookViewId="0">${freeze ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : ''}</sheetView></sheetViews>`
    + `<sheetFormatPr defaultRowHeight="15"/><cols>${columns}</cols><sheetData>${data}</sheetData></worksheet>`;
}

const textCell = value => ({ value });
const dateCell = value => ({ value, date: true });

export function classMonitorExportRows(rows, className) {
  return rows.map(row => {
    const range = row.type === 'holiday' || row.type === 'school-unknown';
    const date = range ? row.visibleStart : row.date;
    const period = range ? '' : `Period ${row.periodOrder + 1}`;
    const title = row.type === 'lesson' ? row.title || '' : row.label;
    const notes = range
      ? row.visibleStart !== row.startDate || row.visibleEnd !== row.endDate
        ? `Displayed range: ${displayDate(row.visibleStart)}–${displayDate(row.visibleEnd)}. Original range: ${displayDate(row.startDate)}–${displayDate(row.endDate)}.`
        : `End date: ${displayDate(row.endDate)}.`
      : row.type === 'lesson' ? row.notes || '' : '';
    const entryType = row.type === 'lesson' ? 'Lesson'
      : row.type === 'closure' ? `Lesson not held — ${row.label}`
        : row.type === 'school-unknown' ? 'School holiday or closure' : 'Public holiday';
    return [dateCell(date), textCell(period), textCell(className), textCell(title), textCell(notes), textCell(entryType)];
  });
}

export function buildClassMonitorWorkbook({ rows, className, academicYear, from, to, limitations }) {
  const report = [REPORT_COLUMNS.map(textCell), ...classMonitorExportRows(rows, className)];
  const information = [
    [textCell('Report information'), textCell('Value')],
    [textCell('Report'), textCell('Class Monitor')],
    [textCell('Class'), textCell(className)],
    [textCell('Academic year'), textCell(academicYear)],
    [textCell('From'), dateCell(from)],
    [textCell('To'), dateCell(to)],
    [textCell('Limitations'), textCell(limitations)],
  ];
  const files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Class Monitor" sheetId="1" r:id="rId1"/><sheet name="Report information" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs></styleSheet>',
    'xl/worksheets/sheet1.xml': sheet(report, [17, 16, 18, 44, 64, 34]),
    'xl/worksheets/sheet2.xml': sheet(information, [25, 90]),
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, content]) => [name, strToU8(content)])), { level: 6 });
}

export function classMonitorFilename(className, from, to) {
  const safeClass = String(className).normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'class';
  return `class-monitor-${safeClass}-${from}-to-${to}.xlsx`;
}
