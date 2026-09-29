# Personal AI connections and internal generation

Profile stores one personal connection for OpenAI (`openai`), Anthropic
(`anthropic`) or Google Gemini (`google_gemini`). Connection status means the key
has been stored, not that a provider has validated it. Connection management makes
no provider requests. Stage 2B provides internal generation. Stage 2C exposes authenticated pasted-text holiday suggestions; Stage 2E-B adds
authenticated raw PDF extraction. Both use the Stage 2D Academic Year review before saving.

## Boundaries

- `shared/aiProviders.js` contains browser-safe IDs, labels and the key length
  limit. `server/ai/providers.js` binds those IDs to the internal adapters. Its
  `executionEnabled: false` flag denotes disabled general-purpose public execution;
  trusted server code and the narrowly scoped authenticated Stage 2C route use Stage 2B. Neither accepts caller-selected destinations
  or model IDs.
- GET/POST/PUT/DELETE `/api/ai/connection` require a confirmed Supabase user. The
  request-scoped client carries the validated JWT; it never uses the admin key.
  Query parameters and extra body fields are rejected. POST/PUT accept only
  `{ provider, apiKey }`. The route owns an 8 KiB parser before the general API
  parser, uses `Cache-Control: no-store`, and rejects overlapping mutations for
  the same user within the server process. Database locks enforce serialization
  across server processes and direct RPC calls.
- Keys have no provider-prefix requirement. They are trimmed and bounded to
  5–4096 characters. Rejecting keys of four characters or fewer prevents last-four
  masking from exposing a submitted key in full. Keys stay only in temporary
  component/request memory until stored in Vault. Inputs clear after success,
  failure or cancellation. No browser persistence, analytics, URL parameters or
  credential logging is added.
- Responses contain only provider, a registry-controlled label, last four
  characters and active state. Client and server map safe metadata explicitly;
  exceptions and database diagnostics are never displayed. Canonical request IDs
  remain in response headers and safe error references.

## Database and Vault

The new migration locks the connection table and aborts before changing anything
if any membership already has multiple connections. It does not choose or delete
historical records. Resolve any such records manually before a later deployment.
It replaces the provider allowlist and enforces `unique (organisation_user_id)`.

Four authenticated public RPCs (`plannix_{get,create,replace,delete}_personal_ai_connection`)
are SECURITY DEFINER with empty search paths. The private implementation is not
executable by application roles. It requires a confirmed `auth.uid()`, resolves
`private.plannix_personal_organisations`, checks the personal organisation and
caller membership, and locks that membership. No public RPC accepts a membership,
organisation, connection, model, or secret ID.

Direct table/column grants and legacy AI mutation grants are revoked for public,
anon and authenticated. Existing legacy definitions and the account-deletion
cleanup trigger are retained. Historical school connections are not repurposed
as personal connections.

A replacement/switch creates a new Vault secret, updates the same connection row,
and deletes the previous secret within one transaction. Any exception rolls back
all steps. Deleting a connection uses the existing after-delete Vault cleanup
trigger. No browser-accessible RPC or API response returns plaintext credentials
or a Vault secret ID. The sole plaintext-credential exception is the internal
service-role-only credential-retrieval RPC described below. Its result must stay
inside trusted server code and must never be returned to the browser or logged.

## Validation and future work

- `npm run test:ai-connection`: client API and authenticated server contracts.
- `npm run test:ai-provider-browser`: rendered card and Profile integration,
  confirmations, all provider switches, input clearing and duplicate submission.
  Uses an isolated Chrome profile and supports `CHROME_BIN`.
- `npx supabase test db`: local pgTAP suites, including real Vault lifecycle,
  caller isolation, all nine replacement combinations and injected rollback.

Local tests may apply the migration with `supabase migration up --local`. Remote
migration application and deployment are separate, explicitly authorised work.

Before exposing an AI feature, separately review endpoint authentication,
authorisation, rate limits/quotas, spending controls and product-specific output
validation. Stage 2B does not register an execution endpoint. Stage 2C registers only the
authenticated extraction route described below. Do not expose credential retrieval
to React. PDF extraction is described in Stage 2E-B below.

## Stage 2A: internal credential retrieval

`server/ai/credential.js` exports `retrieveAiCredential(validatedUserId)`, returning
only `{ provider, apiKey }` to its immediate trusted caller. An optional trusted
`signal` option is passed to the Supabase RPC builder via `abortSignal` when supported.
Cancellation and the lookup deadline request abort using safe internal errors;
no signal reason is returned. The actual RPC remains tracked until settlement,
even if it ignores abort; cancelled results are discarded. Obtain that canonical
UUID from confirmed authentication, never from request parameters. The module
creates an admin client solely to invoke `plannix_get_server_ai_credential(uuid)`;
it exposes no general-purpose admin client or table access. All failures become
fixed internal errors without upstream messages or causes. Retrieval retains the
shared 4096-character credential limit: generous for supported provider keys while
bounding malformed internal responses. There is no caching,
logging, disk storage, HTTP route or provider execution.

The RPC is in public solely for PostgREST discovery. Only service_role can execute
it; PUBLIC, anon and authenticated are explicitly denied. Its SECURITY DEFINER
boundary uses an empty search path and qualified objects to read the authoritative
personal mapping and Vault without granting application roles direct access.
Confirmed users, unique resolution, active status and matching last-four metadata
are required. Missing or inconsistent records fail closed.

Future adapters must use the returned credential only within the immediate
server-side operation, then release references. Never attach it to errors, request
references, responses, logs, analytics, caches or persisted jobs. JavaScript cannot
guarantee immediate erasure of immutable strings from memory. Stage 2A makes no
provider requests and exposes no browser endpoint. Stage 2B invokes it internally
as described below.


## Stage 2B: server-only structured JSON generation

Trusted server code calls `generateStructuredJsonForUser({ userId, systemPrompt,
userContent, jsonSchema, schemaName })` from `server/ai/generateStructuredJson.js`.
The user ID must originate from confirmed authentication; the module additionally
checks canonical UUID syntax. Prompts and schemas must originate in trusted server
code. Extra fields (including provider, model, destination and credential) are
rejected before credential retrieval or network activity.

Flow: validate and compile the schema → fresh Stage 2A lookup → registry-selected
adapter → bounded provider request → JSON parsing and local schema validation →
parsed value only. Future routes must call the orchestration service, never handle
keys or call the adapters/credential retriever directly. No general-purpose HTTP route or browser
import exposes this service; Stage 2C uses a fixed prompt/schema internally. No provider key, raw response, request headers or
provider error body reaches the browser. There is no key, prompt, result or schema
cache in Plannix; provider-side retention/caching is governed separately by the
provider. OpenAI requests explicitly use `store: false`.

### Official API contracts and fixed defaults

Re-audited against current official REST documentation on 2026-09-26. Model defaults live only in
`server/ai/generationConfig.js`; no environment overrides or new environment
variables are introduced. Defaults are code-reviewed choices, not claims about
account-specific model availability.

| Provider | Fixed endpoint | Authentication | Structured output | Model |
| --- | --- | --- | --- | --- |
| OpenAI | `https://api.openai.com/v1/responses` | `Authorization: Bearer …` | `text.format` with `type: json_schema`, `strict: true`, name and schema | `gpt-4.1-mini-2025-04-14` |
| Anthropic | `https://api.anthropic.com/v1/messages` | `x-api-key` | `output_config.format` with `type: json_schema` and schema | `claude-haiku-4-5-20251001` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/interactions` | `x-goog-api-key` | top-level `response_format: { type: "text", mime_type: "application/json", schema }` | `gemini-3.8-flash` |

Anthropic also requires `anthropic-version: 2023-06-01`; structured-output beta
headers are not required. OpenAI has no additional API-version header; Gemini's
API version is in its path. Keys never appear in query strings or request bodies.
Gemini now uses Interactions end-to-end. The prior implementation and report both
used Google's legacy GenerateContent contract; this was a contract-selection
mismatch with the current preferred API, not just a report typo. No live request
was made to establish whether the legacy path would still succeed.

Exact request and response contracts:
- OpenAI: POST Responses with `model`, `store: false`, system/user messages in
  `input`, `max_output_tokens`, and `text.format: { type: "json_schema", name,
  strict: true, schema }`. Accept only `object: "response"`, `status: "completed"`,
  no error/incomplete details. Walk `output` in order, ignoring documented `reasoning`
  items (rejecting an explicitly incomplete status). Require completed assistant
  messages and exactly one `output_text` block across their content. Never use
  fixed indexes or SDK `output_text`; refusal and unexpected item types fail closed.
- Anthropic: POST Messages with `model`, top-level string `system`, user `messages`,
  `max_tokens` and `output_config.format: { type: "json_schema", schema }`.
  Accept only an assistant `message`, `stop_reason: "end_turn"` and exactly one text
  block across `content`. Ignore documented `thinking` and `redacted_thinking`
  blocks before or after the result; reject other block types.
  Explicitly reject `stop_details.type: "refusal"` even with `end_turn`, as shown
  in the current REST reference. Extract the unique text block without concatenation.
- Gemini: POST Interactions with top-level `model`, string `input`, string
  `system_instruction`, `store: false`, `stream: false`, `response_format` as above,
  and `generation_config: { max_output_tokens: 4096, thinking_summaries: "none" }`.
  The current REST reference returns `object: "interaction"`, `status` and
  `steps[].content[]`, not GenerateContent `candidates`, old `outputs`, or SDK
  `output_text`. Walk steps in their documented chronological order, ignoring
  `thought` steps. Require exactly one text result across `model_output` content;
  reject other step/content types and ambiguous results. No tools/background jobs
  are requested. Tool steps remain unsupported rather than treating tool data as output.

All providers: refusal/non-JSON text, missing text and incomplete/truncated results
become `AI_INVALID_RESPONSE` without forwarding content. OpenAI refusal blocks,
Anthropic `refusal`/`max_tokens` stop reasons and Gemini non-completed statuses
(including `failed`, `incomplete`, `cancelled`, `requires_action`) are rejected even
if a text field happens to contain valid JSON. Google's current Interactions
reference has no separate documented refusal discriminator: failure status,
missing/non-text output or refusal prose are rejected; no invented refusal field
or semantic classifier is used.

Sources:
- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
  and [GPT-4.1 mini model](https://developers.openai.com/api/docs/models/gpt-4.1-mini).
- [Anthropic structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs),
  [Messages API](https://platform.claude.com/docs/en/api/messages/create) and
  [model IDs](https://platform.claude.com/docs/en/models/overview).
- [Gemini structured outputs and REST example](https://ai.google.dev/gemini-api/docs/structured-output)
  and [Interactions REST reference](https://ai.google.dev/api/interactions-api),
  including [chronological thought steps](https://ai.google.dev/gemini-api/docs/thinking).
- [OpenAI output collections](https://developers.openai.com/api/docs/guides/text) and
  [Anthropic thinking blocks](https://platform.claude.com/docs/en/build-with-claude/extended-thinking).

### Limits and validation

- 30-second provider deadline covers connection, response headers and streamed
  body reading; timeout aborts the request. No automatic retries.
- User content: 100,000 UTF-8 bytes; system prompt: 16,000 bytes.
- Serialized schema: 32,000 UTF-8 bytes, maximum traversal depth 20 and 2,048 nodes.
- Provider response: 1,048,576 bytes, checked against Content-Length and actual
  decoded stream bytes. The body is cancelled on failure. Output cap: 4,096 tokens.
- POST only, fixed HTTPS URLs, `redirect: error`, no cookies, no request cache.
  JSON Content-Type, valid UTF-8 and complete nonempty JSON output are required.
  Refusals, truncation, unexpected types and multiple eligible text results fail closed.

Ajv 8 is the only new direct dependency (no provider SDK). Each call creates a
strict synchronous JSON Schema validator with no logging, coercion, default
insertion or unknown-property removal. No async validators or remote schema
loading are enabled. Ajv alone accepts more than providers do, so a common-subset
check now runs before Ajv compilation, credential retrieval and fetch. Nothing is
silently transformed, dropped or weakened.

Supported common schema subset (deliberately smaller than any provider's dialect):
- Root object; nested objects and arrays; string, number, integer, boolean and null.
- Object `properties`, `required` containing every declared property exactly once,
  and mandatory `additionalProperties: false` on every object.
- Arrays with a single schema in `items` (no tuple schemas).
- Scalar nullable types written `["string"|"number"|"integer"|"boolean", "null"]`.
- Optional string `description`; string-only, nonempty `enum` on non-nullable
  strings, at most 100 distinct values per enum and 1,000 entries across the schema.
- At most five schema edges below the root, 100 total object properties and eight
  nullable fields, in addition to the byte/traversal limits above.

Before serialization, a bounded traversal counts every enum occurrence across
objects and arrays, including definitions/composition containers. Shared object
instances count separately at each occurrence, matching JSON serialization; an
ancestor WeakSet rejects cycles. Definitions and composition remain unsupported
and are rejected, not expanded or silently rewritten. Output property names
`__proto__`, `prototype` and `constructor` are rejected wherever `properties`
appears, including nested schemas and unsupported definitions. Ordinary similar
names remain valid. No prototype assignment or mutation is used.

All other constructs fail locally with `AI_CONFIGURATION_ERROR`, including refs,
definitions, recursion, anyOf/oneOf/allOf, conditionals, defaults, const, patterns,
formats, numeric bounds and string/array length or uniqueness constraints. This
avoids Anthropic's unsupported numeric/length constraints and OpenAI's optional
property restrictions. Dates are strings in the schema; Stage 2C performs the required domain-specific
date validation after generation without weakening the shared schema.
Ajv still validates every returned value without coercion, including exact enums,
required fields and unknown-field rejection. Schemas are passed unchanged.

### Safe errors

Only fixed messages, codes and retryability flags escape; never upstream messages,
response bodies, headers, prompts or error causes. There is no generation logging.
Existing server logging can receive the sanitized errors safely. Returned JSON is
also rejected if it contains the credential itself.

| Code | Retryable | Meaning |
| --- | --- | --- |
| `AI_CREDENTIAL_UNAVAILABLE` | No | Stage 2A lookup failed or credential metadata is invalid |
| `AI_CREDENTIAL_REJECTED` | No | Provider returned 401 or 403 |
| `AI_RATE_LIMITED` | Yes | Provider returned 429 |
| `AI_CANCELLED` | No | Trusted caller cancellation; no raw reason |
| `AI_TIMEOUT` | Yes | Provider deadline/abort |
| `AI_PROVIDER_UNAVAILABLE` | Yes | Network failure, 408 or 5xx; native fetch redirect rejection also fails safely here |
| `AI_INVALID_RESPONSE` | No | Invalid content, schema mismatch, refusal, truncation or observed redirect response |
| `AI_CONFIGURATION_ERROR` | No | Invalid trusted input/schema/provider or other provider 4xx |

Retryability is metadata for future trusted callers; Stage 2B never retries.
Stage 2A intentionally hides database diagnostic detail, so credential lookup
outages cannot currently be distinguished from missing connections.

### Stage 2B validation

`node --test server/ai/generation.test.js` exercises all adapters through the
orchestrator with synthetic credentials and mocked fetch/retrieval. The JSON
fixtures under `server/ai/fixtures/` reproduce documented REST envelopes with
synthetic IDs/content and appropriate model IDs; they are not captured provider
responses. Envelope/status mutations exercise refusal, truncation, missing output
and accidental use of another API's response shape. Native fetch
is blocked in these tests. Tests cover wire contracts, strict output validation,
limits, stalled fetch/body deadlines, status/error redaction, fresh retrieval,
credential echo rejection and source boundaries. `npm run test:server` includes
these tests. No live provider request is needed or made during validation.


Stage 2B hardening regression coverage includes aggregate enum boundaries (1,000 /
1,001), repeated/cyclic schema objects, dangerous property names, unique output
before/after reasoning, ambiguous/missing/unknown blocks, chunked ASCII and UTF-8
response overflow with cancellation, and UTF-8 boundaries for all three inputs.
All fixtures and transport calls are synthetic; no live provider requests are
part of these tests. Interactions remains Gemini's sole request/response contract.


## Stage 2C: authenticated pasted-text holiday suggestions

`POST /api/ai/holidays/extract` requires the existing confirmed Supabase bearer
user middleware. Only its `req.auth.userId` reaches Stage 2B; the body cannot
select a user, provider, model, destination, credential, membership or schema.
There is no unauthenticated variant. Authentication uses the existing request
boundary; no admin client is added to the route.

Accept `application/json` with exactly:
```json
{
  "text": "School closes after school on 23 October 2026 and reopens 2 November 2026.",
  "academicYearStartDate": "2026-09-01",
  "academicYearEndDate": "2027-08-31"
}
```
No query parameters. Only absent or `identity` Content-Encoding is accepted; all
compressed/multiple encodings are rejected with 415 before decompression or AI
work. The 64 KiB parser uses `inflate: false`. A grammar-validated token walk
rejects duplicate decoded JSON keys at every object depth, including escaped
equivalents, with safe 400 errors. It uses no new dependency and bounds nesting
to 100; repeated text values and keys in separate objects remain valid.
Text must be nonempty after trimming and no more than
50,000 UTF-8 bytes before trimming. The JSON body is capped at 64 KiB (escaped
JSON can hit this cap before the text limit). Dates must be real ISO calendar
dates from 1900 through 2200, in order and at most two calendar years apart.
Equal boundary dates are permitted. No saved academic-year ID is required.
Validation precedes generation, credential retrieval and provider activity.

A fixed server-owned prompt treats pasted instructions as untrusted data, forbids
following links or inventing dates, excludes ordinary events and weekends unless
explicitly part of a closure, and distinguishes after-school closure from the
first non-teaching day and reopening from the last holiday day. Prompt separation
is not a guarantee of model accuracy: all suggestions require later human review.
The fixed closed JSON Schema uses Stage 2B's common subset. Count, date and label
constraints unsupported by that subset are enforced independently after generation.

Success returns only `{"holidays":[{"label":"Autumn half term","startDate":"2026-10-24","endDate":"2026-11-01"}]}`
(or an empty array). Each entry has exactly those three fields; no IDs are
created. Maximum 100 entries and 200 trimmed label characters match Academic Year.
Labels reject Unicode control (Cc) and formatting (Cf) characters, including
zero-width/bidi controls, before normalization. NFC normalization, Unicode
whitespace collapse to ordinary spaces and edge trimming precede the nonempty/
200-character checks, return value and duplicate comparison. Ordinary international
letters and punctuation are retained; HTML/Markdown delimiters are rejected.
Dates must be real, ordered, inclusive and within the submitted boundaries.
Unknown keys, including prototype-related names, are rejected. Results sort by
start date, end date, then label using deterministic string comparison.
Exact duplicates after Unicode/whitespace normalization reject the entire response. Overlapping
ranges with different labels are preserved, never silently merged. Invalid
results never return a partial collection.

All responses after authentication are `Cache-Control: no-store`. Existing
request IDs/support-reference headers and sanitized error logging remain in use;
no pasted text, generated holidays, prompts, schemas, keys or upstream causes are
logged. Success contains no support reference in its body.

| Failure | HTTP status |
| --- | --- |
| Invalid fields/dates/text/JSON | 400 |
| Missing/invalid authentication, unconfirmed user | existing 401 / 403 |
| Unsupported content type / excessive JSON body | 415 / 413 |
| Missing/unusable AI connection | 409, directs user to Profile |
| Rejected provider credential | 422, asks user to reconnect in Profile |
| Rate limit | 429 |
| Provider/route deadline | 504 |
| Cancellation while a response remains connected | 409 |
| Provider unavailable | 503 |
| Invalid suggestions/provider output | 502 |
| Unexpected/configuration failure | existing sanitized 500 |

The route reuses the existing bounded, hashed user/IP rate-limiter factory with
an extraction-specific safe message: five accepted-to-limiter attempts per user
and per IP per 15 minutes, including failed/concurrent attempts. Local limits
supply `Retry-After`; Stage 2B does not expose provider headers, so provider 429s
have no invented retry interval. A per-user token lock rejects concurrent requests
with 409. Other users are independent except when sharing an IP's rate budget.

Each admitted extraction owns one AbortController and one per-user operation token.
Only actual operation settlement releases its operation-specific lock. A disconnect
or 35-second route timeout requests cancellation but does not release the lock;
a subsequent request stays blocked until settlement. Detached rejection is safely
observed, and disconnected responses never receive a later write. Stale cleanup
cannot delete another operation's lock.

The route passes an optional signal as a trusted second argument to Stage 2B,
never as browser-supplied configuration. Cancellation is checked before and after
credential lookup and immediately before provider fetch. Stage 2A attaches the
linked signal to Supabase RPCs where supported. The 30-second lookup deadline
requests abort but does not prove settlement or release the user lock. A cancelled
lookup result cannot start provider work. Stage 2B retains its 30-second deadline covering
fetch and body consumption. Cancellation aborts transport, cancels any response
body and returns `AI_CANCELLED`; internal deadlines return `AI_TIMEOUT`. Signal
reasons and upstream causes never escape. Expected client disconnects are not
logged as internal failures; route deadlines remain safe 504 errors.

Aborting transport cannot guarantee cancellation or reversal of provider work
already started or billed. No automatic retry occurs. A non-cooperative underlying
promise is observed even after cancellation/deadline, avoiding unhandled rejection.
HTTP response cancellation/deadlines may finish response handling earlier.
Credential and provider operations remain tracked until actual settlement,
including body cleanup. A non-cooperative dependency intentionally retains its
user lock until settlement; no timeout releases that lock early.

Authentication and input failures do not consume limiter entries. Every request
reaching the limiter increments separate hashed user and IP counters, including
concurrency rejections and provider failures. Windows begin at first use and last
15 minutes; rejected attempts do not extend them. Retry-After uses the latest
expiry of the exhausted counters only. Entries expire and the map is capped at
10,000 entries with oldest-entry eviction. Limits reset on restart/eviction and
are not shared between processes, so this is not a durable spending quota. A
shared limiter is required before multi-instance production rollout.

Set `TRUST_PROXY_HOPS` to the exact ingress hop count: default 1 when absent,
explicit 0 for direct connections, accepted integer range 0–10. Empty, negative,
fractional and excessive values fail startup. Zero ignores forged forwarding
headers. Do not trust all proxies; prevent direct/shorter ingress paths when
trusting proxy hops. The authenticated-user budget is the primary account-level
cost boundary even when IP attribution is imperfect.

Stage 2C performs no academic-year/holiday writes and creates no database IDs.
Only Stage 2A's credential read RPC is used indirectly. Stage 2D supplies the
Academic Year review interface described below. PDF uploads use the separate Stage 2E-B endpoint below.

Tests inject authentication verification and generation, use synthetic data, and
exercise real localhost Express requests only. External fetch is blocked before
importing the route/default generation service. Validation covers authentication,
strict bodies, semantic rejection, error redaction, rate/concurrency controls,
disconnect/stale completion and structural no-write boundaries.

## Stage 2D: Academic Year review interface

The Academic Year page separates **School holidays** (manual rows and AI review)
from **Public holidays** (existing location/country import, without AI). The additive `20260927090000_add_holiday_categories.sql` migration adds
`public.plannix_holidays.holiday_type`, NOT NULL with default `school` and a check
allowing exactly `school` and `public`. This is a category, not provider provenance.
Manual school and AI-reviewed additions are `school`; manual public additions and location imports are `public`.
Every existing holiday is backfilled as `school`; historical public holidays are not inferred.
The API exposes `holidayType` and both sections filter on that persisted value.

The import component reads safe metadata from `GET /api/ai/connection`. It displays
the approved provider label, not a key. Disconnected users see Profile guidance;
metadata failures have an explicit retry. Conditional rendering is not authorization:
the confirmed-authentication Stage 2C endpoint remains authoritative.

`holidayExtractionApi.js` sends an authenticated, non-cached POST containing exactly
`text`, `academicYearStartDate`, and `academicYearEndDate`. It checks the 50,000 UTF-8
byte limit and real date bounds before obtaining a session, rejects malformed result
shapes, and converts failures into fixed safe messages. Only the known public
missing-connection message distinguishes that 409 response from an in-progress
request. Support references are canonical UUIDs; numeric Retry-After is shown on
429 responses. There are no automatic retries. No browser code imports the internal
server generation/credential modules or retrieves a decrypted credential.

Pasted text and suggestions live only in component state. Cancellation, unmount,
year switching and date changes abort pending extraction and ignore late results.
A replacement extraction discards the previous review; date edits retain pending
review edits and revalidate their range. Nothing enters the draft on extraction.
“Add selected holidays” validates every included row before making one draft update;
“Save academic year” remains the only database save. Discarding suggestions does
not alter existing draft rows. Manual rows are checked for real dates and ordered
ranges before normalization as well, so invalid/reversed dates are not silently
repaired on save.

Duplicates compare NFC-normalized, whitespace-normalized, case-insensitive labels
and exact dates across both categories, including duplicates within the selected suggestions. Skipped
counts are announced. Differently labelled overlapping holidays remain separate;
no existing row is overwritten. The combined draft cannot exceed 100 holidays.
Reviewed rows use the existing client holiday ID generator only after validation.
Manual public holidays need no location lookup and explicitly use the public category.
Both holiday lists start collapsed and reset on year selection; their independent
visibility is component state only. Adding rows opens the relevant list, with manual
and AI additions focusing the new label. Hidden rows remain in validation and Save;
invalid rows are revealed, and save failures reveal both lists without discarding edits.

Tests use synthetic calendar text and mocked APIs, with native browser fetch blocked
before fixture module evaluation. The rendered fixture exercises the actual page,
review, combined save, independent public import, safe failures, cancellation,
focus and 320/375/390/430/820/1366px layouts. The browser runner additionally uses
real Chrome keyboard input to activate extraction. It never contacts an AI provider.

### Persisted holiday categories

Both categories still use one complete holiday array and the existing six-argument
`public.plannix_save_academic_year` SECURITY INVOKER RPC. The additive migration
replaces its body without changing its signature, ownership checks or RLS. It revokes unnecessary TRUNCATE, TRIGGER and REFERENCES table privileges from PUBLIC, anon and authenticated, retaining authenticated CRUD.
It validates explicit `holiday_type` values, stores them on insert/update and keeps
reconciliation atomic. Omitted categories default to `school` only on new rows; existing rows retain their stored category. The server forwards omission to the RPC without a racy read-before-write. Explicit null and unknown
values fail, including through direct table writes. No provider provenance is stored.

The existing authenticated GET reads `holiday_type` with the holiday ID/name/dates;
there is no separate load RPC. Browser normalization and save/reload mapping retain
`holidayType`. Both categories continue to close timetable days. Combined limits,
review-before-add and explicit Save academic year remain unchanged. Public holidays
have their own editable rows and remove controls; the shared normalized duplicate key spans both categories in the browser and server, with equivalent NFC/whitespace/lowercase/date validation in the atomic RPC. Differently labelled overlaps remain permitted. Public imports own an AbortController passed through public-holiday and country-resolution fetches. Year, boundary, location, replacement and unmount changes abort transport; scope checks still reject non-cooperative stale successes/errors. New public rows receive focus after import; duplicate-only results focus the live status summary.

Apply the additive migration before deploying the updated server/client. It does not
infer which historical rows came from public-holiday imports. Existing public holidays
without historical category data will initially appear under School holidays.
The local pgTAP suite covers the categories and legacy compatibility alongside the
existing role, organisation, year-isolation and rollback checks. Remote migration
application is a separate operation and is not part of Stage 2D implementation.

Local upgrade regression: `node scripts/test-academic-year-migration.js` executes
the actual category migration against pre-category fixtures in a rollback-only
transaction on the verified local Supabase container. The runner rejects non-Unix
Docker endpoints and contexts, checks the socket, running container ID, project and
repository labels, and pins subsequent commands to the verified endpoint/container.
It accepts only a completed 17-assertion TAP result, not merely a zero exit code.
`node --test scripts/test-academic-year-migration.test.js` covers refusal paths and
strict TAP parsing using safe command stubs. No credentials or raw Docker errors
are printed.
The complete local pgTAP suite remains `supabase test db --local`.

## Stage 2E-A: internal PDF text extraction

`server/pdf/extractTextFromHolidayPdf.js` exposes
`extractTextFromHolidayPdf({ data, signal })` to trusted server code only. `data`
must be an in-memory Buffer/Uint8Array; paths, URLs, filenames and additional
options are rejected. The result contains only `{ text, pageCount }`. The parser itself has no HTTP or provider integration. Stage 2E-B now composes
it with authenticated extraction and review (below). Raw PDFs are never sent
to a provider; only bounded extracted text is submitted. No database changes
are needed, and review before save remains required.

Limits in `server/pdf/pdfConfig.js` are 10 MiB input, 50 pages, 50,000 normalized
UTF-8 text bytes (shared with Stage 2C), 10 seconds and a 128 MiB V8 old-generation
worker limit, with 16 MiB young-generation and 4 MiB stack limits. Text traversal
also stops at 100,000 items or 1,000,000 raw text bytes. Limits reject rather than
truncate. The V8 limits are **not an overall RSS/ArrayBuffer limit or an OS
sandbox**. A worker isolates JS exceptions, hangs and V8 heap exhaustion from
the Express event loop; it cannot guarantee containment of a native runtime
crash or system-wide memory exhaustion. Before exposing uploads, deployment
must additionally bound concurrent requests and process/container memory.
Decompression-bomb containment is not absolute: V8 heap limits do not bound every
native or ArrayBuffer allocation, and JavaScript monkey-patching is not an OS sandbox.

Each call copies and transfers its own input to a fixed local worker, with an
empty environment and no inherited Node preload flags. PDF.js runs inside that
worker using its local loopback worker implementation. Network, shell and file
write entry points are blocked; parser resource factories reject external
resources. Module loading reads installed code, but no PDF is written to disk,
retained in temporary files or cached. Worker console output is discarded;
parser errors and abort reasons never enter returned errors. Parent messages
are strictly validated, including duplicate/early/nonzero-exit rejection. Every
outcome clears timers/listeners and awaits worker termination. Stream cancellation
and document destruction each have a referenced 250 ms cleanup timer. Rejections
are observed even if the bound wins; an unresolved PDF.js cleanup promise cannot
leave the top-level worker await without a live handle. Cleanup completion is not
required indefinitely before the single terminal response and worker exit.
A referenced worker watchdog also bounds unresolved parser promises. Detached
parser rejections/exceptions trigger a controlled failure race; the scoped fault
listeners last only for the disposable worker lifetime, including late cleanup
callbacks. They never change the main server process exception or stderr handling.
Cancellation wins if it arrives before settlement.

Page text is extracted in order, with blank lines separating pages. Newlines
are normalized, NULs removed, Unicode normalized to NFC, repeated whitespace
collapsed and other control/format characters rejected. No OCR, rendering,
annotations, hyperlinks, actions, attachments or document metadata are exposed
or interpreted. Missing text produces a scanned-document-friendly error.
Encryption is rejected, including empty-password encryption. Signature/EOF
checks and strict parser error handling reject detected invalid/incomplete documents.
PDF.js can recover and accept some malformed documents, including inaccurate stream
lengths; these checks are not comprehensive conformance validation.
The pinned parser's cross-reference recovery diagnostic also causes rejection
instead of silently accepting a repaired xref (covered by a real-parser test);
this is text extraction, not a general PDF conformance validator. Extracted text
order follows PDF.js and may not match visual reading order. Scanned pages require
OCR, which this module does not provide.

Errors have fixed messages and codes: `PDF_INVALID`, `PDF_TOO_LARGE`,
`PDF_ENCRYPTED`, `PDF_TOO_MANY_PAGES`, `PDF_NO_TEXT`, `PDF_TEXT_TOO_LARGE`,
`PDF_TIMEOUT`, `PDF_CANCELLED`, `PDF_PROCESSING_FAILED`. Only timeout and unknown
processing failure are marked retryable internally. Stage 2E-B maps these codes
to fixed safe HTTP statuses/messages in the authenticated PDF route; parser
diagnostics are never forwarded.

### Parser and deployment prerequisite

The pinned dependency is `pdfjs-dist@6.3.289`, using Mozilla's
[documented Node legacy build](https://github.com/mozilla/pdf.js/blob/master/examples/node/getinfo.mjs).
Its engine requirement is Node `>=22.13.0 || >=24`. Plannix now requires Node
**24.x** for local development, tests, builds and deployment through the root
`engines.node` and lockfile metadata; validation uses Node 24.12.0. DigitalOcean's
current Node buildpack supports 24.x and reads this engine declaration. Confirm
the selected runtime in deployment logs; no deployment occurs in this stage. The
modern build requires JS APIs unavailable in this tested Node release; the
legacy build supplies the compatibility polyfills.

PDF.js provides direct byte input, streamed page text, `stopAtErrors`, disabled
XFA/Wasm/worker resource fetching, and replaceable resource factories; see its
[official API reference](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html).
This version does not expose the historical `isEvalSupported` setting. The
worker disables global eval/Function after trusted module initialization and
never evaluates PDF actions. The historical
[PDF.js JavaScript-execution advisory](https://github.com/mozilla/pdf.js/security/advisories/GHSA-wgrm-67xf-hhpq)
reinforces the need to maintain the pinned parser and these boundaries.

The only added direct dependency is PDF.js. It has no install lifecycle
scripts. Its optional dependency is `@napi-rs/canvas@1.0.9`, plus platform binary
packages recorded in the lockfile; locally only the Darwin x64 binary was
installed. The legacy build imports canvas for compatibility even though this
flow never renders. These packages have no installation hooks; the install
used `--ignore-scripts`, with no native compilation. Canvas's package includes
maintainer build/publish scripts, which were not executed. The installation
and subsequent npm audit reported zero vulnerabilities. Existing dependency
versions were unchanged. The root prepare command was subsequently hardened as
described below, without adding a new install lifecycle stage.

`pdf-parse@2.4.5` was rejected because it adds another abstraction, pins older
PDF.js 5.4.296 and requires canvas; `pdfreader` adds a pdf2json abstraction with
less direct control over the PDF.js security/resource boundary. No second PDF
generator was installed: tests hand-build synthetic objects, xrefs, image data
and encrypted fixtures. Tests block networking before loading PDF modules,
exercise real extraction and controlled worker failures, and check that no
browser imports expose the module. Only the authenticated server extraction
route composes the parser with generation. A worker thread remains defence in
depth, not an adversarial-code security sandbox.

### Installation and lifecycle regression coverage

The root prepare command is `node scripts/setup-git-hooks.js`. Production installs
(`NODE_ENV=production`, npm production mode, or `npm_config_omit` containing `dev`)
skip hook setup before importing any dev dependency. Development installs use
`simple-git-hooks`' exported `setHooksFromConfig` API, retain the existing Gitleaks
pre-commit command, and fail with a fixed safe error when setup fails. No dynamic
download or npx invocation is used. Clean install verification uses disposable
directories and an isolated Git repository, never the working repository's hooks.

The permanent lifecycle probe runs real worker threads in an isolated test process
and captures that process's stdout/stderr. It repeats valid, malformed, 120,000
compressed text-operation, active-cancellation and actual ten-second-timeout cases.
A test-only reader observer establishes that page parsing has begun before
cancellation; the timeout case deliberately stalls that real worker. Assertions
check one controlled stress-error message, clean stress exit, native termination,
subsequent valid extraction and no remaining MessagePort/Timeout resources.
The worker stress fixture currently returns safe `PDF_PROCESSING_FAILED`; parser
implementation details are never used as a public diagnostic. This supplements,
rather than replaces, the protocol/race tests using controlled doubles.


## Stage 2E-B: authenticated PDF holiday review

`POST /api/ai/holidays/extract-pdf?boundaryStart=YYYY-MM-DD&boundaryEnd=YYYY-MM-DD`
accepts raw `application/pdf` bytes with the existing confirmed-user bearer
session. Authentication, exact query/date validation and media checks precede
the route-scoped raw parser. Compressed bodies, empty bodies, unexpected or
repeated query parameters and inputs over exactly 10 MiB are rejected. The byte
limit also applies to chunked requests. No filename is required or accepted as
a query parameter. Other routes retain their existing JSON parsers.

The HTTP result is exactly `{ holidays: [{ label, startDate, endDate }], pageCount }`.
PDF bytes and extracted text are never returned to the browser or persisted.
It contains no source text, filename, credential, provider/model metadata or
parser diagnostics. The server calls the existing fixed prompt/schema generator
and semantic validator directly, using only the authenticated UUID. No internal
HTTP call or academic-year write occurs.

Both extraction routes share one five-attempt user/IP limiter (15 minutes) and
one per-user operation-token lock in the registration instance. A valid request
that fails PDF parsing consumes one attempt. Basic malformed/auth failures do
not consume an attempt. Local attempt-limit errors remain distinct from provider
rate-limit errors. These controls are per process; shared quotas are required
before horizontal scaling. They do not provide a global worker/memory quota.

The PDF route has a 45-second HTTP response deadline; pasted text retains 35 seconds.
The independent 10-second PDF deadline and provider/credential deadlines remain.
One AbortSignal propagates through parsing and generation, including credential
lookup and transport. Disconnect or timeout aborts the work; the operation's
settlement alone releases its token. Non-cooperative late results/rejections are
observed and discarded. Cancellation cannot reverse already billed provider work.
The response deadline begins after bounded request-body reception; upstream
HTTP infrastructure must continue to enforce upload/connection time limits.

PDF bytes and extracted text exist only in request/worker/generation memory;
references are released on settlement, without logging, caching or persistence.
Raw parser failures use the existing sanitized error middleware, which logs only
safe request metadata, never bodies/Buffers or error causes. Success responses
are `no-store`; support references are displayed only alongside errors.

The existing School Holiday AI component offers keyboard-operable Paste text and
Upload PDF buttons only with an active connection. The browser sends the File
itself, never parses it, and displays its name only locally. It clears selection
on success, failure, cancellation, year/boundary/mode changes and unmount. Scope
changes invalidate pending operations even if a transport ignores cancellation.
PDF suggestions enter the same editable review, cross-category duplicate check,
combined 100-holiday limit and school-only draft addition. Only Save academic year
persists changes. Manual holidays and public location imports remain independent.
No OCR, PDF storage, new migration, provider call in tests or browser PDF.js import
is introduced. Tests use synthetic PDFs and explicitly mocked generation/fetch.

### Response deadlines and actual operation settlement

The extraction route keeps two promises: `responsePromise` may finish promptly
on disconnect/deadline, while `operationSettlementPromise` owns the per-user
lock. Only the latter's `finally` releases its operation-local token. Tracked
work and lock cleanup receive no Express request/response objects. Request body
references are removed as work starts; PDF references are dropped after parsing
and source text is cleared on final settlement.

`runOperationToSettlement` replaces the former cancellation race. It passes a
linked AbortSignal to the Supabase RPC, requests abort at the existing 30-second
credential deadline, and still awaits the actual RPC. Generation awaits this
lookup directly and checks cancellation before using its result. Provider
transport likewise awaits actual fetch/read settlement and body cancellation
cleanup, including non-cooperative test dependencies. No late credential can
start a provider request after cancellation. The existing provider deadline,
10-second PDF deadline, 35-second text response deadline and 45-second PDF
response deadline remain unchanged.

A dependency that ignores abort can retain the user's lock indefinitely until
it actually settles; there is deliberately no unsafe lock-release timeout.
Responses still end promptly at the route deadline. Late failures are observed,
raw errors are discarded, and stale response events cannot release newer work.


### Shared holiday-label validation

`shared/holidayLabel.js` contains the environment-neutral rules used by server
semantic validation, browser text/PDF response validation and manual/review row
validation. It rejects non-strings and Unicode Cc/Cf characters before any
normalization (including ASCII controls, tabs/newlines and zero-width format
characters). Valid strings are NFC-normalized, Unicode White_Space runs become
one space, and surrounding whitespace is trimmed. Empty results, more than 200
UTF-16 code units, and the existing forbidden characters `<`, `>`, backtick,
asterisk and square brackets are rejected. This preserves the authoritative
server behaviour, rather than stripping unsafe content into an accepted label.
Both browser APIs reject the entire collection if any suggestion is invalid and
return normalized labels only after validation. Errors never include the rejected
label. React continues to render text; additions remain draft-only until Save
academic year. No OCR, PDF persistence or additional database write is introduced.
