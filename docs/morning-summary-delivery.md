# Morning summaries: prepared delivery (inactive)

Stage 2 prepares a one-shot server worker. It is **disabled by default** and no
schedule or automatic summary push has been activated. `npm run
worker:morning-summary` exits without querying recipients unless
`MORNING_SUMMARY_WORKER_ENABLED=true` is set in the worker process. Keep that
variable unset in the web service.

The saved notification academic year is independent of the year selected in
Settings. A preference created before the Stage 2 migration has a null year and
is ineligible. Saving preferences requires an explicit personal academic-year
ID and matching optimistic revision. The service-role RPC verifies the
confirmed user's authoritative personal organisation, membership, year and
boundaries. Browser roles cannot read the preference, job or delivery tables.
The old four-argument service-role save signature remains temporarily for
rolling deployment compatibility. It cannot set a year on a newly created row;
the Stage 2 HTTP service calls only the five-argument save signature. Retire
the legacy overload only after every running web instance has been upgraded.

The worker resolves a complete dated timetable snapshot through the same
private Week A/B resolver used by the main timetable. It checks every saved
holiday or closure inclusively before generating any message. The shared
`buildMorningSummary` function numbers teaching periods and treats only empty
slots as PPA; absent or invalid teaching periods fail closed. The push title
and body are generic and contain no classes, lesson titles, events, notes or
pupil data. Its only routing value is a random, non-descriptive per-job
reference; the date and academic-year ID are not sent to the push service.
The authenticated daily summary route resolves the original date and year for
the signed-in owner and rechecks school-day eligibility when a notification is
opened. A reassigned device cannot use the old account's reference to read
that account's details; notification data is never an ownership claim.

One database job key exists per user and London calendar day. Workers claim
with a 90-second lease; an accepted device stays accepted on a later run.
Each device has a claimed subscription version and at most two attempts. An
explicit 429 can be retried once within the delivery window. A network
timeout or lost provider response is **uncertain** and never retried
automatically, because acceptance may have happened. A crashed in-flight
attempt is also uncertain. Expired 404/410 endpoints are removed only if the
same subscription version still exists. This is bounded at-least-once attempt
processing, not exactly-once provider delivery. Device replacement or
preference changes after a daily claim do not create a second daily job.
Immediately before each attempt, a service-role RPC checks the exact owner,
subscription version, preference revision, saved year and remaining London
delivery window. The worker deducts RPC round-trip time, skips stale or
out-of-window claims, and bounds Web Push TTL to the remaining seconds. This
check does not make an external send atomic with a subsequent account switch;
the generic notification prevents the previous account's details appearing
if a device is reassigned after the check. Push-service acceptance and actual
device display can occur later and cannot be guaranteed inside the window.

The worker claims at most four users concurrently, up to ten registered
devices per user, uses a four-second push timeout, and has a 60-second process
watchdog. Database RPCs and server HTTP errors are generic; monitor claim
counts, process exit status and database delivery states without logging
recipient content. The worker makes no public trigger endpoint. It must run
with server-only `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`. It does not need provider AI keys.

Deploy the additive migration
`20261003130000_add_morning_summary_delivery.sql` after the existing push and
Stage 1 preference migrations, then deploy the web/service code while the
worker flag remains disabled. Stage 3 must verify a real device and schedule
before setting the worker flag. Rollback/disable is immediate: stop the worker
or unset the flag; existing preferences and registrations remain intact.

The repository has no checked-in DigitalOcean App Platform spec; README
describes a single web service. [DigitalOcean App Platform scheduled jobs](https://docs.digitalocean.com/products/app-platform/how-to/manage-jobs/)
are unroutable, but the current documented minimum interval is 15 minutes. That
minimum, plus start jitter, is insufficient to guarantee an arbitrary minute
preference inside a strict 15-minute window. Stage 3 should use a separately
managed minute-level scheduler invoking the one-shot command, or constrain
delivery choices and test scheduler jitter before activation. A continuously
running worker with its own timer is intentionally **not** present here.
There is no catch-up outside the configured 15-minute window. During the
spring clock change a nonexistent local delivery time has no matching window;
during the repeated autumn hour the user/day claim prevents a second send.
If a late delivery window crosses midnight, its job remains attached to the
original London date, with that date's school-day and closure checks.
