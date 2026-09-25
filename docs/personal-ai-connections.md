# Personal AI connections — phase one

Profile stores one personal connection for OpenAI (`openai`), Anthropic
(`anthropic`) or Google Gemini (`google_gemini`). Connection status means the key
has been stored, not that a provider has validated it. There are no outbound AI
requests in this phase.

## Boundaries

- `shared/aiProviders.js` contains browser-safe IDs, labels and the key length
  limit. `server/ai/providers.js` is the server registry of future adapter
  identities, all with execution disabled. Neither accepts custom destinations
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
trigger. No RPC returns a secret ID or plaintext key.

## Validation and future work

- `npm run test:ai-connection`: client API and authenticated server contracts.
- `npm run test:ai-provider-browser`: rendered card and Profile integration,
  confirmations, all provider switches, input clearing and duplicate submission.
  Uses an isolated Chrome profile and supports `CHROME_BIN`.
- `npx supabase test db`: local pgTAP suites, including real Vault lifecycle,
  caller isolation, all nine replacement combinations and injected rollback.

Local tests may apply the migration with `supabase migration up --local`. Remote
migration application and deployment are separate, explicitly authorised work.

Before an AI feature ships, implement and review actual server-only OpenAI,
Anthropic and Gemini adapters behind a provider-neutral interface. Add a narrowly
scoped server credential retrieval path, fixed provider destinations,
server-controlled models, timeouts, rate limits/quotas, response validation and
provider-specific failure tests. Do not expose credential retrieval to React.
This phase deliberately supplies no pretend adapter and no execution endpoint.
