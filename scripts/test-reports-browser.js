import assert from 'node:assert/strict';
import { build } from 'vite';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const directory = await mkdtemp(path.join(tmpdir(), 'plannix-reports-browser-'));
let chrome, socket;
try {
  await build({ configFile: false, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' }, esbuild: { jsx: 'automatic' },
    plugins: [{ name: 'reports-mocks', enforce: 'pre', resolveId(source, importer) {
      if (importer?.endsWith('/Reports.jsx') && [
        '../context/AcademicYearContext.jsx', '../context/ClassContext.jsx', '../context/TimetableLayoutContext.jsx',
        '../context/TimetableSessionContext.jsx', '../utils/timetableSessionApi.js',
      ].includes(source)) return path.resolve('src/pages/Reports.browser-test.jsx');
    } }], build: { outDir: directory, emptyOutDir: false, lib: {
      entry: 'src/pages/Reports.browser-test.jsx', formats: ['iife'], name: 'ReportsTest', fileName: () => 'test.js', cssFileName: 'test',
    } } });
  await writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="test.css"></head><body><script>window.fetch=()=>{throw Error("Network disabled in Reports fixture")}</script><script src="test.js"></script></body></html>');
  chrome = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless', '--allow-file-access-from-files', '--disable-background-networking', '--disable-component-update',
      '--no-first-run', '--disable-gpu', '--remote-debugging-port=0', '--window-size=1400,1000',
      `--user-data-dir=${directory}/profile`, `file://${directory}/index.html`], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsURL = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Chrome startup timed out')), 20000);
    chrome.on('error', reject);
    chrome.stderr.on('data', chunk => { const match = String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  socket = new WebSocket(wsURL); await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let serial = 0; const pending = new Map();
  socket.onmessage = event => { const message = JSON.parse(event.data), item = pending.get(message.id);
    if (item) { clearTimeout(item.timer); pending.delete(message.id); message.error ? item.reject(Error(message.error.message)) : item.resolve(message.result); } };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out`)); }, 15000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetInfos } = await send('Target.getTargets');
  const target = targetInfos.find(item => item.type === 'page' && item.url.startsWith('file:'));
  assert.ok(target, 'Reports fixture page exists');
  const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const result = await send('Runtime.evaluate', { expression: 'new Promise((resolve,reject)=>{let n=0;const id=setInterval(()=>{if(document.body.dataset.testResult){clearInterval(id);resolve([document.body.dataset.testResult,document.querySelector("pre")?.textContent])}else if(++n>300){clearInterval(id);reject(Error("Reports fixture timed out"))}},50)})', awaitPromise: true, returnByValue: true }, sessionId);
  assert.equal(result.result.value[0], 'passed', result.result.value[1]);
  console.log(result.result.value[1]);
  const measurements = [];
  for (const [width, height] of [[320, 900], [375, 900], [390, 900], [430, 900],
    [667, 375], [700, 900], [767, 900], [844, 390], [932, 430], [768, 900], [820, 900], [1024, 900], [1366, 900]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
    const measurement = await send('Runtime.evaluate', { expression: '({viewport:innerWidth,scroll:document.documentElement.scrollWidth,card:(()=>{const r=document.querySelector(".reports-card").getBoundingClientRect();return {left:r.left,right:r.right}})(),past:(()=>{const e=document.querySelector(".reports-lesson--past");if(!e)return null;const r=e.getBoundingClientRect(),s=getComputedStyle(e),outer=getComputedStyle(e.closest(".reports-entry"));return {left:r.left,right:r.right,border:s.borderLeftWidth,background:s.backgroundColor,outerBackground:outer.backgroundColor,outerBorder:outer.borderLeftWidth}})(),yellow:(()=>{const nodes=[...document.querySelectorAll(".reports-holiday,.reports-entry--closure")],card=document.querySelector(".reports-card").getBoundingClientRect();return {count:nodes.length,fit:nodes.every(e=>{const r=e.getBoundingClientRect();return r.left>=card.left-1&&r.right<=card.right+1}),style:nodes.every(e=>{const s=getComputedStyle(e);return s.backgroundColor==="rgba(250, 240, 220, 0.55)"&&s.borderTopStyle==="solid"&&s.borderTopColor==="rgba(200, 160, 90, 0.45)"&&s.borderTopLeftRadius==="12px"})}})()})', returnByValue: true }, sessionId);
    const value = measurement.result.value;
    measurements.push(value);
    const filters = (await send('Runtime.evaluate', { expression: `(() => {
      const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
      const from = document.querySelector('#report-from'), to = document.querySelector('#report-to');
      const card = document.querySelector('.reports-card'), cardRect = card.getBoundingClientRect(), style = getComputedStyle(card);
      const cardContent = {
        left: cardRect.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
        right: cardRect.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
      };
      return { class: rect('#report-class'), from: rect('#report-from'), to: rect('#report-to'), cardContent,
        fromLabel: rect('label[for="report-from"]'), toLabel: rect('label[for="report-to"]'),
        content: rect('.reports-filters'), fromClipped: from.scrollWidth > from.clientWidth + 1,
        toClipped: to.scrollWidth > to.clientWidth + 1,
        fromLabelled: from.labels?.[0]?.textContent === 'From', toLabelled: to.labels?.[0]?.textContent === 'To' };
    })()`, returnByValue: true }, sessionId)).result.value;
    const phone = width <= 767 || (width <= 950 && height <= 450 && width > height);
    assert.ok(filters.fromLabelled && filters.toLabelled
      && filters.class.height >= 44 && filters.from.height >= 44 && filters.to.height >= 44
      && !filters.fromClipped && !filters.toClipped
      && filters.content.left >= filters.cardContent.left - 1 && filters.content.right <= filters.cardContent.right + 1
      && filters.class.left >= filters.cardContent.left - 1 && filters.class.right <= filters.cardContent.right + 1
      && filters.from.left >= filters.cardContent.left - 1 && filters.from.right <= filters.cardContent.right + 1
      && filters.to.left >= filters.cardContent.left - 1 && filters.to.right <= filters.cardContent.right + 1
      && (phone
        ? filters.class.left <= filters.content.left + 1 && filters.class.right >= filters.content.right - 1
          && filters.class.bottom < filters.from.top && filters.from.bottom < filters.to.top
          && filters.fromLabel.right <= filters.from.left && filters.toLabel.right <= filters.to.left
          && Math.abs((filters.fromLabel.top + filters.fromLabel.bottom) / 2 - (filters.from.top + filters.from.bottom) / 2) <= 2
          && Math.abs((filters.toLabel.top + filters.toLabel.bottom) / 2 - (filters.to.top + filters.to.bottom) / 2) <= 2
          && Math.abs(filters.from.right - filters.class.right) <= 1
          && Math.abs(filters.to.right - filters.class.right) <= 1
          && filters.from.width >= 156 && filters.to.width >= 156
        : Math.abs(filters.class.top - filters.from.top) <= 1 && Math.abs(filters.from.top - filters.to.top) <= 1
          && filters.class.right < filters.from.left && filters.from.right < filters.to.left),
    `${width}×${height}px Reports date filters are clipped or misaligned: ${JSON.stringify(filters)}`);
    value.filters = filters;
    const lessons = (await send('Runtime.evaluate', { expression: `(() => {
      const tiles = [...document.querySelectorAll('.reports-lesson')];
      const inspect = title => {
        const tile = tiles.find(node => node.querySelector('.session-lesson-title')?.textContent === title);
        if (!tile) return null;
        const name = tile.querySelector('.session-class'), heading = tile.querySelector('.session-lesson-title');
        const notes = tile.querySelector('.session-lesson-notes');
        const tileRect = tile.getBoundingClientRect(), nameRect = name.getBoundingClientRect();
        const headingRect = heading.getBoundingClientRect();
        return { display: getComputedStyle(tile).display, separator: getComputedStyle(heading, '::before').content,
          nameTop: nameRect.top, titleTop: headingRect.top, titleLines: heading.getClientRects().length,
          notesTop: notes?.getBoundingClientRect().top,
          fits: headingRect.left >= tileRect.left - 1 && headingRect.right <= tileRect.right + 1
            && tile.scrollWidth <= tile.clientWidth + 1 };
      };
      return { short: inspect('Dated title'), long: inspect('A detailed lesson title covering several concepts and an exceptionallylongunbrokentopicnameforwrapping') };
    })()`, returnByValue: true }, sessionId)).result.value;
    assert.ok(lessons.short && lessons.long && lessons.short.fits && lessons.long.fits
      && (width <= 600
        ? lessons.short.display === 'grid' && lessons.short.titleTop > lessons.short.nameTop
          && lessons.short.separator === 'none' && lessons.long.titleTop > lessons.long.nameTop
        : lessons.short.display === 'block' && Math.abs(lessons.short.titleTop - lessons.short.nameTop) <= 2
          && lessons.short.separator.includes('–') && lessons.short.notesTop > lessons.short.titleTop
          && lessons.long.titleLines > 1),
    `${width}px Reports lesson tile layout failed: ${JSON.stringify(lessons)}`);
    value.lessons = lessons;
    assert.ok(value.scroll <= width + 1 && value.card.left >= -1 && value.card.right <= width + 1
      && value.past?.left >= value.card.left - 1 && value.past?.right <= value.card.right + 1
      && value.past?.border === '1px' && value.past?.background === 'rgb(244, 214, 202)'
      && value.past?.outerBackground === 'rgba(255, 255, 255, 0.7)' && value.past?.outerBorder === '1px'
      && value.yellow?.count >= 4 && value.yellow.fit && value.yellow.style,
      `${width}px Reports card overflows: ${JSON.stringify(value)}`);
  }
  console.log(JSON.stringify(measurements.map(({ viewport, scroll, filters, lessons }) => ({
    viewport, scroll, cardContentRight: filters.cardContent.right,
    classRight: filters.class.right, fromRight: filters.from.right, toRight: filters.to.right,
    fromWidth: filters.from.width, toWidth: filters.to.width,
    shortTile: lessons.short.display, longTitleFragments: lessons.long.titleLines,
  }))));
  const printLayout = await send('Runtime.evaluate', { expression: `(() => {
    const host = document.querySelector('.reports-page').parentElement;
    host.classList.add('page-shell');
    const nav = document.createElement('header'); nav.className = 'site-header'; nav.textContent = 'Navigation excluded from print'; host.append(nav);
    const footer = document.createElement('footer'); footer.className = 'site-footer'; footer.textContent = 'Footer excluded from print'; host.append(footer);
    const results = document.querySelector('.reports-results');
    const template = results.querySelector('.reports-entry:has(.reports-lesson)');
    for (let index = 0; index < 40; index += 1) {
      const copy = template.cloneNode(true);
      copy.querySelector('.session-lesson-title').textContent = 'Print continuation entry ' + index;
      if (index === 39) copy.querySelector('.session-lesson-notes').textContent = 'Long printed note '.repeat(1200) + ' END-OF-LONG-NOTE';
      results.append(copy);
    }
    return true;
  })()`, returnByValue: true }, sessionId);
  assert.equal(printLayout.result.value, true);
  await send('Emulation.setEmulatedMedia', { media: 'print' }, sessionId);
  const printStyles = (await send('Runtime.evaluate', { expression: `(() => ({
    nav: getComputedStyle(document.querySelector('.site-header')).display,
    footer: getComputedStyle(document.querySelector('.site-footer')).display,
    filters: getComputedStyle(document.querySelector('.reports-filters')).display,
    actions: getComputedStyle(document.querySelector('.reports-actions')).display,
    heading: getComputedStyle(document.querySelector('.reports-print-header')).display,
    results: getComputedStyle(document.querySelector('.reports-results')).display
  }))()`, returnByValue: true }, sessionId)).result.value;
  assert.deepEqual(printStyles, { nav: 'none', footer: 'none', filters: 'none', actions: 'none', heading: 'block', results: 'block' });
  const printed = await send('Page.printToPDF', { printBackground: false, preferCSSPageSize: true }, sessionId);
  const pdfBytes = Buffer.from(printed.data, 'base64');
  await writeFile(path.join(directory, 'report.pdf'), pdfBytes);
  const pdfTask = getDocument({ data: new Uint8Array(pdfBytes), useSystemFonts: true });
  const pdf = await pdfTask.promise;
  assert.ok(pdf.numPages > 1, 'long report prints across multiple A4 pages');
  const firstPage = await pdf.getPage(1);
  assert.ok(Math.abs(firstPage.view[2] - 595) < 2 && Math.abs(firstPage.view[3] - 842) < 2,
    `Class Monitor print page must be A4: ${firstPage.view}`);
  const printedText = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    printedText.push((await page.getTextContent()).items.map(item => item.str).join(' '));
  }
  await pdfTask.destroy();
  const allPrintedText = printedText.join(' ');
  assert.match(allPrintedText, /Class Monitor/);
  assert.match(allPrintedText, /7A/);
  assert.match(allPrintedText, /2026\/27/);
  assert.match(allPrintedText, /earlier versions of the layout and pattern are not archived/);
  assert.match(allPrintedText, /END-OF-LONG-NOTE/);
  assert.doesNotMatch(allPrintedText, /Navigation excluded from print|Footer excluded from print|Export Excel/);
  console.log(`${printedText.length} A4 print pages inspected; long-note ending and print-only content passed.`);
  await send('Emulation.setEmulatedMedia', { media: 'screen' }, sessionId);
  const unmounted = await send('Runtime.evaluate', { expression: 'window.reportsPendingUnmountForTest()', awaitPromise: true, returnByValue: true }, sessionId);
  assert.equal(unmounted.result.value, true, 'Unmount aborts pending report reads and ignores late results');
  console.log('Pending report unmount cancellation passed.');
} finally {
  socket?.close();
  if (chrome && chrome.exitCode === null) { chrome.kill(); await new Promise(resolve => { chrome.once('exit', resolve); setTimeout(resolve, 3000); }); }
  await rm(directory, { recursive: true, force: true });
}
