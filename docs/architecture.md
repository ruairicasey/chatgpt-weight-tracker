# ADR 001: simplified single-owner architecture, $0 additional cost

Status: owner-approved two-service plan, 10 November 2026 (Australia/Melbourne).
Supabase authentication implemented for review; no hosted accounts, configuration,
migrations or deployments have been performed. Auth0 and Descope are removed from
the selected architecture. Earlier phase documents are historical records.

## Services and cost boundary

- Vercel Hobby: one Next.js App Router application for dashboard, login, consent
  and stateless `/mcp`. Use the provider hostname. Personal/non-commercial use.
- Supabase Free: PostgreSQL, dashboard authentication and managed OAuth 2.1 server.
- Existing ChatGPT Plus: conversational tool invocation; no additional model API.

Additional operating cost must remain $0 indefinitely. No payment methods, paid
plans, trials, usage billing, add-ons, domains, paid APIs or automatic upgrades.
Quota exhaustion means refusal/downtime. If free terms change, stop or migrate.
An environment literal cannot establish a hosted account's billing status.

Supabase Free currently includes 500 MB PostgreSQL, 50,000 MAU, 5 GB egress and
pauses inactive projects after one week. Accept manual resumption. Vercel Hobby
quotas can cause downtime. Cold starts are acceptable; instances are disposable.
No paid keep-alive, Redis, background workers or connection registry is required.
Use existing local storage for exports before migrations and weekly once data
exists. Free is not a guarantee of unlimited capacity or future vendor terms.

## One identity and one authorized client

One Supabase owner UUID is both the authenticated subject and internal user ID.
One pre-registered ChatGPT OAuth client has full application permissions for that
owner. No external identity-linking table, custom OAuth server or role catalogue.
Public signup is disabled. Supabase manages passwords, codes, PKCE and refresh.
Next.js supplies only login and consent UI using the official Supabase libraries.

OIDC scopes (`openid`, `email`, `profile`, `phone`) describe identity access, not
tracker CRUD. `/mcp` requests only `openid`; its internal tracker permission
vocabulary remains a server policy, never an invented Supabase custom scope.
Consent describes read/create/correct/delete access, although this phase exposes
only synthetic probes. No health data is used in this phase.

MCP verifies the configured issuer, canonical resource audience, pinned asymmetric
algorithm, JWT access-token claims, approved client, owner, expiry and issuance.
Normal dashboard tokens and ID tokens cannot authorize MCP. Owner UUIDs are never
accepted from tool arguments. JWKS requests are bounded, cached and restricted to
the configured Supabase project. No service-role key or database password is used.

## Fixed resource audience

A PostgreSQL Custom Access Token hook sets the MCP URL as `aud` only for the
approved client's owner tokens. It preserves required claims and dashboard
sessions. A private operator settings row contains the client UUID, owner UUID
and canonical URL; no real values are committed. Unknown clients retain the
normal audience and fail MCP checks. Missing settings fail closed for OAuth.

This is fixed one-client/one-resource binding, not a general RFC 8707 server.
Whether actual ChatGPT authorization, token exchange and refresh work with this
binding must be proven live. Whether the custom-audience token is accepted by
Supabase's database API and RLS is a separate live gate. Never remove audience or
owner validation to pass either gate. See the setup/acceptance runbook.

## Transport and storage

Reuse official MCP SDK v2 2.4.0 Fetch-compatible stateless Streamable HTTP in the
Node App Router route. It supports tested modern 2026-07-28 envelopes and legacy
2025-03-26, 2025-06-18 and 2025-11-25 negotiation/finite SSE. No SDK v1 adapter.
Keep existing body/method/origin restrictions, per-instance request limits, fresh
request principals, mutation annotations and disabled-by-default activation.
The synthetic experiment expires within 24 hours. Its ten bounded in-memory slots
and receipts expire after ten minutes or runtime loss. They are not durable.

Future tracker runtime access should use Supabase's HTTPS data API with verified
user tokens and RLS, after compatibility is established. Drizzle can define schema
and reviewed migrations. No privileged application key or pooled Node connection
is needed initially. Atomic RPC mutations will commit data and durable operation
receipts together. A replay with a different payload must conflict.

Start with food entries, weigh-ins, exercise sessions and operation receipts.
Enforce ownership in RLS with both USING and WITH CHECK. Unique owner/date for
weigh-ins. Use DATE for Melbourne days and TIMESTAMPTZ for actual instants; test
DST boundaries. Corrections/deletions check ownership and expected record revision.
Add targets later with effective dates, never silent historical overwrites.

## Release boundary

This change supplies authentication code and its SQL migration only. It does not
apply the migration, configure credentials, enable MCP or implement tracker data.
The next separately approved step is a short hosted synthetic OAuth experiment.
Only after it passes should tracker CRUD and a simple dashboard be implemented.
No unauthenticated fallback and no return to the historical Phase 0 server.

Sources and exact setup: [Supabase authentication](supabase-authentication.md).
