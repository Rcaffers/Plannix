// Read-only parity check against the verified local Supabase instance.
// Usage: node scripts/test-personal-event-unicode-parity.js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeEventText } from '../shared/personalEvent.js';
import { verifyLocalDocker } from './test-academic-year-migration.js';

const workdir = fileURLToPath(new URL('..', import.meta.url));
const [config, migration] = await Promise.all([
  readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260930120000_add_personal_events.sql', import.meta.url), 'utf8'),
]);
const projects = [...config.matchAll(/^project_id\s*=\s*"([A-Za-z0-9_-]+)"\s*$/gm)];
if (projects.length !== 1) throw new Error('A unique local Supabase project is required.');
const verified = verifyLocalDocker({ project: projects[0][1], workdir });

function localSql(sql) {
  const result = spawnSync('docker', [...verified.prefix, 'exec', '-i', verified.containerId,
    'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'],
  { input: sql, encoding: 'utf8', env: verified.env, timeout: 20000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('Local Unicode parity SQL failed.');
  return result.stdout.trim();
}
const blocks = migration.match(/if raw ~ U&'([^']+)'\s+or raw ~ U&'([^']+)'/);
if (!blocks) throw new Error('The migration Unicode format ranges were not found.');
const listed = new Set(), boundaries = new Set();
for (const block of blocks.slice(1)) {
  const escape = /\\(?:\+([0-9A-F]{6})|([0-9A-F]{4}))(?:-\\(?:\+([0-9A-F]{6})|([0-9A-F]{4})))?/g;
  for (const match of block.matchAll(escape)) {
    const start = Number.parseInt(match[1] || match[2], 16);
    const end = Number.parseInt(match[3] || match[4] || match[1] || match[2], 16);
    if (end < start) throw new Error('Invalid migration Unicode range.');
    for (let cp = start; cp <= end; cp++) listed.add(cp);
    for (const cp of [start - 1, start, end, end + 1]) {
      if (cp > 0 && cp <= 0x10ffff) boundaries.add(cp);
    }
  }
}
const controls = [];
const formats = [];
for (let cp = 0; cp <= 0x10ffff; cp++) {
  const character = String.fromCodePoint(cp);
  if (/\p{Cc}/u.test(character)) controls.push(cp);
  if (/\p{Cf}/u.test(character)) formats.push(cp);
}
// PostgreSQL text cannot represent U+0000; it is rejected before normalization.
const samples = [...new Set([...controls, ...formats, ...boundaries,
  0x2065, 0x10cbd, 0x10ccd, 0x110bd, 0x110cd, 0x1f600, 0x6f22])].sort((a, b) => a - b);
assert.deepEqual([...listed].filter(cp => !/\p{Cf}/u.test(String.fromCodePoint(cp))), [],
  'SQL must not blacklist ordinary or unassigned code points');
assert.deepEqual(formats.filter(cp => !listed.has(cp)), [],
  'SQL must list every Node 24 Unicode format character');
assert.equal(process.versions.unicode, '16.0', 'Update the reviewed SQL Cf policy for a new runtime Unicode version');

const sql = "begin; set local statement_timeout='15s';"
  + "create function pg_temp.event_accepts(cp integer, multiline boolean) returns boolean "
  + "language plpgsql set search_path='' as $$begin "
  + "perform private.plannix_normalize_event_text('A'||pg_catalog.chr(cp)||'B',200,multiline);"
  + "return true; exception when others then return false; end;$$;"
  + 'select cp,pg_temp.event_accepts(cp,false),pg_temp.event_accepts(cp,true) '
  + 'from pg_catalog.unnest(array[' + samples.join(',') + ']::integer[]) cp order by cp;rollback;';
const lines = localSql(sql).split(/\r?\n/).filter(Boolean);
assert.equal(lines.length, samples.length, 'The database must return one result per tested code point');
for (const line of lines) {
  const [number, single, multiline] = line.split('|');
  const cp = Number(number), character = String.fromCodePoint(cp);
  for (const [mode, actual] of [[false, single], [true, multiline]]) {
    let expected = true;
    try { normalizeEventText('A' + character + 'B', 200, { multiline: mode, required: true }); }
    catch { expected = false; }
    assert.equal(actual === 't', expected,
      'SQL and JavaScript disagree for U+' + cp.toString(16).toUpperCase() + (mode ? ' notes' : ' title/location'));
  }
}

const examples = [
  ['  Café\u0301   Day  ', false],
  ['  漢字   Привет  ', false],
  ['  مرحبا   שלום  ', false],
  ['  😀   Gathering  ', false],
  ['  e\u0301  ', false],
  ['\u00a0Space\u2003between\u3000words\u00a0', false],
  ['  Line one\r\nLine two\tmore  ', true],
  ['\n  Line one\nLine two  \n', true],
];
for (const [value, multiline] of examples) {
  const hex = Buffer.from(value, 'utf8').toString('hex');
  const output = localSql("select pg_catalog.encode(pg_catalog.convert_to("
    + "private.plannix_normalize_event_text(pg_catalog.convert_from(pg_catalog.decode('"
    + hex + "','hex'),'UTF8'),200," + (multiline ? 'true' : 'false')
    + "),'UTF8'),'hex')");
  assert.equal(Buffer.from(output, 'hex').toString('utf8'),
    normalizeEventText(value, 200, { multiline, required: true }));
}
console.log('Local Unicode parity: ' + samples.length + ' code points and '
  + examples.length + ' normalized text examples passed (Cc=' + controls.length
  + ', Cf=' + formats.length + ', Unicode ' + process.versions.unicode + ').');
