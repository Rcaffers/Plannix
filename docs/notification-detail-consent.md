# Morning notification detail consent and authorization (inactive)

This stage records two independent, default-off choices: lesson/class details and event titles. Names and free-text titles can contain sensitive information. If detailed notifications are enabled in a later stage, they may appear on a phone lock screen and connected watches. Already displayed or mirrored notifications cannot be recalled. Saving consent does not activate detailed delivery.

The existing generic push payload, service worker and notification-click flow remain unchanged. The installation binding's `detail_disabled` flag stays true for all production registration, reassignment, replacement and cleanup paths. There is no deployed API to clear it. The detail endpoint therefore denies production requests in this stage. Tests may clear the flag only inside rollback-only synthetic database fixtures to exercise the authorization contract.

## Server authorization boundary

`GET /api/notifications/morning-summary/detail` uses the ordinary, verified server session guard, including provider validation and the expected-session precondition. Selectors are sent as exactly one each of `X-Plannix-Notification-Reference`, `X-Plannix-Installation-Hash` and `X-Plannix-Installation-Version`. The server derives the account and session from the verified HttpOnly cookie. The endpoint hash and version select a candidate; they do not authorize it. A service-role-only RPC checks the current ordinary session, pilot account, current installation owner, bound session and version, generic delivery record, reference owner and preference revision, enabled summary, lesson-detail consent, personal academic year, weekday/year/holiday eligibility and `detail_disabled=false`. The endpoint rechecks authorization after resolving the snapshot, so a delayed read cannot return details after a known revocation, replacement or consent change. Event titles are included only with the separate event-title consent. A failure returns no details. Responses carry `Cache-Control: no-store, private, max-age=0` and no sensitive values are logged.

Consent is read and changed through `GET/PUT /api/notifications/morning-summary/detail-preferences` in server auth mode. The PUT uses the existing verified cookie session, Origin/CSRF protection, expected-session precondition and revision compare-and-set. The legacy bearer-mode preference endpoint and payload stay unchanged. Existing preference rows receive false for both new columns.

The worker/display branch adds a production-session-guarded HTTP regression that removes event-title consent while a snapshot is held and checks the response after reauthorization. Its repository, provider and authorization RPC are synthetic, so it does not prove a database-backed concurrent consent write. A rollback-only pgTAP fixture directly calls the authorization RPC with an expired, otherwise eligible session. Both focused checks must pass in their appropriate environments before activation; neither substitutes for the worker/display acceptance gate.

## Worker and display gate

The service worker cannot read the HttpOnly session cookie. A future same-origin fetch could send that cookie automatically, while worker-accessible storage holds only the installation selector/version and the expected-session name; neither is a browser-readable session secret or independent authority. The worker must choose the installation belonging to the active session and fall back to generic text if it cannot prove the selection. If details must be fetched without an ordinary cookie session, a separate constrained worker credential design and revocation contract are required; subscription identifiers cannot serve as credentials.

This stage does not fetch or display details in the worker. Before activation, the browser tabs and worker need a bounded authorization-through-display protocol, including a lock covering the final account/binding check and `showNotification` call. Unsupported coordination, timeout, uncertain authorization or a changed account must use generic text. No fetched details should persist in worker storage. Server authorization alone cannot make remote revocation and OS display atomic, and it cannot recall notifications already shown or mirrored. Those are later acceptance gates.

The migration `20261103120000_add_morning_summary_detail_consent.sql` is additive and must precede matching server-mode code. Keep generic delivery enabled as currently configured; no detailed payload or worker change is part of this stage. Apply only after the reviewed binding migrations. Rollback of code may leave the new default-off columns and RPCs in place; do not remove the installation fence or rely on schema rollback to recall displayed content.

## Inactive worker/display follow-up in this feature branch

The next additive migration, `20261103130000_add_push_detail_eligibility.sql`,
must precede the matching worker/display code. Its service-role-only policy
operation can enable one exact current-session installation after explicit
device action, pilot eligibility and lesson consent. It rotates a separate
detail-policy version. Generic push payloads remain unchanged. The runtime
setting `MORNING_SUMMARY_DETAIL_DISPLAY_ENABLED` is absent/false by default;
while false the new routes deny detail and the worker shows generic text.
The complete inactive protocol and its activation limits are in
`docs/notification-worker-display-protocol.md`. The held event-title HTTP
regression remains synthetic; a separate disposable database test now checks
consent withdrawal between two real authorization RPCs. Neither test proves
authorization-through-OS-display on all supported devices.
