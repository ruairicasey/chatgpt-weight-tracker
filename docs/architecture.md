# ADR 001: Phase 1A foundation with a hard zero-cost boundary

Status: approved architecture; Phase 1A scaffold implemented, integrations planned.

Update: [ADR 002](phase-1b1-authentication.md) records Phase 1B.1's implemented
server-only authentication helpers and the current transport recommendation.
It supersedes the tentative v1 transport sketch below. MCP remains disabled;
all hosted integrations and Phase 1B.2 still require separate approval.
Decision date: 9 November 2026 (Australia/Melbourne).

## Context and evidence

[Issue #1](https://github.com/ruairicasey/chatgpt-weight-tracker/issues/1) originally
described authenticated connectivity and durable storage.
[PR #2](https://github.com/ruairicasey/chatgpt-weight-tracker/pull/2) implements a
smaller disposable probe. The owner subsequently verified actual unauthenticated
MCP reads/writes on ChatGPT Plus, replay of an identical operation, and readback
from a new chat with the same server receipt and instance ID.

This proves account-specific write execution, not OAuth or database persistence.
PR #2 remains a separate historical change; Phase 1A starts from main and retains
its latest snapshot under references/phase0 without merging that PR.

## Non-negotiable operating budget

Additional operating costs must be **$0 indefinitely**. No paid services, trials,
usage billing, paid domains, payment methods, paid add-ons, automatic upgrades or
additional model APIs. Existing ChatGPT use does not authorize new API spending.
Use provider hostnames and ongoing Free/Hobby plans, not promotional credits.

Quota exhaustion means bounded failure, read-only operation or downtime, never
an upgrade. If a provider changes its terms, stop the affected functionality and
evaluate a free migration. No hosted provider guarantees unchanged free terms,
unlimited capacity or uninterrupted service forever. Budget alerts do not prevent
billing: the primary control is never enabling a billable subscription.

Before any separately approved infrastructure step, verify the live plan and
entitlements. A config literal cannot inspect or guarantee a provider's billing
state. Tests here enforce our supported policy, not third-party account settings.

## Selected service topology

| Service | Planned responsibility | Cost boundary |
| --- | --- | --- |
| Vercel Hobby | One Next.js deployment for dashboard and MCP route | Free subdomain; no additional usage purchases; personal/non-commercial terms apply |
| Supabase Free | PostgreSQL, RLS and dashboard Auth | One hosted project initially; no paid branching, backups or add-ons |
| Auth0 Free | Managed MCP OAuth | Standard provider domain, Free entitlements only; no trial-dependent feature |
| Existing owner storage | Encrypted database exports | No purchased storage; never GitHub or public artifacts |

Sources reviewed during architecture planning:
[Vercel Hobby](https://vercel.com/docs/plans/hobby),
[Vercel pricing](https://vercel.com/pricing),
[Supabase pricing](https://supabase.com/pricing),
[Auth0 pricing](https://auth0.com/pricing), and
[Auth0 MCP Free availability](https://auth0.com/blog/adding-ui-auth0-secured-mcp-server-skybridge/).
Recheck before provisioning. Auth0 must be tested on actual Free entitlement,
not merely during an initial trial.

A separate always-on Node host is no longer selected. Cloudflare Workers Free is
possible but introduces another runtime adaptation and a tighter CPU allowance;
it does not reduce the number of providers for this stack.

Supabase OAuth would reduce the provider count, but its current custom-scope
limitations and unverified complete resource-indicator flow prevent treating it
as a drop-in replacement. Its token hook alone does not prove MCP interoperability.
Do not weaken audience validation or authorization to remove Auth0.

## Phase 1A implemented boundary

- Strict TypeScript pnpm workspace and exact dependency versions/lockfile.
- Next.js App Router landing shell with no private data, login or logging UI.
- Strict Zod operation/configuration contracts and sanitized configuration errors.
- Opaque verified identity/principal types and future service interfaces.
- Drizzle/Postgres type boundary only: no driver construction or connection.
- `/mcp` returns 503 `INTEGRATION_NOT_CONFIGURED` for supported methods; it
  registers no tools and accepts no token as authenticated.
- Package/client-server boundary checks, synthetic unit/type/browser tests and CI.

No OAuth SDK setup, credentials, account linking, schema, migrations, RLS policies,
tracker services, external resources, deployment or ChatGPT connection is supplied
by Phase 1A. Phase 1B requires separate approval. Tailwind, shadcn/ui and Recharts
remain planned for the actual dashboard; this shell does not implement it.

## Packages and dependency direction

| Package | Responsibility | Allowed internal dependencies |
| --- | --- | --- |
| contracts | Zod inputs/outputs, identifiers, errors and scope vocabulary | none |
| config | Explicitly supplied, validated zero-cost foundation configuration | contracts |
| auth | Verified identity/principal types and verifier/resolver interfaces | contracts |
| domain | Application use-case and atomic mutation boundaries | auth, contracts |
| db | Drizzle/Postgres types and future persistence implementation | domain |
| web | Next.js routes and UI; later HTTP/auth adapters | all, server-side restrictions apply |

No shared package depends on the web app. Client components may reach contracts,
but not auth, config, domain or db, even through a relative intermediary. The
boundary scanner inspects imports/re-exports, literal dynamic imports and require
calls, detects undeclared workspace dependencies and rejects package escapes.
This is a guardrail, not a sandbox for malicious code: computed imports and other
deliberate bypasses remain prohibited and require code review.

Package exports currently point to TypeScript source, intended for Next's build
and the workspace tooling; they are not published packages or standalone JS builds.

## Planned serverless MCP adapter (Phase 1B)

Use the official MCP TypeScript SDK through a Node-runtime Next.js route with a
fetch-compatible Streamable HTTP adapter. No permanent Express listener, watcher,
global session registry or process-owned records. Begin with stateless HTTP and
JSON responses, since logging needs no long-lived SSE subscription.

Initialize request-local transport/auth context and use PostgreSQL for every
authoritative record and receipt. Await database commit before returning success;
do not depend on background work completing after a function returns. Discovery
documents are public and contain no personal data; all personal tools require OAuth.
Keep the 503 placeholder until authenticated integration is implemented and tested.

Vercel supports streaming and bounded Node function execution. Cold starts, JWKS
fetches and database connection time add latency. Tools must complete in seconds,
use bounded timeouts and return honest retryable failures. A lost response after
commit must be recoverable using the same durable operation key.

Use a small Supabase transaction-pooler connection pool, transaction-local identity
context, TLS verification and the selected driver's required prepared-statement
settings. Never depend on session state persisting between function invocations.

Sources: [OpenAI MCP](https://developers.openai.com/api/docs/guides/custom-mcp-server),
[SDK](https://github.com/modelcontextprotocol/typescript-sdk),
[Vercel duration](https://vercel.com/docs/functions/configuring-functions/duration),
[Supabase connections](https://supabase.com/docs/guides/database/connecting-to-postgres).

## Planned authentication and owner onboarding (Phase 1B)

Auth0 is the MCP authorization server; Supabase Auth handles dashboard login.
Prefer one pre-registered third-party ChatGPT OAuth client initially; open dynamic
registration is unnecessary for a single owner. Use authorization code + PKCE
S256, exact redirect allowlisting, state and resource-bound access tokens. Enable
Auth0 Resource Parameter Compatibility and issuer identification responses.

1. Establish the stable free provider hostname and exact canonical MCP resource.
2. Configure the API audience and explicit client grant in Auth0 Free.
3. Publish protected-resource metadata pointing to the exact issuer; use its
   managed authorization/token/JWKS endpoints, not a custom OAuth implementation.
4. Copy the callback shown by ChatGPT, never a guessed or wildcard callback.
5. Test the proposed static-client token exchange, PKCE, consent and refresh on
   actual Free entitlements. Configure credentials only after separate approval.
6. Verify signature, allowed algorithm, issuer, audience, expiry/not-before,
   approved client and required permission before any database access.
7. Resolve the verified issuer/subject through an explicit enabled identity map.

Planned application scopes: tracker:read, entries:write, entries:delete and
targets:write. Reject ID tokens, dashboard tokens at the MCP endpoint, other
audiences, unmapped subjects and missing permissions. Do not fetch keys from a URL
chosen by an incoming token. Missing/invalid tokens produce proper OAuth challenges;
insufficient scope must not become anonymous execution.

Provision one owner and explicitly map their Supabase UUID and verified Auth0
issuer/subject to one internal profile. Disable public signup. Matching emails are
not proof of ownership. No tool accepts an acting user ID or manages identity maps.
Verified principal brands are compile-time boundaries only, not cryptographic
verification; no runtime verifier exists yet and type assertions must not mint one
outside the future trusted authentication implementation.

No application confirmation loop for a clear meal-logging request. Preserve honest
write/delete annotations and accept platform-mandated confirmations; OAuth consent
does not promise unattended execution.

Sources: [OpenAI OAuth](https://developers.openai.com/plugins/build/auth),
[Auth0 resource configuration](https://auth0.com/ai/docs/mcp/guides/resource-param-compatibility-profile),
[Supabase OAuth limitations](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows).

## Planned persistence and security invariants

Use the previously approved PostgreSQL entities: profiles, external identities,
food entries, weigh-ins, exercise sessions, effective-dated target sets/versions,
idempotent operations, private record revisions and redacted audit events.

- Force RLS on personal tables; runtime roles are neither owners nor BYPASSRLS.
- Separate runtime, identity-administration, migration and backup credentials.
- Verify identity before establishing transaction-local internal-user context.
- Parameterize SQL and check ownership of identifiers and cross-record references.
- A shared database credential plus application-set RLS context still trusts the
  server; it is not protection against arbitrary SQL execution or host compromise.
- A mutation, its revision and durable operation receipt commit atomically.
  Unique owner/operation keys serialize retries. Same key with different input
  conflicts; a fresh key is not guaranteed to represent the same conversational intent.
- Enforce one logical weigh-in per owner/Melbourne DATE, including deletion/restore
  behavior. Corrections use expected versions, not silent overwrite.
- Append dated targets/revisions and disclose explicit backdating; never rewrite
  historical targets silently. Do not purge receipts to make space without review.
- Use DATE for daily buckets and TIMESTAMPTZ for instants. Centralize IANA
  Australia/Melbourne conversion and test 23/25-hour DST days and midnight retries.

Personal records belong on private servers, not in this public repository. Selected
values necessarily pass through ChatGPT and the authenticated browser. Prevent
shared caching, request-body/token logging and secrets in client bundles. Future
authentication/database/config modules must remain server-only. Preview deployments
must never receive production credentials or data.

## Free-tier limitations and recovery

Vercel Hobby is restricted to personal/non-commercial use; included usage exhaustion
can pause functionality. Supabase Free currently includes 500 MB database storage
and can pause a low-activity project after seven days. Manual resumption may be
needed. Do not promise continuous availability, arbitrary history or background
recovery, and do not depend on artificial keep-alive traffic.

No additional paid nutrition, model, monitoring, SMS/email or backup service.
Owner login must not depend on purchasing email delivery. Retain strict payload,
query, pagination, timeout and per-user limits. Warn before storage exhaustion;
prefer explicit read-only operation over silent deletion of history or charges.

Free backup plan: encrypted logical exports to existing owner-controlled storage,
outside GitHub and the checkout, with bounded rotation and periodic local restore
tests. Include operation receipts and target revisions; document managed Auth
recovery separately. No dumps in Actions artifacts, logs or public buckets.
Automating on an existing computer depends on it being awake. Recovery point is
the last successful export; no 24-hour or four-hour recovery guarantee. No new
hardware/storage purchase is assumed. Restoring can remove recent receipts, so
reconcile uncertain operations before resuming retries.

Sources: [Supabase pausing](https://supabase.com/docs/guides/platform/free-project-pausing),
[Free backups](https://supabase.com/docs/guides/platform/backups),
[Billing restrictions](https://supabase.com/docs/guides/platform/billing-faq).

## Acceptance and unresolved work

Phase 1A acceptance: credential-free install/build/test, strict package checks,
rejected acting identities in envelopes, rejected nonzero/paid policy configuration,
sanitized errors, no enabled MCP tools or OAuth discovery, and reference isolation.
No hosted services are contacted by tests. CI runs checks only, never deployments.

Later gates: Auth0 Free OAuth/refresh with actual ChatGPT, audience/scope negatives,
Supabase owner isolation under real RLS/runtime roles, concurrent/crash/restart
idempotency, one-daily-weight uniqueness, target/DST integrity, private dashboard
sessions, backup restore, quota failures and actual confirmation behavior.

Live Free entitlement checks, callback/token-method compatibility, final regions,
backup availability and data-erasure retention remain unresolved until the relevant
approved phase. If any needed feature demands a trial or payment, stop that step
and document a genuinely free compromise. No automatic upgrade or scope expansion.

Future deployments use exact reviewed commits, additive migrations and previous
compatible application versions for rollback. Never roll back to the noauth probe.
Database restore is a separate potentially data-losing action requiring approval.
