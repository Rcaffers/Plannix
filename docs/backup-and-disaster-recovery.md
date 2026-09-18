# Plannix backup and disaster recovery

This runbook covers the first logical-database backup tool. It does not create a
managed Supabase backup and it is not a replacement for restore testing.

## Recovery set

`scripts/backup-supabase.sh` creates an encrypted archive containing:

- `roles.sql`: custom database roles from `--role-only`;
- `schema.sql`: the user-owned database schema;
- `data.sql`: application and supported managed-schema rows using `COPY`;
- `migration-history-schema.sql` and `migration-history-data.sql`: an explicit
  export of `supabase_migrations`;
- `migration-list.txt`: the CLI's human-readable linked migration list;
- the current Git commit, Supabase CLI version, UTC timestamp, tracked migration
  hashes, and an internal SHA-256 manifest.

The final destination receives only a `.tar.age` archive and its `.sha256` file.
All intermediate SQL is created in a mode-0700 temporary directory with files
limited to mode 0600. Cleanup of plaintext temporary files is best effort:
normal deletion cannot guarantee secure erasure on SSD or copy-on-write media.

The schema and data dumps do **not** form a complete platform backup:

- The project-specific Vault root encryption key is never exported. Plannix AI
  connection rows contain Vault references, not a portable copy of the
  underlying provider credential. Maintain those credentials in an independent
  encrypted password manager or organisational secret escrow.
- Supabase Storage object bytes are not in PostgreSQL dumps. A later backup
  slice must copy object bytes, bucket configuration, metadata, and checksums.
- Auth URLs, redirect allowlists, email templates, SMTP, provider configuration,
  API/JWT keys, Realtime settings, extensions, network restrictions, domains,
  DNS, and deployment secrets require a separate non-secret configuration
  inventory. Generate new keys after project reconstruction.
- Existing browser and bearer sessions must be treated as invalid after a
  project is reconstructed. Users must authenticate again.

HSTS, CSP, and production application configuration are outside this backup
tooling slice.

## Prerequisites

- Run from a trusted macOS account with FileVault enabled.
- Install dependencies so `node_modules/.bin/supabase` exists. The script uses
  only `npm exec supabase -- ...`; it never invokes a global CLI.
- Install `age` and keep its private identity outside the repository and backup
  destination.
- Supply an age recipient explicitly. A recipient is not read from an
  environment file by this script.
- Create a new, empty, canonical output directory outside the Git repository.
  Do not use a symlink, repository parent, filesystem root, `/tmp`, or another
  broad shared directory.

Example interface (placeholders only):

```sh
mkdir -m 700 "/absolute/private/path/plannix-backup-$(date -u +%Y%m%dT%H%M%SZ)"

./scripts/backup-supabase.sh \
  --output-dir "/absolute/private/path/plannix-backup-YYYYMMDDTHHMMSSZ" \
  --age-recipient "<AGE_RECIPIENT>"
```

The backup contacts the currently linked project. Review the link before an
authorised run. The script never prints SQL, connection details, project
references, environment values, user information, or CLI diagnostic output.
Failures produce a generic message and remove only the validated temporary
directory and exact partial output files.

Verify the encrypted checksum without decrypting:

```sh
./scripts/verify-backup.sh \
  --archive "/absolute/private/path/plannix-backup-TIMESTAMP.tar.age" \
  --checksum "/absolute/private/path/plannix-backup-TIMESTAMP.tar.age.sha256"
```

Perform full content and internal-manifest verification with an age identity:

```sh
./scripts/verify-backup.sh \
  --archive "/absolute/private/path/plannix-backup-TIMESTAMP.tar.age" \
  --checksum "/absolute/private/path/plannix-backup-TIMESTAMP.tar.age.sha256" \
  --age-identity "/absolute/private/path/to/age-identity.txt"
```

Store a second encrypted copy on a different failure domain. Never retain the
plaintext temporary payload. Recommended initial retention is 7 daily, 4 weekly,
and 12 monthly archives, plus pre/post-migration archives for at least 90 days.

## Restore test: isolated targets only

**Never restore into production and never use the production project as a
restore-test target.** Use a local Supabase stack or a disposable project whose
identity has been independently confirmed.

Before beginning:

1. Verify the outer SHA-256 and decrypt the archive into a mode-0700 temporary
   directory.
2. Verify the internal manifest.
3. Record the source Git commit, CLI version, Postgres version, and target
   Supabase/Auth/Storage versions.
4. Confirm the target is disposable. Stop if there is any ambiguity.

Restore in this order:

1. database roles;
2. user-owned schema;
3. explicit `supabase_migrations` schema and history data;
4. remaining data.

Use `psql --single-transaction --variable ON_ERROR_STOP=1`. For the controlled
data import, follow the current Supabase restore guidance on
`session_replication_role = replica` so profile and encryption triggers do not
run twice. Do not blindly reuse this setting for normal application work.

Managed Supabase, local images, Auth, Storage, and Postgres versions can have
different tables and columns. A plain-SQL backup may need a reviewed,
version-specific restore procedure. Never edit the only backup copy; work from
a verified duplicate and record any compatibility transformations.

After restoration, verify without exposing row contents:

- expected row counts and foreign-key/orphan integrity across Auth, profiles,
  personal organisations, memberships, roles, planner data, and AI metadata;
- RLS enablement, policies, grants, SECURITY DEFINER settings, and RPC access;
- migration history against the tracked migrations and their hashes;
- all repository pgTAP suites against the isolated database;
- all application test suites and bearer-authenticated API smoke tests;
- signup confirmation, login, recovery, onboarding, account deletion, and
  planner isolation using disposable users;
- independent re-entry and rotation of Vault-backed AI credentials;
- future Storage metadata-to-object checksum reconciliation.

Destroy the disposable environment and decrypted files after retaining a
non-sensitive restore report. A backup is not considered healthy until a full
isolated restore has succeeded.

## Forbidden operations

The production backup and verification scripts intentionally contain no reset,
push, migration-repair, restore, or destructive database command. During a
restore drill, never run remote reset, migration push/repair, production `psql`,
or object synchronization with deletion enabled. Never export the Vault root
key, place backups in Git, or include credentials in logs.
