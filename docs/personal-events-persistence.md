# Personal events: Step 2 persistence contract

This stage adds only persistence. It does not add an Events page, timetable cards, AI import or calendar export. It leaves `public.plannix_events` and its school/organisation sharing semantics unchanged.

`private.plannix_personal_events` stores one local calendar date and optional paired `HH:MM` local start/end times. It stores no UTC timestamp or timezone. Both times absent means all day; one time, an equal/end-before-start pair, and an overnight event are invalid. Timezone-aware calendar export requires a separate later design decision.

The table has no direct browser-role grants and no RLS allow policy. Authenticated RPCs resolve `auth.uid()` through `private.plannix_personal_organisations` and its membership; callers supply no owner, membership or organisation ID. The personal academic year is validated against that mapping. The year row is locked before event writes. A year-update trigger rejects boundaries that would strand events. The unique index includes the normalized title, date and nullable time pair (`NULLS NOT DISTINCT`), and the create RPC checks the 500-event cap while holding the same year lock. Academic-year, personal-organisation and membership deletion cascade to events. School events remain separate.

The server requires confirmed bearer authentication and uses a request-scoped public Supabase client. The HTTP contract is:

- `GET /api/events?academicYearId=<uuid>` returns `{ "events": [event] }`. Optional `from` and `to` must both be real ISO dates, ordered and at most 31 days apart. Results include only the selected year's events within the filter, sorted by date, all-day before timed, start time, normalized title and ID.
- `POST /api/events` accepts `{ "academicYearId": "<uuid>", "event": fields }` and returns `201 { "event": event }`.
- `PUT /api/events/:id` accepts `{ "expectedRevision": <positive safe integer>, "event": fields }` and returns `{ "event": event }` with the incremented revision.
- `DELETE /api/events/:id` accepts `{ "expectedRevision": <positive safe integer> }` and returns `{ "ok": true }`.

`fields` contains required `date` and `title` plus optional `startTime`, `endTime`, `location` and `notes`. Dates use real `YYYY-MM-DD`; times use strict `HH:MM`. The server rejects unexpected fields and invalid types. Title and location are NFC-normalized, whitespace-collapsed plain text, up to 200 characters each. Notes are NFC-normalized multiline plain text up to 2,000 characters. Controls and format characters are rejected; line breaks are allowed in notes. A returned `event` contains exactly `id`, `academicYearId`, `date`, `title`, `startTime`, `endTime`, `location`, `notes` and `revision`; absent optional values are `null`.

A stale revision, exact duplicate or full year returns `409` with safe text. An inaccessible or absent event/year returns the same `404` category. A boundary update that would exclude events returns `409` with instructions to move or remove them first. Support references are carried in the `X-Request-ID` response header and are for errors only. Event content and request bodies are not logged. The client utility exposes `ApiError.status` and a canonical `requestId` for recovery UI; it does not cache event data.
