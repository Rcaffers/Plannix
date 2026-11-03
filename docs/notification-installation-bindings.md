# Notification installation binding foundation

This stage changes server-mode registration only. Push payloads, the service
worker, notification clicks, morning-summary dispatch, and bearer mode remain
generic. `detail_disabled` starts true and this stage has no way to enable it.

## Contract

- **First registration:** the server verifies the selected ordinary session,
  locks its browser binding and account, and inserts a never-seen endpoint only
  with `expectedVersion: null`. A removed endpoint retains a permanent
  generation tombstone. Re-enablement requires a new explicit observation and
  that tombstone generation; an older `null` or previous version conflicts.
  One concurrent first registration wins. The database generates the new
  installation ID and version.
- **Reassignment or same-owner registration:** the browser first observes the
  endpoint version using its current subscription keys. Registration must carry
  that exact version and keys. A successful write rotates the installation and
  generic subscription versions; reassignment also rotates the installation ID.
  A conflict is terminal for that operation. There is no read-latest-and-retry.
- **Removal:** a verified current session can remove only a row owned by its
  account and matching the claimed installation version. The browser never
  unsubscribes an unverified or reassigned endpoint. A delayed old removal
  cannot delete a newer version. A table trigger advances endpoint history on
  every delete, including account deletion and expired generic-push cleanup.
  The latter still requires its captured owner and `subscription_version`.
- **Status:** `registered` means the verified account owns a generic push row.
  `boundToCurrentSession` separately reports whether it names the selected
  session. `detailEligible` is always false. Generic ownership never implies
  future detail authorization.
- **Auth invalidation:** each installation records its originating session ID.
  Login, signup confirmation, recovery, refresh, logout, account deletion,
  explicit “Sign out anyway,” and cross-tab account/session changes cannot make
  that ID current again after an auth transition revokes or supersedes it.
  Future detail authorization must verify `bound_session_id` is still the
  binding's current, unexpired, ordinary session, along with device ownership,
  reference ownership, pilot eligibility and separate default-off consents.
  Auth transitions do not depend on push cleanup succeeding. External provider
  revocation remains subject to provider-validation timing.
- **Session deletion:** the FK's `ON DELETE SET NULL` action retains the
  generic subscription. The endpoint trigger permits only that exact update
  after its referenced session is absent, rotates both installation and generic
  subscription versions, advances permanent endpoint history, and keeps
  `detail_disabled = true`. An ordinary writer setting the session to null
  while the parent exists remains fenced. A delayed request using the old
  version conflicts; a new verified session must explicitly observe the new
  version before registration. Deleting a browser binding cascades through the
  same path. Account deletion still removes the subscription and leaves an
  endpoint tombstone. Cleanup locks the endpoint before its history row, as
  registration and removal do; it does not lock another browser binding.
- **Failure and timeout:** browser cancellation, timeout or page closure do not
  cancel admitted server/database work. Every server-mode write uses the
  captured verified session and expected version. A stale or ambiguous request
  is rejected without revoking or changing another account's binding. The
  browser may reload status or explicitly start a new action after conflict.

The RPC lock order is browser binding, `auth.users`, endpoint row, then endpoint
history. The binding
lock serializes with server-session settlement/logout; the account row limits
registered devices to ten across replicas; the endpoint row and version check
serialize concurrent registrations. The final eligibility check uses fresh
database time after delayed endpoint work. A provisional write is rolled back
on expiry while terminal auth expiry is recorded outside that subtransaction.
New notification RPCs use a two-second database lock timeout so a contended
device row does not hold the auth binding indefinitely; the notification
request fails safely while ordinary authentication remains usable.
Endpoint history is permanent. Pruning a tombstone would make a delayed
`expectedVersion: null` request valid again. Active subscriptions still have a
ten-device-per-owner limit; distinct endpoint churn grows history and needs
storage monitoring. Safe bounded retention would require an independently
enforced maximum lifetime for all admitted registration work.
The new RPCs are service-role-only with empty `search_path`; browser roles have
no table access. The server derives owner from the verified session ID, never
from an account ID supplied by the browser.

## Compatibility and activation

### Migration runner and production sequence

Use the exact Supabase CLI **2.114.0** pinned in `package.json` and
`package-lock.json` (`npm ci`; verify with
`./node_modules/.bin/supabase --version`). Do not substitute a floating `npx`
version. CLI **2.122.0** was used only to prepare the separate, isolated
restore baseline; it is not the tested notification-migration runner. CLI
2.115.0's pipelined runner rejects this feature's required
`LOCK TABLE` outside a transaction block. The three migration files therefore
contain no embedded `BEGIN`/`COMMIT`: the tested 2.114.0 runner applies each
file and inserts its history row in one transaction. Each file sets a
transaction-local five-second DDL lock timeout and 120-second statement
timeout. The three files are **not** one atomic group. The second file takes
an `ACCESS EXCLUSIVE` subscription-table lock; a timeout is a failed migration,
not permission to bypass the fence.

Before an authorized production application, compare migration history **and
actual schema**. Run the complete preflight block from this worktree. The
byte-exact check fails on missing or mismatched saved link metadata; it does
not relink or reveal connection details. Both listing and dry run use only
that verified linked target. The dry run must show exactly the three
notification versions as pending:

```sh
npm ci
(
  set -eu
  if ! printf '%s' 'vioymfickxroxqjpdayl' | cmp -s - supabase/.temp/project-ref; then
    printf '%s\n' 'Linked project metadata is missing or unexpected; stop.' >&2
    exit 1
  fi
  if [ "$(./node_modules/.bin/supabase --version)" != '2.114.0' ]; then
    printf '%s\n' 'Unexpected Supabase CLI version; stop.' >&2
    exit 1
  fi
  ./node_modules/.bin/supabase migration list --linked
  ./node_modules/.bin/supabase db push --linked --skip-vault --dry-run
)
```

Only after backup, schema review and change approval, run the **whole**
application block. It repeats the target and CLI checks before any write:

```sh
(
  set -eu
  if ! printf '%s' 'vioymfickxroxqjpdayl' | cmp -s - supabase/.temp/project-ref; then
    printf '%s\n' 'Linked project metadata is missing or unexpected; stop.' >&2
    exit 1
  fi
  if [ "$(./node_modules/.bin/supabase --version)" != '2.114.0' ]; then
    printf '%s\n' 'Unexpected Supabase CLI version; stop.' >&2
    exit 1
  fi
  ./node_modules/.bin/supabase db push --linked --skip-vault
  ./node_modules/.bin/supabase migration list --linked
)
```

Run the following read-only checks against that same project after the push;
require three ordered versions, four installation columns, the active history
fence and FK-cleanup function, no detail-enabled row, and no browser access to
endpoint history. Compare the installed function definition with the reviewed
third migration, since a version row alone does not prove the final body.

```sql
select version from supabase_migrations.schema_migrations
where version in ('20261101120000','20261101130000','20261101140000')
order by version;
select column_name from information_schema.columns
where table_schema='private' and table_name='plannix_push_subscriptions'
  and column_name in ('installation_id','installation_version',
                      'bound_session_id','detail_disabled')
order by column_name;
select to_regclass('private.plannix_push_endpoint_history') is not null as history_exists,
       (select relrowsecurity from pg_class
        where oid='private.plannix_push_endpoint_history'::regclass) as history_rls,
       has_table_privilege('anon','private.plannix_push_endpoint_history','SELECT,INSERT,UPDATE,DELETE') as anon_access,
       has_table_privilege('authenticated','private.plannix_push_endpoint_history','SELECT,INSERT,UPDATE,DELETE') as authenticated_access;
select tgname, tgenabled from pg_trigger
where tgrelid='private.plannix_push_subscriptions'::regclass
  and tgname='plannix_push_track_endpoint' and not tgisinternal;
select pg_get_functiondef('private.plannix_push_track_endpoint()'::regprocedure);
select count(*) as detail_enabled_rows from private.plannix_push_subscriptions
where not detail_disabled;
```

Keep matching application code undeployed until history and schema show all
three migrations in order. If a command fails or times out, leave the code
undeployed and inspect both history and objects before retrying; never run
automatic history repair. A failed second migration must not be treated as an
installed fence. If the third fails, retain the second migration's fence and
do not admit new bound registrations: the FK cleanup correction is still
missing. Verify no bound subscription was created in that interval before
retrying. Existing generic delivery continues. A project that already has
any of these versions requires a separate schema/history comparison and, if
needed, an additive correction; do not replay this revised SQL against a
recorded version. The confirmed production project had only the 33 base
versions and no notification objects at preflight; this says nothing about
other projects.

Apply `20261101120000_add_push_installation_bindings.sql` followed by
`20261101130000_fence_push_installation_writers.sql` and
`20261101140000_allow_push_session_fk_cleanup.sql` before deploying the
matching server-mode code. The latter is additive because this
worktree cannot prove the first was never applied to any persistent project.
The linked project's read-only migration list on 1 November 2026 ends at
`20261021120000` and does not record any of the three notification migrations; that
observation does not cover other projects or manual SQL installs.
The fence migration takes an exclusive subscription-table lock, waits for writers that reached
the table, and installs a trigger that also constrains old cached RPC bodies.
Missing RPCs fail registration closed. Existing rows
receive generated installation IDs and versions with `bound_session_id = null`
and `detail_disabled = true`; their generic delivery continues. The browser
must explicitly re-register them under a current server session to establish a
binding. Old bearer RPCs may manage only generic endpoints that have never
been server-bound or removed. They cannot reassign, remove or recreate an
endpoint once history records server management; such writes fail safely.
Generic delivery continues, but old notification-management requests may
fail. Rolling back to old code cannot restore management of these endpoints
without a separately reviewed rollback migration; never remove the fence as
an automatic rollback step.

The migration lock does not prove every old HTTP request has drained: an
admitted request may not yet have reached its database write. It does ensure
that writers which reached the table finish before the trigger becomes
visible. An old RPC body reaching the table afterward is fenced by the
trigger; it cannot alter a server-bound endpoint or recreate a tombstone.
Apply all three notification migrations and verify trigger/grants before admitting any new
server-mode registration code. Rolling old and new instances may coexist
without bypassing the database fence, but old requests can receive a safe
notification error. A verified push-route pause/drain can avoid those errors;
do not assume DigitalOcean provides one. Authentication and health remain
usable if push management fails. On rollback, old code still cannot manage
server-bound endpoints; keep the database fence and generic dispatch, and
require a separately reviewed migration for any later compatibility change.
An old browser client on the new server cannot bypass the required
expected-version request shape.
Detailed notifications remain disabled. No worker detail credential, fetch or
display protocol is introduced here. A future stage must prove tab/worker
coordination through `showNotification`, generic fallback on uncertainty, and
the remote-revocation and already-displayed-notification limits.

For isolated validation, create a new local Supabase project named
`plannix_notification_review` with ports distinct from any existing project,
then run `supabase start` and `supabase test db --local` from this worktree.
The database-only start may exclude optional local services. The lock runner
`node scripts/test-push-installation-concurrency.js` refuses any other project
ID and requires its verified local Docker container. Stop only that project
with `supabase stop --project-id plannix_notification_review --no-backup`.
