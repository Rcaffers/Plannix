import assert from 'node:assert/strict';
import test from 'node:test';
import { strFromU8, unzipSync } from 'fflate';
import readExcelFile from 'read-excel-file/node';
import { buildClassMonitorWorkbook, classMonitorFilename, REPORT_COLUMNS } from './classMonitorWorkbook.js';

const rows = [
  { type: 'lesson', date: '2027-03-28', periodOrder: 0, title: '=SUM(1,2)', notes: '@private + long notes\nSecond line' },
  { type: 'closure', date: '2027-03-29', periodOrder: 1, label: 'Training day' },
  { type: 'school-unknown', date: '2027-03-30', visibleStart: '2027-03-30', visibleEnd: '2027-04-02',
    startDate: '2027-03-27', endDate: '2027-04-04', label: 'Spring break' },
  { type: 'holiday', date: '2027-04-03', visibleStart: '2027-04-03', visibleEnd: '2027-04-03',
    startDate: '2027-04-03', endDate: '2027-04-03', label: 'Public day' },
];

test('genuine XLSX preserves report order, literal content, real date cells and information sheet', async () => {
  const workbook = buildClassMonitorWorkbook({ rows, className: '7A', academicYear: '2026/27',
    from: '2027-03-28', to: '2027-04-03', limitations: 'Pattern history is unavailable.' });
  const archive = unzipSync(workbook);
  assert.ok(archive['xl/workbook.xml'] && archive['xl/worksheets/sheet1.xml'] && archive['xl/styles.xml']);
  const sheets = await readExcelFile(Buffer.from(workbook));
  const report = sheets.find(sheet => sheet.sheet === 'Class Monitor').data;
  assert.deepEqual(report[0], REPORT_COLUMNS);
  assert.ok(report[1][0] instanceof Date);
  assert.equal(report[1][0].toISOString().slice(0, 10), '2027-03-28');
  assert.deepEqual(report.slice(1).map(row => row[1]), ['Period 1', 'Period 2', null, null]);
  assert.deepEqual(report.slice(1).map(row => row[5]), [
    'Lesson', 'Lesson not held — Training day', 'School holiday or closure', 'Public holiday',
  ]);
  assert.equal(report[1][3], '=SUM(1,2)');
  assert.equal(report[1][4], '@private + long notes\nSecond line');
  assert.match(report[3][4], /Displayed range: 30\/03\/2027–02\/04\/2027/);
  assert.match(report[3][4], /Original range: 27\/03\/2027–04\/04\/2027/);
  assert.equal(report[4][4], 'End date: 03/04/2027.');
  const info = sheets.find(sheet => sheet.sheet === 'Report information').data;
  assert.deepEqual(info.slice(1, 4), [
    ['Report', 'Class Monitor'], ['Class', '7A'], ['Academic year', '2026/27'],
  ]);
  assert.equal(info[6][1], 'Pattern history is unavailable.');
  const xml = strFromU8(archive['xl/worksheets/sheet1.xml']);
  const styles = strFromU8(archive['xl/styles.xml']);
  assert.match(xml, /<pane ySplit="1" topLeftCell="A2"/);
  assert.match(xml, /<c r="D2" s="0" t="inlineStr"><is><t xml:space="preserve">=SUM/);
  assert.doesNotMatch(xml, /<f(?:\s|>)/);
  assert.match(styles, /formatCode="dd\/mm\/yyyy"/);
  assert.match(styles, /wrapText="1"/);
  assert.match(xml, /<col min="5" max="5" width="64"/);
});

test('filename drops unsafe class characters', () => {
  assert.equal(classMonitorFilename('7A/../<test>', '2026-09-01', '2027-08-31'),
    'class-monitor-7A-test-2026-09-01-to-2027-08-31.xlsx');
});
