import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const backupSource = path.join(sourceDirectory, 'backup-supabase.sh');
const verifySource = path.join(sourceDirectory, 'verify-backup.sh');
const systemPath = '/usr/bin:/bin:/usr/sbin:/sbin';

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
  });
}

function writeExecutable(filename, contents) {
  writeFileSync(filename, contents, { mode: 0o755 });
  chmodSync(filename, 0o755);
}

function createFixture({ cli = true, age = true } = {}) {
  const root = mkdtempSync('/private/tmp/plannix-backup-test.');
  mkdirSync(path.join(root, 'scripts'));
  copyFileSync(backupSource, path.join(root, 'scripts', 'backup-supabase.sh'));
  copyFileSync(verifySource, path.join(root, 'scripts', 'verify-backup.sh'));
  chmodSync(path.join(root, 'scripts', 'backup-supabase.sh'), 0o755);
  chmodSync(path.join(root, 'scripts', 'verify-backup.sh'), 0o755);
  mkdirSync(path.join(root, 'supabase', 'migrations'), { recursive: true });
  writeFileSync(
    path.join(root, 'supabase', 'migrations', '20260101000000_fixture.sql'),
    'select 1;\n',
  );
  mkdirSync(path.join(root, 'node_modules', '.bin'), { recursive: true });
  if (cli) writeExecutable(path.join(root, 'node_modules', '.bin', 'supabase'), '#!/bin/sh\nexit 0\n');

  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Backup Test'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'backup-test@example.invalid'], { cwd: root });
  execFileSync('git', ['add', 'scripts', 'supabase'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'fixture'], { cwd: root });

  const mockBin = path.join(root, 'mock-bin');
  mkdirSync(mockBin);
  writeExecutable(path.join(mockBin, 'npm'), `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$MOCK_COMMAND_LOG"
if [ "\${MOCK_NPM_MODE:-complete}" = fail ]; then
  echo 'SENSITIVE_NPM_FAILURE' >&2
  exit 1
fi
case "$*" in
  *' --version')
    echo '2.115.0'
    exit 0
    ;;
  *' migration list --linked')
    echo 'LOCAL | REMOTE | TIME'
    echo '20260101000000 | 20260101000000 | fixture'
    exit 0
    ;;
esac
output=''
previous=''
for argument in "$@"; do
  if [ "$previous" = '--file' ]; then output=$argument; break; fi
  previous=$argument
done
[ -n "$output" ] || exit 2
if [ "\${MOCK_NPM_MODE:-complete}" = empty ]; then
  : > "$output"
  exit 0
fi
case "$(basename "$output")" in
  roles.sql)
    printf '%s\\n' 'CREATE ROLE plannix_fixture;' > "$output"
    ;;
  schema.sql)
    if [ "\${MOCK_NPM_MODE:-complete}" = loose-schema ]; then
      printf '%s\\n' \\
        'COMMENT ON SCHEMA public IS '\''not structural evidence'\'';' \\
        'CREATE TABLE IF NOT EXISTS "private"."plannix_personal_organisations" (user_id uuid);' \\
        > "$output"
    else
      printf '%s\\n' \\
        'CREATE TABLE IF NOT EXISTS "public"."plannix_users" (id uuid);' \\
        'CREATE TABLE IF NOT EXISTS "private"."plannix_personal_organisations" (user_id uuid);' \\
        > "$output"
    fi
    ;;
  data.sql)
    printf '%s\\n' \\
      'COPY public.plannix_users (id) FROM stdin;' \\
      'SECRET_SQL_ROW_DO_NOT_PRINT' \\
      '\\.' \\
      'COPY auth.users (id) FROM stdin;' \\
      '\\.' \\
      > "$output"
    if [ "\${MOCK_NPM_MODE:-complete}" != incomplete ]; then
      printf '%s\\n' \\
        'COPY private.plannix_personal_organisations (user_id) FROM stdin;' \\
        '\\.' >> "$output"
    fi
    ;;
  migration-history-schema.sql)
    printf '%s\\n' 'CREATE TABLE IF NOT EXISTS "supabase_migrations"."schema_migrations" (version text);' > "$output"
    ;;
  migration-history-data.sql)
    printf '%s\\n' 'COPY supabase_migrations.schema_migrations (version) FROM stdin;' '\\.' > "$output"
    ;;
  *) exit 2 ;;
esac
`);
  if (age) {
    writeExecutable(path.join(mockBin, 'age'), `#!/bin/sh
set -eu
if [ "\${MOCK_AGE_MODE:-complete}" = fail ]; then
  echo 'SENSITIVE_AGE_FAILURE' >&2
  exit 1
fi
output=''
input=''
previous=''
for argument in "$@"; do
  if [ "$previous" = '-o' ]; then output=$argument; previous=''; continue; fi
  case "$argument" in -o) previous='-o';; -r|-i) previous='skip';; -d) :;; *)
    if [ "$previous" = skip ]; then previous=''; else input=$argument; fi
  esac
done
cp "$input" "$output"
`);
  }

  const output = path.join(path.dirname(root), `${path.basename(root)}-output`);
  mkdirSync(output, { mode: 0o700 });
  const temporary = path.join(path.dirname(root), `${path.basename(root)}-temporary`);
  mkdirSync(temporary, { mode: 0o700 });
  const commandLog = path.join(root, 'mock-commands.log');
  writeFileSync(commandLog, '');
  return {
    root,
    output,
    temporary,
    commandLog,
    backup: path.join(root, 'scripts', 'backup-supabase.sh'),
    verify: path.join(root, 'scripts', 'verify-backup.sh'),
    env: {
      ...process.env,
      PATH: `${mockBin}:${systemPath}`,
      TMPDIR: temporary,
      MOCK_COMMAND_LOG: commandLog,
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
      rmSync(output, { recursive: true, force: true });
      rmSync(temporary, { recursive: true, force: true });
    },
  };
}

function backupArguments(output) {
  return ['--output-dir', output, '--age-recipient', 'age1fixture-recipient'];
}

test('repository, traversal, symlink, and broad output destinations are rejected', () => {
  const fixture = createFixture();
  try {
    const inside = path.join(fixture.root, 'backup-output');
    mkdirSync(inside);
    for (const destination of [fixture.root, inside, '/tmp']) {
      const result = run(fixture.backup, backupArguments(destination), {
        cwd: fixture.root,
        env: fixture.env,
      });
      assert.notEqual(result.status, 0);
    }

    const traversed = `${fixture.output}/../${path.basename(fixture.output)}`;
    const traversal = run(fixture.backup, backupArguments(traversed), {
      cwd: fixture.root,
      env: fixture.env,
    });
    assert.notEqual(traversal.status, 0);

    const realOutput = path.join(path.dirname(fixture.output), `${path.basename(fixture.output)}-real`);
    const linkedOutput = path.join(path.dirname(fixture.output), `${path.basename(fixture.output)}-link`);
    mkdirSync(realOutput);
    symlinkSync(realOutput, linkedOutput);
    const symlinked = run(fixture.backup, backupArguments(linkedOutput), {
      cwd: fixture.root,
      env: fixture.env,
    });
    assert.notEqual(symlinked.status, 0);
    unlinkSync(linkedOutput);
    rmSync(realOutput, { recursive: true });
    assert.equal(readFileSync(fixture.commandLog, 'utf8'), '');
  } finally {
    fixture.cleanup();
  }
});

test('missing recipient, age, or repository-local CLI fails before remote work', () => {
  const fixture = createFixture();
  try {
    const missingRecipient = run(fixture.backup, ['--output-dir', fixture.output], {
      cwd: fixture.root,
      env: fixture.env,
    });
    assert.notEqual(missingRecipient.status, 0);

    const noAgeEnv = { ...fixture.env, PATH: systemPath };
    const missingAge = run(fixture.backup, backupArguments(fixture.output), {
      cwd: fixture.root,
      env: noAgeEnv,
    });
    assert.notEqual(missingAge.status, 0);
    assert.equal(readFileSync(fixture.commandLog, 'utf8'), '');
  } finally {
    fixture.cleanup();
  }

  const noCli = createFixture({ cli: false });
  try {
    const result = run(noCli.backup, backupArguments(noCli.output), {
      cwd: noCli.root,
      env: noCli.env,
    });
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(noCli.commandLog, 'utf8'), '');
  } finally {
    noCli.cleanup();
  }
});

test('failed dump and encryption clean only validated temporary files', () => {
  for (const failure of ['dump', 'encryption']) {
    const fixture = createFixture();
    try {
      const sentinel = path.join(fixture.temporary, 'keep-me');
      writeFileSync(sentinel, 'sentinel');
      const env = {
        ...fixture.env,
        ...(failure === 'dump' ? { MOCK_NPM_MODE: 'fail' } : { MOCK_AGE_MODE: 'fail' }),
      };
      const result = run(fixture.backup, backupArguments(fixture.output), {
        cwd: fixture.root,
        env,
      });
      assert.notEqual(result.status, 0);
      assert.equal(existsSync(sentinel), true);
      assert.equal(
        readdirSync(fixture.temporary).some((entry) => entry.startsWith('plannix-backup.')),
        false,
      );
      assert.deepEqual(readdirSync(fixture.output), []);
      assert.equal(`${result.stdout}${result.stderr}`.includes('SENSITIVE_'), false);
    } finally {
      fixture.cleanup();
    }
  }
});

test('empty, incomplete, and loose public-word dumps fail without producing an archive', () => {
  for (const mode of ['empty', 'incomplete', 'loose-schema']) {
    const fixture = createFixture();
    try {
      const result = run(fixture.backup, backupArguments(fixture.output), {
        cwd: fixture.root,
        env: { ...fixture.env, MOCK_NPM_MODE: mode },
      });
      assert.notEqual(result.status, 0);
      assert.deepEqual(readdirSync(fixture.output), []);
      assert.equal(`${result.stdout}${result.stderr}`.includes('SECRET_SQL_ROW'), false);
    } finally {
      fixture.cleanup();
    }
  }
});

test('quoted idempotent pg_dump schema produces only an encrypted archive and checksum', () => {
  const fixture = createFixture();
  try {
    const result = run(fixture.backup, backupArguments(fixture.output), {
      cwd: fixture.root,
      env: fixture.env,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'Backup completed successfully.');
    assert.equal(result.stderr, '');
    const files = readdirSync(fixture.output).sort();
    assert.equal(files.length, 2);
    const archive = files.find((filename) => filename.endsWith('.tar.age'));
    const checksum = files.find((filename) => filename.endsWith('.tar.age.sha256'));
    assert.ok(archive);
    assert.ok(checksum);
    for (const filename of files) {
      assert.equal(statSync(path.join(fixture.output, filename)).mode & 0o777, 0o600);
    }
    assert.equal(
      readdirSync(fixture.temporary).some((entry) => entry.startsWith('plannix-backup.')),
      false,
    );
    const commands = readFileSync(fixture.commandLog, 'utf8');
    assert.match(commands, /db dump --linked/);
    assert.match(commands, /--role-only/);
    assert.match(commands, /--data-only --use-copy/);
    assert.match(commands, /--schema supabase_migrations/);
    assert.match(commands, /migration list --linked/);
    assert.doesNotMatch(commands, /db reset|db push|migration repair|restore/i);
    assert.equal(`${result.stdout}${result.stderr}`.includes('SECRET_SQL_ROW'), false);

    const checksumOnly = run(fixture.verify, [
      '--archive', path.join(fixture.output, archive),
      '--checksum', path.join(fixture.output, checksum),
    ], { cwd: fixture.root, env: fixture.env });
    assert.equal(checksumOnly.status, 0, checksumOnly.stderr);

    const identity = path.join(fixture.root, 'identity.txt');
    writeFileSync(identity, 'mock identity', { mode: 0o600 });
    const full = run(fixture.verify, [
      '--archive', path.join(fixture.output, archive),
      '--checksum', path.join(fixture.output, checksum),
      '--age-identity', identity,
    ], { cwd: fixture.root, env: fixture.env });
    assert.equal(full.status, 0, full.stderr);
    assert.equal(full.stdout.trim(), 'Encrypted archive and backup contents verified.');
    assert.equal(`${full.stdout}${full.stderr}`.includes('SECRET_SQL_ROW'), false);
  } finally {
    fixture.cleanup();
  }
});

test('verification rejects checksum corruption and production scripts contain no database-destructive command', () => {
  const fixture = createFixture();
  try {
    const result = run(fixture.backup, backupArguments(fixture.output), {
      cwd: fixture.root,
      env: fixture.env,
    });
    assert.equal(result.status, 0, result.stderr);
    const archive = readdirSync(fixture.output).find((filename) => filename.endsWith('.tar.age'));
    const checksum = `${archive}.sha256`;
    writeFileSync(path.join(fixture.output, checksum), `${'0'.repeat(64)}  ${archive}\n`);
    const verification = run(fixture.verify, [
      '--archive', path.join(fixture.output, archive),
      '--checksum', path.join(fixture.output, checksum),
    ], { cwd: fixture.root, env: fixture.env });
    assert.notEqual(verification.status, 0);
  } finally {
    fixture.cleanup();
  }

  for (const filename of [backupSource, verifySource]) {
    const source = readFileSync(filename, 'utf8');
    assert.doesNotMatch(source, /supabase[^\n]*(db\s+reset|db\s+push|migration\s+repair)/i);
    assert.doesNotMatch(source, /psql|pg_restore|vault[^\n]*root[^\n]*key/i);
    const syntax = run('/bin/sh', ['-n', filename], { env: process.env });
    assert.equal(syntax.status, 0, syntax.stderr);
  }
});
