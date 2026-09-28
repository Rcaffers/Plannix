// Local-only rollback regression. Never inherit a remote Docker destination.
import { readFile } from 'node:fs/promises';
import { statSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const failure = () => new Error('Local migration verification failed. No remote execution is permitted.');
export function verifyLocalDocker({ project, workdir, env = process.env, run = spawnSync, stat = statSync, realpath = realpathSync } = {}) {
  function socket(endpoint) {
    if (typeof endpoint !== 'string' || !/^unix:\/\/\/[^\0]+$/.test(endpoint)) throw failure();
    try { if (!stat(endpoint.slice(7)).isSocket()) throw failure(); } catch { throw failure(); }
    return endpoint;
  }
  function json(args, commandEnv = env) {
    const result = run('docker', args, { encoding: 'utf8', env: commandEnv, timeout: 15000 });
    if (result.error || result.status !== 0) throw failure();
    try { const rows = JSON.parse(result.stdout); if (!Array.isArray(rows) || rows.length !== 1) throw failure(); return rows[0]; } catch { throw failure(); }
  }
  if (!/^[A-Za-z0-9_-]+$/.test(project || '')) throw failure();
  if (env.DOCKER_HOST !== undefined) socket(env.DOCKER_HOST);
  const context = json(['context', 'inspect']);
  const contextHost = socket(context?.Endpoints?.docker?.Host);
  const endpoint = env.DOCKER_CONTEXT ? contextHost : env.DOCKER_HOST || contextHost;
  const localEnv = { ...env }; delete localEnv.DOCKER_HOST; delete localEnv.DOCKER_CONTEXT;
  const prefix = ['--host', endpoint];
  const container = json([...prefix, 'inspect', `supabase_db_${project}`], localEnv);
  const labels = container?.Config?.Labels;
  if (container?.State?.Running !== true || !/^[a-f0-9]{64}$/.test(container?.Id || '')
    || labels?.['com.supabase.cli.project'] !== project || labels?.['com.docker.compose.project'] !== project) throw failure();
  try { if (realpath(labels['com.supabase.cli.workdir']) !== realpath(workdir)) throw failure(); } catch { throw failure(); }
  return { prefix, containerId: container.Id, env: localEnv };
}

export function validateTap(result) {
  if (result.error || result.status !== 0 || typeof result.stdout !== 'string') throw new Error('Migration TAP result is incomplete or failed.');
  const lines = result.stdout.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  if (lines.length !== 18 || lines.at(-1) !== '1..17') throw new Error('Migration TAP result is incomplete or failed.');
  for (let i = 0; i < 17; i++) {
    const match = /^ok ([1-9][0-9]*) - .+$/.exec(lines[i]);
    if (!match || Number(match[1]) !== i + 1 || /#\s*(?:SKIP|TODO)/i.test(lines[i])) throw new Error('Migration TAP result is incomplete or failed.');
  }
}

export async function runMigrationTest(options = {}) {
  const workdir = fileURLToPath(new URL('..', import.meta.url));
  const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  const projects = [...config.matchAll(/^project_id\s*=\s*"([A-Za-z0-9_-]+)"\s*$/gm)];
  if (projects.length !== 1) throw failure();
  const run = options.run || spawnSync;
  const verified = verifyLocalDocker({ ...options, project: projects[0][1], workdir, run });
const suite = await readFile(new URL('../supabase/tests/academic_year_save.test.sql', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260927090000_add_holiday_categories.sql', import.meta.url), 'utf8');
const marker = 'select extensions.is(\n  pg_temp.save_academic_year_as(';
if (!suite.includes(marker)) throw Error('Academic-year fixture boundary not found');
const sql = suite.slice(0, suite.indexOf(marker)).replace('begin;', "begin; set local statement_timeout = '30s'; set local lock_timeout = '5s';") + `
create temporary table before_category_backfill as select to_jsonb(h) - 'holiday_type' as row from public.plannix_holidays h;
alter table public.plannix_holidays drop column holiday_type;
` + migration + `
select extensions.results_eq($$select to_jsonb(h) - 'holiday_type' from public.plannix_holidays h order by id$$, $$select row from before_category_backfill order by row->>'id'$$, 'actual migration preserves every pre-category holiday field');
select extensions.ok((select bool_and(holiday_type='school') from public.plannix_holidays), 'actual migration backfills all pre-category holidays as school');
select * from extensions.finish();
rollback;
`;

  const result = run('docker', [...verified.prefix, 'exec', '-i', verified.containerId, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'], { input: sql, encoding: 'utf8', env: verified.env, timeout: 60000 });
  validateTap(result);
  return 'Local migration regression: 17 assertions passed; transaction rolled back.';
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(await runMigrationTest()); }
  catch { console.error('Local migration regression failed verification or TAP validation.'); process.exitCode = 1; }
}
