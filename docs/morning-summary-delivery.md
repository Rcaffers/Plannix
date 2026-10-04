# Morning summaries: prepared delivery (inactive)

Stage 3 prepares a minute-boundary poller inside the existing Express process.
It is **disabled by default** and no schedule or automatic summary push has
been activated. Importing `server/app.js` never starts it. Only
`server/server.js`, after the HTTP listener is ready, can start polling when
`MORNING_SUMMARY_POLLING_ENABLED=true` and a canonical
`MORNING_SUMMARY_PILOT_USER_ID` are both present. The separate one-shot
`npm run worker:morning-summary` remains available for a future worker
component, but also requires its own `MORNING_SUMMARY_WORKER_ENABLED=true`
flag and the pilot user ID. Keep both flags unset until controlled activation.

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

The pilot migration revokes service-role execution of the unrestricted claim
RPC and adds a service-role-only atomic claim filtered to the configured pilot
UUID **before** any daily job is reserved. Missing or malformed pilot
configuration fails closed. Broader recipient delivery needs a separate,
explicit mode and migration; this code does not have one. The worker claims at
most four jobs concurrently, up to ten registered devices per user, and uses a
four-second push timeout. The one-shot entry point retains its 60-second
process watchdog. The Express poller aborts a cycle at 45 seconds, never
overlaps an unresolved cycle, and backs off at least two minutes after error
or timeout. A non-cooperative dependency can still keep that cycle pending;
the HTTP server continues serving requests, while monitoring must detect the
missing poll heartbeat. Database RPCs and server HTTP errors are generic.
No public trigger endpoint exists. Runtime configuration is server-only:
`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `MORNING_SUMMARY_PILOT_USER_ID` and,
only after the pilot is ready, `MORNING_SUMMARY_POLLING_ENABLED=true` on the
web service. No AI-provider key is needed.

Deploy the additive migrations in order: push subscriptions, Stage 1
preferences, `20261003130000_add_morning_summary_delivery.sql`, then
`20261004120000_restrict_morning_summary_pilot_claims.sql`. Deploy the web
code with both worker flags disabled. Confirm the selected pilot account has
saved an owned academic year, opted in, and subscribed its device. Only after
an eligible school day and a controlled real-device test should the web-service
polling flag be enabled. Neither a weekend, saved holiday/closure nor a date
outside the saved year may be bypassed for testing. Confirm the generic
notification arrives and its link opens the authenticated summary; inspect
private claim/delivery states without exposing content. Broad activation needs
a separate review and explicit mode change. Disable immediately by unsetting
the web polling flag or stopping the web process; preferences and device
registrations remain intact.

The repository has no checked-in DigitalOcean App Platform spec; README and
`Procfile` describe one web service. The poller shares that service's CPU,
memory and lifecycle: it may pause during deployment, restarts or scale-to-zero
and cannot guarantee minute-level execution during an outage. Confirm that the
deployed web service remains continuously available and has capacity before
activation. Polls start at minute boundaries, at most once per process; the
database job key, leases and device states coordinate concurrent web replicas
and rolling deployments. Monitor safe cycle counts/durations, generic failures,
missing two-minute heartbeats, web latency, restart counts and private delivery
state totals. Never log user IDs, endpoints, lesson content or credentials.
On SIGTERM the web server stops accepting connections, the poller stops new
cycles, aborts the active cycle and waits up to ten seconds; normal shutdown is
bounded by fifteen seconds. The one-shot worker can later move to a separate
component without changing database claims. Its enable flag must remain off
while web polling is enabled.
There is no catch-up outside the configured 15-minute window. During the
spring clock change a nonexistent local delivery time has no matching window;
during the repeated autumn hour the user/day claim prevents a second send.
If a late delivery window crosses midnight, its job remains attached to the
original London date, with that date's school-day and closure checks.
