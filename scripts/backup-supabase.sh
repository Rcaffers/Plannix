#!/bin/sh

set -eu
umask 077

usage() {
  echo "Usage: scripts/backup-supabase.sh --output-dir <empty-absolute-directory> --age-recipient <recipient>" >&2
}

fail() {
  echo "Backup failed: $1" >&2
  exit 1
}

output_dir=''
age_recipient=''

while [ "$#" -gt 0 ]; do
  case "$1" in
    --output-dir)
      [ "$#" -ge 2 ] || { usage; exit 2; }
      output_dir=$2
      shift 2
      ;;
    --age-recipient)
      [ "$#" -ge 2 ] || { usage; exit 2; }
      age_recipient=$2
      shift 2
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

[ -n "$output_dir" ] || fail "an explicit output directory is required."
[ -n "$age_recipient" ] || fail "an age recipient is required."
case "$output_dir" in
  /*) ;;
  *) fail "the output directory must be an absolute path." ;;
esac
case "/$output_dir/" in
  */../*|*/./*) fail "path traversal components are not allowed." ;;
esac

command -v npm >/dev/null 2>&1 || fail "npm is required."
command -v age >/dev/null 2>&1 || fail "age is required."
command -v git >/dev/null 2>&1 || fail "git is required."
command -v tar >/dev/null 2>&1 || fail "tar is required."
command -v shasum >/dev/null 2>&1 || fail "shasum is required."

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
repo_root=$(git -C "$script_dir/.." rev-parse --show-toplevel 2>/dev/null) \
  || fail "the script must run from a Git working tree."
[ -x "$repo_root/node_modules/.bin/supabase" ] \
  || fail "the repository-local Supabase CLI is unavailable."
[ -d "$output_dir" ] || fail "the output directory must already exist."
[ ! -L "$output_dir" ] || fail "the output directory must not be a symlink."

canonical_output=$(CDPATH= cd -- "$output_dir" && pwd -P) \
  || fail "the output directory cannot be resolved."
[ "$canonical_output" = "$output_dir" ] \
  || fail "the output directory must be canonical and contain no symlink components."

case "$canonical_output" in
  /|/tmp|/private|/private/tmp|/var|/private/var|/Users|/Volumes)
    fail "the output directory is too broad."
    ;;
esac
case "$canonical_output/" in
  "$repo_root/"*|"$repo_root/") fail "the output directory must be outside the repository." ;;
esac
case "$repo_root/" in
  "$canonical_output/"*) fail "the output directory must not contain the repository." ;;
esac
[ -z "$(find "$canonical_output" -mindepth 1 -maxdepth 1 -print -quit)" ] \
  || fail "the output directory must be empty."

temp_parent=${TMPDIR:-/tmp}
[ -d "$temp_parent" ] || fail "the temporary directory parent is unavailable."
canonical_temp_parent=$(CDPATH= cd -- "$temp_parent" && pwd -P) \
  || fail "the temporary directory parent cannot be resolved."

backup_temp_dir=''
partial_archive=''
partial_checksum=''
final_archive=''
final_checksum=''
published=0

cleanup() {
  status=$?
  if [ -n "$partial_archive" ] && [ -f "$partial_archive" ]; then
    rm -f -- "$partial_archive"
  fi
  if [ -n "$partial_checksum" ] && [ -f "$partial_checksum" ]; then
    rm -f -- "$partial_checksum"
  fi
  if [ "$status" -ne 0 ] && [ "$published" -eq 0 ]; then
    if [ -n "$final_archive" ] && [ -f "$final_archive" ]; then
      rm -f -- "$final_archive"
    fi
    if [ -n "$final_checksum" ] && [ -f "$final_checksum" ]; then
      rm -f -- "$final_checksum"
    fi
  fi
  if [ -n "$backup_temp_dir" ] && [ -d "$backup_temp_dir" ] && [ ! -L "$backup_temp_dir" ]; then
    temp_parent_check=$(CDPATH= cd -- "$(dirname -- "$backup_temp_dir")" && pwd -P 2>/dev/null || true)
    temp_name=$(basename -- "$backup_temp_dir")
    if [ "$temp_parent_check" = "$canonical_temp_parent" ] \
        && case "$temp_name" in plannix-backup.*) true;; *) false;; esac \
        && [ -f "$backup_temp_dir/.plannix-backup-temp" ]; then
      # Plaintext cleanup is best effort. Deletion cannot guarantee secure erasure on SSDs.
      rm -rf -- "$backup_temp_dir"
    fi
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

backup_temp_dir=$(mktemp -d "$canonical_temp_parent/plannix-backup.XXXXXX") \
  || fail "a temporary directory could not be created."
chmod 700 "$backup_temp_dir"
: > "$backup_temp_dir/.plannix-backup-temp"
chmod 600 "$backup_temp_dir/.plannix-backup-temp"
payload_dir="$backup_temp_dir/payload"
mkdir "$payload_dir"
chmod 700 "$payload_dir"
command_log="$backup_temp_dir/command.log"
: > "$command_log"
chmod 600 "$command_log"

run_dump() {
  filename=$1
  shift
  if ! npm exec supabase -- db dump --linked --file "$payload_dir/$filename" "$@" \
      >> "$command_log" 2>&1; then
    fail "the $filename dump failed."
  fi
  [ -s "$payload_dir/$filename" ] || fail "$filename is empty."
  chmod 600 "$payload_dir/$filename"
}

run_dump roles.sql --role-only
run_dump schema.sql
run_dump data.sql --data-only --use-copy
run_dump migration-history-schema.sql --schema supabase_migrations
run_dump migration-history-data.sql --schema supabase_migrations --data-only --use-copy

if ! npm exec supabase -- migration list --linked \
    > "$payload_dir/migration-list.txt" 2>> "$command_log"; then
  fail "the migration history list failed."
fi
if ! npm exec supabase -- --version \
    > "$payload_dir/supabase-cli-version.txt" 2>> "$command_log"; then
  fail "the Supabase CLI version check failed."
fi
chmod 600 "$payload_dir/migration-list.txt" "$payload_dir/supabase-cli-version.txt"
[ -s "$payload_dir/migration-list.txt" ] || fail "the migration history list is empty."
[ -s "$payload_dir/supabase-cli-version.txt" ] || fail "the Supabase CLI version is empty."

backup_timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf '%s\n' "$backup_timestamp" > "$payload_dir/backup-timestamp-utc.txt"
git -C "$repo_root" rev-parse HEAD > "$payload_dir/git-commit.txt" 2>> "$command_log" \
  || fail "the Git commit could not be recorded."
(
  cd "$repo_root"
  migration_files=$(git ls-files 'supabase/migrations/*.sql')
  [ -n "$migration_files" ] || exit 1
  # Migration filenames are controlled repository paths and cannot contain newlines.
  printf '%s\n' "$migration_files" | while IFS= read -r migration_file; do
    shasum -a 256 "$migration_file"
  done
) > "$payload_dir/tracked-migrations.sha256" 2>> "$command_log" \
  || fail "tracked migration hashing failed."
chmod 600 "$payload_dir/backup-timestamp-utc.txt" "$payload_dir/git-commit.txt" \
  "$payload_dir/tracked-migrations.sha256"

grep -Eq '^CREATE[[:space:]]+ROLE|^ALTER[[:space:]]+ROLE' "$payload_dir/roles.sql" \
  || fail "roles.sql is structurally incomplete."
grep -Eq 'CREATE[[:space:]]+TABLE[[:space:]]+(IF[[:space:]]+NOT[[:space:]]+EXISTS[[:space:]]+)?("?public"?\.)"?plannix_users"?([[:space:]]|\()' "$payload_dir/schema.sql" \
  || fail "schema.sql is missing the public application schema."
grep -Eq 'CREATE[[:space:]]+TABLE[[:space:]]+(IF[[:space:]]+NOT[[:space:]]+EXISTS[[:space:]]+)?("?private"?\.)"?plannix_personal_organisations"?([[:space:]]|\()' "$payload_dir/schema.sql" \
  || fail "schema.sql is missing the private personal-organisation marker."
grep -Eq '^COPY[[:space:]]+("?public"?\.)' "$payload_dir/data.sql" \
  || fail "data.sql is missing public data COPY structures."
grep -Eq '^COPY[[:space:]]+("?auth"?\.)"?users"?' "$payload_dir/data.sql" \
  || fail "data.sql is missing the auth.users COPY structure."
grep -Eq '^COPY[[:space:]]+("?private"?\.)"?plannix_personal_organisations"?' "$payload_dir/data.sql" \
  || fail "data.sql is missing the private marker COPY structure."
grep -Eq 'CREATE[[:space:]]+TABLE[[:space:]]+(IF[[:space:]]+NOT[[:space:]]+EXISTS[[:space:]]+)?("?supabase_migrations"?\.)"?schema_migrations"?([[:space:]]|\()' \
  "$payload_dir/migration-history-schema.sql" \
  || fail "the migration-history schema dump is incomplete."
grep -Eq '^COPY[[:space:]]+("?supabase_migrations"?\.)' \
  "$payload_dir/migration-history-data.sql" \
  || fail "the migration-history data dump is incomplete."

(
  cd "$payload_dir"
  shasum -a 256 roles.sql schema.sql data.sql migration-history-schema.sql \
    migration-history-data.sql migration-list.txt git-commit.txt \
    supabase-cli-version.txt backup-timestamp-utc.txt tracked-migrations.sha256 \
    > manifest.sha256
)
chmod 600 "$payload_dir/manifest.sha256"

plaintext_archive="$backup_temp_dir/backup.tar"
tar -C "$payload_dir" -cf "$plaintext_archive" \
  roles.sql schema.sql data.sql migration-history-schema.sql \
  migration-history-data.sql migration-list.txt git-commit.txt \
  supabase-cli-version.txt backup-timestamp-utc.txt tracked-migrations.sha256 \
  manifest.sha256 >> "$command_log" 2>&1 \
  || fail "the plaintext archive could not be created."
chmod 600 "$plaintext_archive"

filename_timestamp=$(printf '%s' "$backup_timestamp" | tr -d ':-')
archive_name="plannix-backup-${filename_timestamp}.tar.age"
checksum_name="$archive_name.sha256"
final_archive="$canonical_output/$archive_name"
final_checksum="$canonical_output/$checksum_name"
partial_archive="$final_archive.partial"
partial_checksum="$final_checksum.partial"
[ ! -e "$final_archive" ] && [ ! -e "$final_checksum" ] \
  || fail "the backup destination already exists."

if ! age -r "$age_recipient" -o "$partial_archive" "$plaintext_archive" \
    >> "$command_log" 2>&1; then
  fail "backup encryption failed."
fi
[ -s "$partial_archive" ] || fail "the encrypted archive is empty."
chmod 600 "$partial_archive"
mv -- "$partial_archive" "$final_archive"
partial_archive=''
(
  cd "$canonical_output"
  shasum -a 256 "$archive_name" > "$partial_checksum"
)
chmod 600 "$partial_checksum"
mv -- "$partial_checksum" "$final_checksum"
partial_checksum=''
published=1

echo "Backup completed successfully."
