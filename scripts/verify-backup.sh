#!/bin/sh

set -eu
umask 077

usage() {
  echo "Usage: scripts/verify-backup.sh --archive <absolute-.age-file> --checksum <absolute-checksum-file> [--age-identity <identity-file>]" >&2
}

fail() {
  echo "Backup verification failed: $1" >&2
  exit 1
}

archive=''
checksum=''
age_identity=''

while [ "$#" -gt 0 ]; do
  case "$1" in
    --archive) [ "$#" -ge 2 ] || { usage; exit 2; }; archive=$2; shift 2 ;;
    --checksum) [ "$#" -ge 2 ] || { usage; exit 2; }; checksum=$2; shift 2 ;;
    --age-identity) [ "$#" -ge 2 ] || { usage; exit 2; }; age_identity=$2; shift 2 ;;
    --help) usage; exit 0 ;;
    *) usage; exit 2 ;;
  esac
done

[ -n "$archive" ] || fail "an encrypted archive is required."
[ -n "$checksum" ] || fail "a checksum file is required."
case "$archive:$checksum" in
  /*:/*) ;;
  *) fail "archive and checksum paths must be absolute." ;;
esac
[ -f "$archive" ] && [ ! -L "$archive" ] || fail "the encrypted archive is unavailable."
[ -f "$checksum" ] && [ ! -L "$checksum" ] || fail "the checksum file is unavailable."
[ -s "$archive" ] && [ -s "$checksum" ] || fail "the archive or checksum is empty."
command -v shasum >/dev/null 2>&1 || fail "shasum is required."

archive_dir=$(CDPATH= cd -- "$(dirname -- "$archive")" && pwd -P)
archive_name=$(basename -- "$archive")
checksum_dir=$(CDPATH= cd -- "$(dirname -- "$checksum")" && pwd -P)
[ "$archive_dir" = "$checksum_dir" ] || fail "archive and checksum must share a directory."
case "$archive_name" in
  plannix-backup-*.tar.age) ;;
  *) fail "the encrypted archive filename is invalid." ;;
esac
[ "$(basename -- "$checksum")" = "$archive_name.sha256" ] \
  || fail "the checksum filename does not match the archive."
[ "$(wc -l < "$checksum" | tr -d ' ')" = 1 ] \
  || fail "the checksum file has an invalid structure."
expected_hash=$(awk '{ print $1 }' "$checksum")
expected_name=$(awk '{ print $2 }' "$checksum")
printf '%s\n' "$expected_hash" | grep -Eq '^[0-9a-f]{64}$' \
  || fail "the checksum file has an invalid hash."
[ "$expected_name" = "$archive_name" ] \
  || fail "the checksum file names an unexpected archive."
actual_hash=$(shasum -a 256 "$archive" | awk '{ print $1 }')
[ "$actual_hash" = "$expected_hash" ] \
  || fail "the encrypted archive checksum does not match."

if [ -z "$age_identity" ]; then
  echo "Encrypted archive checksum verified."
  exit 0
fi

[ -f "$age_identity" ] && [ ! -L "$age_identity" ] || fail "the age identity is unavailable."
command -v age >/dev/null 2>&1 || fail "age is required for content verification."
command -v tar >/dev/null 2>&1 || fail "tar is required for content verification."

temp_parent=${TMPDIR:-/tmp}
canonical_temp_parent=$(CDPATH= cd -- "$temp_parent" && pwd -P) \
  || fail "the temporary directory parent cannot be resolved."
verify_temp_dir=''

cleanup() {
  status=$?
  if [ -n "$verify_temp_dir" ] && [ -d "$verify_temp_dir" ] && [ ! -L "$verify_temp_dir" ]; then
    parent_check=$(CDPATH= cd -- "$(dirname -- "$verify_temp_dir")" && pwd -P 2>/dev/null || true)
    temp_name=$(basename -- "$verify_temp_dir")
    if [ "$parent_check" = "$canonical_temp_parent" ] \
        && case "$temp_name" in plannix-verify.*) true;; *) false;; esac \
        && [ -f "$verify_temp_dir/.plannix-verify-temp" ]; then
      rm -rf -- "$verify_temp_dir"
    fi
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

verify_temp_dir=$(mktemp -d "$canonical_temp_parent/plannix-verify.XXXXXX") \
  || fail "a verification directory could not be created."
chmod 700 "$verify_temp_dir"
: > "$verify_temp_dir/.plannix-verify-temp"
chmod 600 "$verify_temp_dir/.plannix-verify-temp"
decrypted_archive="$verify_temp_dir/backup.tar"
if ! age -d -i "$age_identity" -o "$decrypted_archive" "$archive" >/dev/null 2>&1; then
  fail "the encrypted archive could not be decrypted."
fi
[ -s "$decrypted_archive" ] || fail "the decrypted archive is empty."
chmod 600 "$decrypted_archive"

members="$verify_temp_dir/members.txt"
tar -tf "$decrypted_archive" > "$members" 2>/dev/null \
  || fail "the decrypted archive is not a readable tar archive."
chmod 600 "$members"
while IFS= read -r member; do
  case "$member" in
    roles.sql|schema.sql|data.sql|migration-history-schema.sql|migration-history-data.sql|\
    migration-list.txt|git-commit.txt|supabase-cli-version.txt|backup-timestamp-utc.txt|\
    tracked-migrations.sha256|manifest.sha256) ;;
    *) fail "the archive contains an unexpected or unsafe path." ;;
  esac
done < "$members"

extract_dir="$verify_temp_dir/extracted"
mkdir "$extract_dir"
chmod 700 "$extract_dir"
tar -C "$extract_dir" -xf "$decrypted_archive" >/dev/null 2>&1 \
  || fail "the archive could not be extracted."
for required_file in roles.sql schema.sql data.sql migration-history-schema.sql \
  migration-history-data.sql migration-list.txt git-commit.txt \
  supabase-cli-version.txt backup-timestamp-utc.txt tracked-migrations.sha256 manifest.sha256; do
  [ -s "$extract_dir/$required_file" ] || fail "the archive is missing a required file."
done
(
  cd "$extract_dir"
  shasum -a 256 -c manifest.sha256 >/dev/null 2>&1
) || fail "the internal backup manifest does not match."

grep -Eq 'CREATE[[:space:]]+TABLE[[:space:]]+(IF[[:space:]]+NOT[[:space:]]+EXISTS[[:space:]]+)?("?public"?\.)"?plannix_users"?([[:space:]]|\()' \
  "$extract_dir/schema.sql" || fail "the archive does not contain the public application schema."
grep -Eq 'CREATE[[:space:]]+TABLE[[:space:]]+(IF[[:space:]]+NOT[[:space:]]+EXISTS[[:space:]]+)?("?private"?\.)"?plannix_personal_organisations"?([[:space:]]|\()' \
  "$extract_dir/schema.sql" || fail "the archive does not contain the private marker schema."
grep -Eq 'CREATE[[:space:]]+TABLE[[:space:]]+(IF[[:space:]]+NOT[[:space:]]+EXISTS[[:space:]]+)?("?supabase_migrations"?\.)"?schema_migrations"?([[:space:]]|\()' \
  "$extract_dir/migration-history-schema.sql" \
  || fail "the archive does not contain the migration-history schema."
grep -Eq '^COPY[[:space:]]+("?auth"?\.)"?users"?' "$extract_dir/data.sql" \
  || fail "the archive does not contain the auth.users COPY structure."
grep -Eq '^COPY[[:space:]]+("?public"?\.)' "$extract_dir/data.sql" \
  || fail "the archive does not contain public data COPY structures."
grep -Eq '^COPY[[:space:]]+("?private"?\.)"?plannix_personal_organisations"?' \
  "$extract_dir/data.sql" || fail "the archive does not contain the private marker COPY structure."
grep -Eq '^COPY[[:space:]]+("?supabase_migrations"?\.)' \
  "$extract_dir/migration-history-data.sql" \
  || fail "the archive does not contain migration-history COPY structures."

echo "Encrypted archive and backup contents verified."
