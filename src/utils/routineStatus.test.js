import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const paths = ['App', 'pages/Settings', 'pages/OrganisationControls', 'pages/AcademicYear', 'pages/Classes',
  'pages/Profile', 'pages/ResetPassword', 'pages/Contact', 'components/Header', 'components/ProjectCard',
  'components/SchoolHolidayAiImport', 'components/AiProviderCard', 'components/ClassPlacementPalette', 'components/DeleteAccountSection'];
for (const path of paths) test(path + ' uses shared accessible status utility', async () => {
  const source = await readFile('src/' + path + '.jsx', 'utf8');
  assert.doesNotMatch(source, /styles\/accessibility.css/);
  if (path !== 'components/ClassPlacementPalette') assert.match(source, /visually-hidden/);
  for (const match of source.matchAll(/<p([^>]*)role="status"([^>]*)>((?:Loading|Checking)[^<]*)<\/p>/g)) {
    assert.match(match[1] + match[2], /visually-hidden/);
  }
});
test('production imports the shared stylesheet once and isolated fixtures import it themselves', async () => {
  const main = await readFile('src/main.jsx', 'utf8');
  assert.match(main, /import '\.\/styles\/accessibility.css'/);
  for (const fixture of ['components/AiProviderCard.browser-test', 'components/ClassPlacementPalette.browser-test',
    'components/ProjectCard.modal-browser-test', 'components/ProjectCard.responsive-browser-test', 'pages/AcademicYear.ai-browser-test']) {
    assert.match(await readFile(`src/${fixture}.jsx`, 'utf8'), /styles\/accessibility.css/);
  }
});
test('session gate still blocks early content and actionable profile confirmation stays visible', async () => {
  const app = await readFile('src/App.jsx', 'utf8');
  assert.match(app, /if \(state === 'loading'\) \{\s*return <main aria-busy="true">/);
  const profile = await readFile('src/pages/Profile.jsx', 'utf8');
  assert.match(profile, /actionRequired: result.confirmationPending/);
  assert.match(profile, /status.state === 'success' && !status.actionRequired/);
});
test('shared status utility clips without hiding from accessibility tree', async () => {
  const css = await readFile('src/styles/accessibility.css', 'utf8');
  assert.match(css, /position: absolute/);
  assert.match(css, /clip-path: inset\(50%\)/);
  assert.doesNotMatch(css, /display:\s*none|visibility:\s*hidden/);
});
