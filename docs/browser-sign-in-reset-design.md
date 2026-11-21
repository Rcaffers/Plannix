# Explicit browser sign-in reset: investigation and implementation gate

Status: database issuance guard, confirmed HTTP reset and Login UI implemented
for local review. Existing authentication rejection remains unchanged; only the
new explicit reset POST can delete the exact retired orphan cookie. Base: GitHub main 18dfbd3f177282b9f9c5679d0436ce3a21cc17a8.

## Evidence and classification

The failing Chrome request sent one ordinary-session cookie and no browser
binding. A subsequent SELECT-only check found no corresponding session record.
The response was 401 without the verified-terminal bootstrap outcome. This
supports unknown-orphan rejection; it does not establish when or why the row
was removed, whether the supplied secret was ever valid, or the exact historical
server rejection branch. Do not retain the cookie name/value in this document.

Existing bootstrap recovery requires authenticated terminal-context evidence.
Unknown cookies remain rejected. The proposed action must preserve that rule:
explicit deletion of an unusable local credential is not authentication and
must neither issue an anonymous binding/CSRF cookie nor authenticate a user.

## Why a missing-row check alone is unsafe

The generation sequence is shared by browser bindings and sign-in transitions.
`plannix_auth_begin` reserves a generation in a transition. Later,
`plannix_auth_settle` inserts a session using that transition's generation.
A session row can therefore be absent while a valid session with precisely the
same cookie name is still being created. An uncommitted insertion is also not
visible to a normal SELECT. A fabricated future-generation name presents a
similar risk. Name-specific clearing alone is insufficient in these cases.

A cleanup response can arrive after another tab's login response. Browsers apply
Set-Cookie independently of page response-generation guards. JavaScript locks,
BroadcastChannel and repeated SELECTs cannot undo a late cookie deletion.
Cookie values cannot be supplied as a condition on a Set-Cookie deletion.

For a genuinely retired generation, a new ordinary login uses a different name;
clearing the retired exact name would preserve that newer login. The guard added in this stage supplies the database retirement proof; the
HTTP integration must still bind it to the exact current cookie collection.

## Smallest proposed protocol

1. Preserve the failed bootstrap status. Offer the action only when a separate,
   privileged database classifier confirms exactly one well-formed ordinary
   session cookie, zero markers/recovery cookies, no matching session of either
   kind, no matching transition reservation, and an already allocated generation
   that cannot be allocated or settled later. Malformed, duplicate, multiple,
   future-generation, live, mixed and uncertain contexts are ineligible.
2. Implemented database guard: `plannix_auth_retire_orphan_generation(jsonb)`
   takes SHARE table locks with NOWAIT on bindings, transitions, then sessions.
   This conflicts with all INSERT/UPDATE/DELETE writers before it observes
   absence. It takes no row lock and never waits for those table locks; on a
   conflict its exception subtransaction releases earlier locks and returns
   `unavailable`. READ COMMITTED is required, with fresh VOLATILE statement
   snapshots after lock acquisition. Other transaction isolation is ineligible.
   Sequence increment/minimum/cache/cycle configuration is checked; a future
   or not-yet-called generation is ineligible.
   An allocated generation absent from all three tables is permanently recorded
   in `private.plannix_auth_retired_generations`. BEFORE INSERT / UPDATE OF
   generation triggers on all three tables reject reuse with P2010, including
   explicit assignments and writers that waited behind the retirement lock.
   Issuance triggers also reject non-READ-COMMITTED writers (P2011): an older
   repeatable-read snapshot must not hide a newly committed retirement.
   Returned `retired` is usable only AFTER the RPC transaction successfully
   commits. A failed/uncertain commit provides no permission to clear a cookie.
   A retained transition, including a failed or expired one, remains ineligible.
3. Return a short-lived authenticated reset proof tied to the exact parsed cookie
   collection and reset purpose. It must reveal no cookie name/value or owner.
   Keep it in memory only. It is a reset-only anti-CSRF proof, not session authority.
   Bootstrap remains rejected; no cookies are changed just by offering the button.
4. An explicit `Reset sign-in on this browser` POST requires exact same-origin
   validation, the proof, bounded rate limiting, and the unchanged current cookie
   collection. Re-run the race-safe classifier. Never accept a cookie name or
   owner selected by the request body. A newer tab context rejects the reset.
5. On confirmed eligibility, clear only the one proven non-issuable cookie name
   with its original Path=/, Secure, HttpOnly and SameSite=Lax scope. Return no
   new marker, session or CSRF state. Preserve consent, subscriptions and storage.
6. A late response may clear only that retired name. Client completion messages
   must also require the originating session/account generation so they cannot
   overwrite a newer tab's UI. Do not broadcast sign-out or invalidate notification
   selectors merely because this obsolete cookie was removed.
7. Show a safe confirmation asking the user to click Login. Never automatically
   bootstrap, resubmit credentials or replay the reset. A transport failure is
   uncertain; do not claim that cleanup happened. A later explicit Login uses the
   browser's then-current cookies and creates a session only after normal auth.

The additive migration implements only the guard and write fences. Coordinated
server/client changes are still required. It is
not safe to implement as a generic 401 button or by extending authenticated
terminal cleanup to every missing record. The existing cookie scheme does not
provide historical evidence that an unknown cookie was ever legitimate; the
product must describe this as explicit removal of an unusable browser credential,
not verified expiry. Existing authentication rejection remains unchanged.

## Required validation before implementation is considered ready

- Real database barriers: generation reserved before session insertion; held
  uncommitted transition insertion; held settlement; missing retired generation;
  future generation; lock conflict; transaction rollback. Await terminal outcomes.
- HTTP: exact unknown-orphan context is offered reset without Set-Cookie;
  valid proof + unchanged context clears exactly that name; changed/mixed context,
  bad proof, expiry, cross-origin and generic 401 never clear cookies.
- Database failure during offer or POST: no cleanup, no anonymous fallback.
- Wrong password: ordinary login error only, no reset action/credential replay.
- Deferred responses: newer login before reset admission and after reset admission
  but before response delivery; newer cookie survives in both cases. Test the
  browser cookie jar, not only response-generation guards.
- Client rendering: eligibility-specific button, duplicate-click prevention,
  pending/failed/uncertain feedback, no automatic Login and stale completion
  suppression after a tab/session change.
- Notification selectors, policies, subscriptions and account consent unchanged.

No production reset, migration, cookie replay, push or deployment was performed
for this investigation. The remaining HTTP/UI and real browser cookie-jar gates are not satisfied by
these database tests. Do not ship the reset button from database evidence alone.


## Database invariant and operational requirements

A committed retirement has no binding, transition or session at that generation.
Every ordinary database write that could create or change one to that generation
is rejected by its fence. Existing login uses `nextval` while holding the table's
insert lock; its uncommitted reservation makes the guard unavailable. A login
started behind retirement receives a different generation. Consequently a late
future HTTP response clearing exactly the retired `s` cookie name cannot erase
that newer session name. This does not prove browser integration, absent UI race
bugs, or authentication of the unknown cookie's original secret.

The history contains only generations and retirement timestamps, no cookie
hashes, secrets or identities. RLS is enabled with no browser or service table
access. Only the service-role guard can retire; the trigger helper has no direct
service/browser EXECUTE. There is no pruning policy: retain and back up this
small append-only history forever. Owner/superuser maintenance that disables
triggers, deletes retirement history or restores an older history is outside
this guarantee and must not be part of rollback. Restores must retain history
and matching fences; see the snapshot-rewind limitation in the independent
review below. Invalidating sessions alone does not establish namespace safety.

Migration order: apply `20261120120000_add_browser_reset_issuance_guard.sql`
after `20261119120000` and before future matching reset code. Existing code
continues working without calling the new guard. Rollback may remove future
HTTP/UI callers but must retain the retirement table and all fences. No applied
migration was edited. The new migration was used only in disposable testing.

SHARE locks temporarily block writes across auth tables until transaction end.
The guard must be a short, standalone RPC transaction; never hold it open across
provider/network work. The NOWAIT path preserves authentication availability
when another auth writer is already active. The function's 250ms lock timeout
bounds other lock waits. Production HTTP rate limiting and signed reset proof
remain requirements before exposing this operation to browsers.

## Validation of this stage

The disposable runner uses actual `plannix_auth_issue_binding`, `begin` and
`settle` RPCs. It observes database locks and explicit psql acknowledgements,
then awaits terminal COMMIT/error results. No mocked provider ordering substitutes
for atomicity. It covers login reservation before reset (including invisible
uncommitted rows), reset before login, a same-name writer blocked behind reset,
late explicit reuse, a pre-retirement repeatable-read writer, rollback,
unsupported guard snapshot isolation, held settlement,
and release of all guard table locks on contention.

The pgTAP suite covers malformed/multiple/marker/recovery contexts, future names,
existing rows/reservations, idempotent retirement, all three insert and update
fences, privileges/RLS and sequence-configuration failure. Existing auth and
notification suites are also run against the full disposable migration chain.
The test data are synthetic; no production cookie is copied or replayed.


Review run (20 November 2026): a fresh unlinked local database applied all 42
migration files, including this unapplied production proposal. The final
lock-observed concurrency runner passed both orderings and all terminal-state
assertions. All 29 pgTAP files passed (1,177 assertions), including 31 new
guard assertions. Focused existing Node authentication tests passed 50/50. No Login
component, transport, router or existing auth RPC definition changed.

Run the new contention test only against a fresh, empty, unlinked stack:
`node scripts/test-orphan-retirement-concurrency.js <plannix-reset-guard-ID> <its-workdir>`.
The runner verifies local Docker socket and exact container/workdir labels;
retirement rows intentionally persist until the entire disposable database is
removed. Do not delete history to make this runner reusable on a real database.

## Independent database-stage review (20 November 2026)

Verdict: proceed to HTTP reset implementation, with the integration gates below;
this is not approval to ship, deploy, or expose the guard directly to browsers.
No fence-bypass defect was reproduced in ordinary supported database execution.
No existing production auth RPC or HTTP/UI code was changed by this review.

### Writer audit

- `plannix_auth_issue_binding` inserts a binding using the sequence default.
  Its expired-binding pruning cascades sessions/transitions/callbacks; retirement
  history has no such foreign key and is retained.
- `plannix_auth_begin` inserts the transition using the sequence default, then
  prunes old transitions. Its reserved generation survives until settlement or
  pruning; even a retained failed transition makes retirement ineligible.
- `plannix_auth_settle` is the only production session inserter. It copies the
  transition generation, never allocates a separate session generation. It
  handles successful ordinary login, immediate signup, confirmation/recovery
  callback completion and immediate email-change completion. It also retires
  previous session authority and prunes sessions/transitions, not reset history.
- `privateSessionRepository.issueBinding/begin/settle` are the server callers;
  `settle` derives the cookie name from the committed generation returned by
  the RPC. No production application path directly writes these private tables
  or calls `nextval`, `setval`, or restarts the generation sequence.
- Strict/bootstrap/application selectors, inspect/expiry, logout and token
  refresh update current-state, deadlines, claims or encrypted tokens, not the
  generation. Callback reserve/ready/claim/cancel updates callback/transition
  state and deadlines, and ultimately uses the same settlement path.
- Notification binding eligibility can mark an expired session, but does not
  issue a session. Account deletion can cascade sessions. Neither touches
  retirement history.
- All three insertion paths and any explicit generation UPDATE hit the fences.
  Ordinary writers acquire RowExclusive table locks before row writes/default
  allocation. A reset either encounters that lock and returns unavailable, or
  holds SHARE first and the writer waits. After reset commit, its trigger sees
  the retirement record. Non-READ-COMMITTED issuance is rejected to prevent an
  older snapshot hiding the record. Privileged trigger suppression/replica-mode
  imports remain a maintenance exception, not a supported issuance path.

### Findings and mandatory HTTP integration conditions

**Medium, availability:** `lock_timeout=250ms` bounds acquisition waits only.
There is no guard-enforced maximum duration for already-acquired SHARE locks.
The review held a service-role transaction open after a successful RPC return;
ordinary binding issuance stayed demonstrably blocked for over 650ms until
COMMIT. Successful and post-lock ineligible returns can retain these locks to
transaction end. This affects all ordinary auth-table writers, not just this
browser. Use exactly one short RPC transaction with an enforced server/database
execution/transaction deadline; validate that deadline and terminal cleanup
before exposing the HTTP action. A client AbortController or HTTP timeout alone
is insufficient. Never hold the transaction across provider/network operations.
NOWAIT contention itself releases all guard table locks via the exception block.

**Medium, recovery assumption:** retirement is permanent only while its history
and fences are retained. The backup script includes private schema/data, but a
pre-migration backup or an older snapshot lacks later retirement records. A
restore must explicitly assert retired-generation data, all three fences, RLS,
grants and sequence configuration before accepting authentication. Do not reopen
an older snapshot under the same cookie namespace without preserving the newer
retirement history or implementing a separately reviewed namespace rollover.
Merely asking users to sign in again or revoking restored sessions does not prove
that old cookie names or late cleanup responses cannot collide after a rewind.
No namespace rollover mechanism is implemented in this stage. Do not prune
history or drop fences during a code rollback.

Caller outcomes:

- `ineligible` or `unavailable`: no deletion and no automatic retry; keep the
  existing authentication rejection. Database errors behave the same way.
- `retired` returned inside an open transaction is provisional. Deletion requires
  confirmed successful commit of the exact-context request.
- Rollback, connection loss, cancellation or uncertain commit: do not send cookie
  deletion, create a binding, replay credentials or infer success. A subsequent
  explicit request must recheck the then-current cookie context and obtain a
  confirmed committed result. Retirement is idempotent; that does not authorize
  automatic replay or reuse of an old reset proof.
- The later HTTP route needs origin/proof/rate-limit checks; service-role access
  alone is not user consent. The hash argument validates shape only and is not
  proof that an unknown credential was ever authentic.

### Fresh review validation

A new unlinked disposable stack applied all 42 local migration files. The
focused guard, bootstrap-expiry, auth-boundary, managed-session, claim-expiry and
push-session-cleanup pgTAP files passed: 250 assertions total. The existing
contention runner passed with observed lock waits and terminal acknowledgements.
Additional disposable-only probes verified actual service-role invocation,
lock duration beyond 250ms, twenty successful login settlements triggering the
8-session/16-transition retention limits, expired-binding cascade and account
deletion, with unchanged retirement counts. No real cookie values were used.

These tests establish database ordering, not real browser cookie-jar behaviour,
provider availability, HTTP commit acknowledgement or production contention
latency. The previously reported full pgTAP and Node suites were not rerun in
this review; their results remain prior evidence. No HTTP reset route or Login
button was added. The real browser delayed-response race test remains required.


## HTTP stage (20 November 2026; local review only)

Implemented routes under `/__stage3/auth`:

- `GET /bootstrap` still returns 401 for an unknown orphan. Only a successful
  `plannix_auth_check_orphan_generation` result adds `browserResetProof` to that
  rejection. The classifier takes the same NOWAIT fences and checks sequence
  configuration and all three auth tables, but never retires a generation or
  writes proof history. Missing migration/database errors do not offer reset.
- The proof expires after 60 seconds, is HMAC-authenticated using a domain-
  separated existing CSRF key and application origin, and contains a random
  nonce plus an opaque HMAC of the exact parsed Plannix cookie context. Neither
  credential values nor cookie names are exposed. Unrelated non-Plannix cookies
  are not authority and do not participate. The Login UI keeps proofs in memory only.
- `POST /browser-reset` requires JSON containing only `proof`, the exact Origin
  and Host checks already used by auth, a valid proof, and unchanged current
  request cookies. The separate proof is the reset-only CSRF protection because
  this case has no browser-binding cookie. A distributed network bucket allows
  six admitted reset attempts per minute. Bootstrap retains its existing limiter.
- The repository makes one mutation POST RPC, `plannix_auth_reset_orphan_generation`,
  followed on success by a separate read-only confirmation RPC.
  In one transaction it consumes the proof hash and calls the existing retirement
  guard. Committed reuse is rejected across instances. Only expired proof hashes
  may be pruned; permanent generation retirement is never pruned. A rollback also
  rolls back proof consumption; callers must not automatically replay a proof
  after any uncertain/error outcome. A new explicit attempt obtains fresh proof.
- A successful mutation response is provisional. A separate read-only RPC must
  observe committed retirement plus this exact proof/context/expiry before
  a 204 with one exact-name deletion (`Path=/; Secure; HttpOnly; SameSite=Lax`).
  No binding/CSRF/session is issued; no identity-provider call, login replay,
  selector change or notification operation occurs. Contention/replay returns
  409 without cookies; invalid proof/context returns 403; database/transport
  uncertainty returns 503 without cookies. Later Login uses the ordinary flow.
- Request rate limiting and HTTP response handling are outside the retirement
  transaction. The installed SDK does not retry non-idempotent POST RPCs; neither
  the repository nor route adds retry. Its HTTP deadline is not treated as proof
  that database work stopped. A disconnected response cannot authorize deletion.

### Transaction lifetime and prerequisites

The new additive `20261120130000_add_browser_reset_http_boundary.sql` requires
PostgreSQL 17+ for `transaction_timeout`. The classifier and reset wrapper set
it to 1000ms before acquiring locks. Older targets fail closed before lock
acquisition. This is per-transaction, not an environment/global setting.
It bounds active work and the idle interval through commit, independently of an
HTTP disconnect. Scheduling/termination latency is not a real-time guarantee.

The wrapper intentionally has no function-level SET clause: PostgreSQL's
function configuration stack would restore transaction-local settings when that
function exits. Its very first fully qualified call sets an empty transaction-
local search path, then bounded lock and transaction settings. Every relation,
called function and sequence is schema-qualified. Security-definer ownership
and service-role-only execution remain mandatory. The timer and empty path
persist until transaction end; callers must not nest this RPC in unrelated work.
The inner reviewed guard's function settings remain unchanged.

Use the normal one-request/one-transaction PostgREST `commit` mode. A rollback-only
gateway now fails closed: the independent confirmation transaction cannot see
the rolled-back proof/retirement records, so no deletion is emitted. No caller
sends `Prefer: tx=rollback`. The preflight below requires supported durability
settings and either verified always-commit gateway configuration or the explicitly
reviewed project-specific persistence evidence recorded below before release. No direct database connection or new credential is
introduced. The disposable tests exercise actual PostgREST 16.1 and PostgreSQL 17.

### Rollout and rollback

1. Verify a current encrypted backup and isolated restore, including permanent
   retirement history if any has been created. An older backup requires preserved
   newer retirement history or a separately reviewed cookie-namespace rollover
   **before authentication reopens**. Revoking restored sessions is insufficient.
2. Apply issuance guard `20261120120000`, then HTTP boundary `20261120130000`,
   before matching server code. These are separate migrations, not one atomic
   group. Both are currently local/unapplied proposals; no older migration changed.
3. SELECT-only checks must verify definitions, ownership, browser/PUBLIC denial,
   service grants, RLS, fences, replay ledger and PostgreSQL 17+. Verify the
   transaction timer with the disposable/isolated checks, never production fixtures.
4. Deploy matching server and Login UI code only after those checks and the
   reviewed browser cookie-jar tests. Their later completed validation is recorded
   below. Existing sign-in and terminal-context 409 recovery remain available if
   the new classifier fails or is absent.
5. Code rollback may remove offers/POST handling. Keep retirement history and
   issuance fences installed. Do not repair history, rewind the sequence, drop
   the fence, or restore older data under the same namespace as a rollback shortcut.

### Coverage and remaining gates

`scripts/test-browser-sign-in-reset-http.js` uses the actual Express router,
repository, local PostgREST and real disposable database. Identity-provider responses, token encryption
and limiter admission are synthetic in that runner; the production
limiter has separate Node coverage. It verifies offers without retirement,
changed contexts/origins, expiry/replay, bad passwords, generic 401/database
failure, held real login reservations, confirmed commit, lost commit response,
active timeout, HTTP disconnect and idle-after-RPC timeout. Explicit lock
observations and terminal database acknowledgements establish release and
subsequent unrelated ordinary HTTP login and database settlement. Timeout hooks exist only in the disposable
fixture, not production SQL. Lost acknowledgement is injected after a real commit.

Remaining: Login UI, real browser cookie-jar delayed-response race, production
version/commit-mode preflight, and deployment validation. No production failure
cause is established by this HTTP implementation. No production request or
mutation was performed, and no reset UI was added.

Final HTTP-stage validation: fresh final 43-file migration chain passed; both
lock-observed runners passed; all 30 pgTAP files passed (1,189 assertions, no
skips). Full server suite: 819 passed, zero failures, one existing supplied-PDF
fixture test skipped. Focused authentication tests passed 95/95 after the final
proof/limiter tests. The initial idle harness incorrectly waited for a psql
process reading stdin after its backend died; the final test instead waits for
unblocked issuance, asks that connection to commit, and requires terminal failure.
The SQL wrapper uses transaction-scoped settings without a function SET stack;
pgTAP separately asserts the timer remains set after function return. These are
database/HTTP tests, not real-browser cookie-jar or production evidence.


## Commit-confirmation correction (HTTP review stage)

The original mutation response could report `retired` under PostgREST rollback
mode without persisting anything. The corrected route treats it as provisional:
`confirmOrphanReset` makes another RPC in a separate read-only transaction and
requires `confirmed` before emitting any deletion. A failed, missing, mismatched,
expired, timed-out or uncertain confirmation leaves the cookie intact. Neither
mutation nor confirmation is replayed automatically. The user may explicitly
start again to obtain a fresh proof; no Login or credentials are replayed.

The private proof ledger now also records the generation and SHA-256 hash of
canonical JSONB candidates (containing cookie names and secret hashes only in
memory). It stores no cookie name, cookie value, account, or identity. Confirmation
joins the permanent retirement row to the proof consumption and matches the exact
proof hash, expiry, context hash and generation. It cannot use retirement alone,
or another request's proof, as permission to clear a cookie. Expired proof rows
may be pruned; permanent retirement history must be retained.

The retirement wrapper sets transaction-local `synchronous_commit=on` and rejects
`fsync=off` or `full_page_writes=off` before any retirement locks are acquired.
The one-second PostgreSQL 17 transaction timer remains effective through commit.
The confirmation is STABLE/read-only with a one-second function statement timeout
(hoisted by supported PostgREST); the HTTP deadline independently prevents late
confirmation from sending cookies. A read timeout does not replay the mutation.
No provider/network call or HTTP response handling occurs while retirement
holds auth-table locks.

`20261120130000` is still an uncommitted/unapplied proposal used only in disposable
stacks, so this correction revises that new migration. No previously applied
migration was edited. If either proposal has been installed in another persistent
project, stop: it needs an additive upgrade, not migration-history repair or
re-running a modified installed version.

### Production preflight: accepted gateway evidence; remaining database gates

On 21 November 2026 the operator-approved probe completed on
`vioymfickxroxqjpdayl`, using
`https://vioymfickxroxqjpdayl.supabase.co/rest/v1` and the existing server-only
`SUPABASE_SECRET_KEY` authentication mechanism. This matches the reset repository:
`serverAuthRuntime.js` creates its privileged Supabase client from `supabaseUrl`
and `supabaseSecretKey`, and calls the reset RPC through that client's Data API
`/rest/v1/rpc` transport. No user access token or browser key substitutes for the
server role. The probe table granted only postgres and service_role access;
PUBLIC/anon/authenticated effective access was denied before either write.

The reviewed run used only `public.plannix_tx_probe_20261121_864b033eb5d9`, run
`147c2560-2619-45ea-bbb0-0710f5142b2d`, and its two constrained synthetic rows:

| Operation | HTTP | Independent transaction observation |
| --- | --- | --- |
| Normal POST, no Prefer header | 201 | Exact normal row persisted; GET 200 |
| POST with Prefer: tx=rollback | 201 | Exact rollback row persisted; GET 200; normal row still present |
| Scoped API DELETE | 204 | GET 200, zero rows |
| Guarded direct-SQL DROP | Success | Separate read-only transaction confirmed table absent |

Neither POST acknowledged `tx=rollback`. Relevant DDL-hook fingerprints matched
the reviewed definitions before setup. This evidence satisfies the **gateway
persistence gate for this project and server-role route at this release review**.
It does not prove a particular `db-tx-end` setting, all gateway requests forever,
RPC-specific settings, or durability configuration. The probe did not call reset,
retire a real generation, or create a real proof/session. Do not repeat production
mutation fixtures as ordinary postchecks.

The runtime must still confirm BOTH the retirement and consumption of the exact
request's proof in a separate transaction before sending Set-Cookie. No response
body, HTTP 2xx, preflight result or recorded probe may bypass that confirmation.
Missing, mismatched, failed or uncertain confirmation leaves the cookie intact.
There is no automatic mutation retry.

Repeat the separately approved probe (or obtain equivalent actual gateway
configuration evidence) after a project/endpoint/server-role change, Data API
proxy/routing/transaction configuration change, relevant gateway upgrade or
provider change, contradictory persistence evidence, or a restore/failover whose
transaction configuration equivalence cannot be established. Reassess evidence
at each release; do not silently carry it to another project or assume that a
rotated credential has the same role. A new probe requires its own reviewed
unique table/run, approval and cleanup. RPC changes additionally require review
and disposable tests; this table probe does not validate their behaviour.

After both migrations and before matching server deployment, verify the new
service-only `plannix_auth_browser_reset_preflight()` through the same Data API.
The five database booleans must all be true. This is a SELECT-only RPC:

```sh
node --env-file=.env.server.local --input-type=module <<'JS'
import {createClient} from '@supabase/supabase-js';
const url=new URL(process.env.SUPABASE_URL);
if(url.href!=='https://vioymfickxroxqjpdayl.supabase.co/' || !process.env.SUPABASE_SECRET_KEY)
  throw Error('Preflight target or service access mismatch');
const client=createClient(url.href,process.env.SUPABASE_SECRET_KEY,
  {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const {data,error}=await client.rpc('plannix_auth_browser_reset_preflight',{}, {get:true})
  .retry(false).abortSignal(AbortSignal.timeout(5000));
const names=['postgresSupported','fsyncEnabled','fullPageWritesEnabled','synchronousCommitEnabled','primary'];
const checks=Object.fromEntries(names.map(name=>[name,!error && data?.[name]===true]));
console.log(JSON.stringify(checks));
if(!Object.values(checks).every(Boolean)) process.exitCode=1;
JS
```

Use only an ignored server-side environment file; never print credentials or add
VITE variables. This command does not load or invoke a reset mutation. It cannot
run successfully until the new preflight RPC is installed. Before migration,
read-only SQL must check PostgreSQL >=17, primary, fsync/full_page_writes on and
synchronous_commit not off; repeat through the API after migration for the
actual role-effective context. These remaining production checks have not been
completed by the table probe.

For deployments with actual effective gateway configuration available, the
existing strict executable remains an alternative:

```sh
node scripts/check-browser-reset-preflight.js \
  --expected-project vioymfickxroxqjpdayl \
  --gateway-config /secure/path/to/matching-postgrest-dump-config
```

It intentionally still requires actual `db-tx-end = "commit"` configuration and
rejects missing, duplicate, override and rollback modes. Do not fabricate config
from the probe or claim that this command passed. Keep dump-config private and
outside git; `--gateway-config -` accepts private stdin. Local HTTP regressions
continue testing this strict path with actual disposable commit/rollback gateway
configuration; `--local-disposable` is restricted to loopback. The documented
project-specific evidence route above is separate from that config-only tool.

### Recovery when retirement committed but confirmation failed

The browser may retain the stale cookie while the generation is permanently
retired. This does not authenticate it and does not require deleting retirement
history. The user clicks Login explicitly; bootstrap can issue a fresh proof for
the same still-orphaned context. A new explicit reset consumes that new proof,
observes the existing retirement plus its own committed proof/context record,
and can clear exactly the obsolete cookie. This path is tested through the real
HTTP route/database and rendered Login. Database/service unavailability, changed
cookies or expired proof still fail closed; restore service or click Login again
to obtain a fresh proof. No mutation or credentials are automatically replayed.

### Permanent browser regression and its limits

Run `node scripts/test-browser-sign-in-reset-browser.js <new-disposable-project>
<its-workdir> <pinned-cli-path>` after the migration chain. Like the HTTP runner it
requires an unlinked `plannix-reset-guard-*` stack and verifies the local Docker
socket plus container/workdir labels. It builds only the synthetic Header fixture
into a temporary directory, opens a fresh headless Chrome profile, and cleans up
its Chrome process, profile, server and synthetic account. It never opens an
existing Chrome profile or alters a real subscription.

The two active tabs share the **same** Chrome cookie jar. The runner holds an
already-admitted ordinary login's provider completion in tab B, seeds the orphan
and temporarily removes the synthetic browser-binding cookie to construct the
confirmed missing-binding condition, and submits the real reset from tab A.
After real database commit **and confirmation**, it holds the actual deletion
response before headers are sent. It restores that synthetic binding privately,
releases B's admitted login and waits until Chrome stores the newer session
cookie. Only then is A's reset response released. Assertions compare the cookie
jar before/after: exactly the orphan name disappears, the newer session and
binding remain, and a request through the actual protected-session guard returns
200. The final integrated fixture uses the shipped `createServerAuthController`
for Login, error propagation and subsequent session restoration. While the
orphan is still present, B's server login commits but its controller's status
verification correctly remains rejected; the fixture explicitly awaits that
terminal result. After deletion, the actual controller verifies the surviving
session in both tabs and the obsolete reset UI closes. This test does not claim
that B's page finished session verification before the orphan was removed.

This fixture constructs the missing-binding state and restores its synthetic
marker explicitly; it does not establish how production lost that cookie. The
provider, limiter and encryption payload are synthetic, while the browser cookie
jar, production reset/login/controller/transport/Header code, PostgREST, database commits,
generation fences and protected-session guard are real. The test proves this
controlled delayed-response ordering, not every browser/platform or arbitrary
provider timing. It does not test Safari/iPhone behaviour or production ingress.

Additional rendered checks cover single-use/pending controls, explicit Login after
reset, failed-confirmation recovery using a fresh proof, wrong-password exclusion,
390px mobile overflow, keyboard access and returning focus to Login. Unit tests
cover generic rejection, no implicit notification transition/bootstrap/login,
uncertain reset single use and stale-generation rejection.

Final UI-stage checks: commit-mode and rollback-mode HTTP runners passed, including
fresh-proof recovery after committed retirement with failed confirmation. The
lock-observed contention runner and fresh 43-file migration chain passed; full
pgTAP passed all 1,202 assertions across 30 files. All 469 client/shared and 96
authentication Node tests passed. The real Chrome reset/UI runner and existing
App/Profile/auth Chrome regression passed sequentially. Both production auth
builds and their established bundle audits passed using temporary output only.
Changed-file secret scanning and tracked/untracked whitespace checks passed.
The focus correction uses React commit effects rather than background-tab
animation-frame scheduling. The final feature remains local, unstaged and
uncommitted; production checks/deployment remain separate outstanding steps.


Final integrated review: the original Header fixture had a custom Login callback
that bypassed the application controller. It now calls the actual controller and
asserts its terminal outcomes. The lost-confirmation recovery button and explicit
Login path therefore exercise the shipped Header, transport and controller with
the real HTTP/database boundary. The two-tab cookie proof distinguishes server
session creation from client verification as described above. No production
runtime change was needed for this coverage correction. All eighteen feature
files remain unstaged/uncommitted against base 18dfbd3.

### Exact proposed release sequence after separate approval

These commands are instructions only; the production probe does not authorize
migrations or deployment. First commit/review the final feature revision locally
(operator Git actions), verify a current encrypted backup/restore/off-device
checksum for the installed state, and confirm no unexpected catalogue objects.
The fresh `plannix-backup-20261121T185927Z.tar.age` covers exactly the installed
41 migrations. Its checksum, decryption, manifest and isolated database restore
passed; `restore-verification-20261121.txt` records exact catalogue/permissions,
83 COPY counts, 108 foreign keys, Auth triggers and rollback verification. The
28 applicable empty-fixture pgTAP suites passed separately (1,146 assertions).
Auth/Storage service flows, Storage bytes and Vault credentials remain separate
recovery requirements. The new archive's NAS copy/checksum is still pending
operator evidence; do not apply until that off-device prerequisite is confirmed.
Reassess freshness before rollout rather than treating gateway evidence as a
backup substitute. Preserve retirement history permanently in future recovery.

```sh
cd /private/tmp/plannix-browser-sign-in-reset
test "$(./node_modules/.bin/supabase --version)" = '2.114.0' || exit 1
check_plannix_target() {
  python3 - <<'PY_TARGET'
from pathlib import Path
p=Path('supabase/.temp/project-ref')
if not p.is_file() or p.read_text() not in {'vioymfickxroxqjpdayl','vioymfickxroxqjpdayl\n'}:
    raise SystemExit('Missing or mismatched linked project; stop.')
PY_TARGET
}
# If missing: establish the link only with separate operator authorization.
# ./node_modules/.bin/supabase link --project-ref vioymfickxroxqjpdayl
check_plannix_target && ./node_modules/.bin/supabase migration list --linked
check_plannix_target && ./node_modules/.bin/supabase db push --linked --skip-vault --dry-run
```

Require all **41 installed versions** to match repository filenames exactly and
only these two pending versions, in order:

1. `20261120120000_add_browser_reset_issuance_guard.sql`
2. `20261120130000_add_browser_reset_http_boundary.sql`

Before writing, SELECT-only verify PostgreSQL >=17, primary,
fsync/full_page_writes enabled, synchronous_commit not off, and absence of the six
functions and two private tables listed below; inspect trigger names too. Any
partial/manual installation, unexpected pending version or missing evidence stops
rollout. Do not repair history. After separate approval, the application command is:

```sh
check_plannix_target && ./node_modules/.bin/supabase db push --linked --skip-vault
```

The pinned CLI owns each migration's transaction/history entry. Each has local
5-second lock and 120-second statement timeouts. The two migrations are NOT one
atomic group. Keep matching code undeployed until both succeed. Failure or
uncertain completion requires read-only history/catalogue inspection before an
explicit decision; never blindly retry or automatically repair history. If only
the guard is installed, retain it and existing code while resolving the second
migration; do not remove the fence to resume rollout.

Postchecks, all SELECT-only:

```sh
check_plannix_target && ./node_modules/.bin/supabase migration list --linked
check_plannix_target && ./node_modules/.bin/supabase db push --linked --skip-vault --dry-run
```

Require exactly **43 matching installed versions**, including both new versions,
and no pending migration. Use pinned `db query --linked --project-ref
vioymfickxroxqjpdayl` or the confirmed project's SQL Editor for the following
read-only catalogue query. Require all six rows to have body/owner/security and
access booleans true; missing signatures produce a failed row. Fingerprints below
are derived from the reviewed migration bodies, not production contents:

```sql
BEGIN READ ONLY;
WITH expected(signature,body_md5,service_allowed) AS (VALUES
  ('private.plannix_auth_reject_retired_generation()','55e72433098449a7087dc89544f17606',false),
  ('public.plannix_auth_retire_orphan_generation(jsonb)','eeb2f62db6be414e9168704c7f4abce0',true),
  ('public.plannix_auth_check_orphan_generation(jsonb)','b00979ca2813455235edda80d3232bfc',true),
  ('public.plannix_auth_reset_orphan_generation(jsonb,text,timestamp with time zone)','ad95670506f0e8885c5dc9bfbd690d92',true),
  ('public.plannix_auth_confirm_orphan_reset(jsonb,text,timestamp with time zone)','82ef06f66d418379985838684c5db7fb',true),
  ('public.plannix_auth_browser_reset_preflight()','2c56c1d7cc11be20451df35acb2c1023',true)
)
SELECT e.signature,
 coalesce(md5(p.prosrc)=e.body_md5,false) AS body_matches,
 coalesce(p.proowner='postgres'::regrole AND p.prosecdef,false) AS owner_security_matches,
 coalesce(NOT has_function_privilege('anon',p.oid,'EXECUTE')
   AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
   AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
                  WHERE a.grantee=0 AND a.privilege_type='EXECUTE'),false) AS browser_public_denied,
 coalesce(has_function_privilege('service_role',p.oid,'EXECUTE')=e.service_allowed,false) AS service_access_matches,
 p.proconfig AS settings,p.provolatile AS volatility,l.lanname AS language
FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
LEFT JOIN pg_language l ON l.oid=p.prolang ORDER BY e.signature;
ROLLBACK;
```

Also compare signatures, argument names/types/defaults, return types, language,
volatility and settings to the two reviewed migrations. In particular: wrappers
`check_orphan_generation`/`reset_orphan_generation` deliberately have no
function-level configuration; their body establishes transaction-local empty
search path and timeout. `confirm_orphan_reset` is STABLE, SQL, empty search path,
statement_timeout=1s. `browser_reset_preflight` is STABLE, SQL, empty search path.
The inner retire function is PL/pgSQL with empty search path and lock_timeout=250ms;
the private trigger function is PL/pgSQL with empty search path. All are
security-definer; no additional overloads or explicit grantees are expected.
Review effective access via memberships as well as explicit ACLs.

Verify all three enabled BEFORE INSERT/UPDATE-of-generation row fences on
`private.plannix_auth_browser_bindings`, `private.plannix_auth_transitions` and
`private.plannix_auth_sessions`, calling exactly
`private.plannix_auth_reject_retired_generation()`; compare `pg_get_triggerdef`
with migration SQL. Require both `private.plannix_auth_retired_generations` and
`private.plannix_auth_used_reset_proofs` owned by postgres, RLS enabled, no policies
or effective browser/service-role table/column privileges. Compare their columns,
defaults, constraints and indexes with the reviewed migrations. Verify pre-existing
authentication functions/grants/RLS remain unchanged. No record contents are
needed. Do not call check/retire/reset/confirm with real cookie contexts.

Finally run the five-boolean Data API preflight command above. All checks must
pass before operator deployment of the matching committed server/browser code.
Do not change notification flags. After deployment, verify ordinary sign-in and
bootstrap with controlled operator sessions; reset-cookie actions need separate
explicit operator interaction. On code rollback retain both database migrations,
retirement history, proof ledger and issuance fences. Never rewind generation
issuance or reopen authentication from an older backup without preserved history
or a separately reviewed namespace rollover.
