# Personal AI connections and internal generation

Profile stores one personal connection for OpenAI (`openai`), Anthropic
(`anthropic`) or Google Gemini (`google_gemini`). Connection status means the key
has been stored, not that a provider has validated it. Connection management makes
no provider requests. Stage 2B provides internal generation. Stage 2C exposes only authenticated
pasted-text holiday suggestions, with no browser UI yet.

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
to React. PDF handling is not implemented.

## Stage 2A: internal credential retrieval

`server/ai/credential.js` exports `retrieveAiCredential(validatedUserId)`, returning
only `{ provider, apiKey }` to its immediate trusted caller. An optional trusted
`signal` option is passed to the Supabase RPC builder via `abortSignal` when supported.
Cancellation and the bounded lookup deadline are safe internal errors; no signal
reason is returned. Non-cooperative lookup settlement is observed and discarded. Obtain that canonical
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
property restrictions. Dates can be strings; future domain-specific date checking
belongs in the future feature, not a weakened schema or Stage 2C implementation.
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
Only settlement of that exact generation promise releases its lock. A disconnect
or 35-second route timeout requests cancellation but does not release the lock;
a subsequent request stays blocked until settlement. Detached rejection is safely
observed, and disconnected responses never receive a later write. Stale cleanup
cannot delete another operation's lock.

The route passes an optional signal as a trusted second argument to Stage 2B,
never as browser-supplied configuration. Cancellation is checked before and after
credential lookup and immediately before provider fetch. Stage 2A attaches the
signal to Supabase RPCs where supported; non-cooperative lookups are bounded and
cannot start a provider request after cancellation. Lookup waiting has a 30-second
bound. Stage 2B independently retains its own 30-second provider deadline covering
fetch and body consumption. Cancellation aborts transport, cancels any response
body and returns `AI_CANCELLED`; internal deadlines return `AI_TIMEOUT`. Signal
reasons and upstream causes never escape. Expected client disconnects are not
logged as internal failures; route deadlines remain safe 504 errors.

Aborting transport cannot guarantee cancellation or reversal of provider work
already started or billed. No automatic retry occurs. A non-cooperative underlying
promise is observed even after cancellation/deadline, avoiding unhandled rejection.
The production orchestrator settles within its cancellation/deadline protections;
a test-injected generation function that ignores them deliberately keeps its lock
until it settles rather than permitting overlapping operations.

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
Only Stage 2A's credential read RPC is used indirectly. There is no Academic Year
browser UI, PDF handling or upload endpoint. Stage 2D is planned to provide a
review-before-save workflow; it is not implemented here.

Tests inject authentication verification and generation, use synthetic data, and
exercise real localhost Express requests only. External fetch is blocked before
importing the route/default generation service. Validation covers authentication,
strict bodies, semantic rejection, error redaction, rate/concurrency controls,
disconnect/stale completion and structural no-write boundaries.
