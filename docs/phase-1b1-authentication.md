> Historical phase record. Provider/configuration/permission instructions below
> are superseded by [the Supabase integration](supabase-authentication.md).
> Do not configure Auth0 or use the historical environment examples.

# ADR 002: Phase 1B.1 secure authentication foundation

Status: implemented locally for review; no hosted OAuth integration. This extends
[ADR 001](architecture.md), whose zero-cost and privacy boundaries still apply.
Provider documentation reviewed on 2026-11-09. Free terms and client protocols
must be rechecked before separately approved Phase 1B.2 work.

Historical phase record: [Phase 1B.2](phase-1b2-mcp.md) now adds gated MCP routes
and synthetic tools. Its activation/security boundary supersedes statements here
about routes being absent or permanently disabled. Hosted OAuth remains unverified.

## Scope and authority

This phase implements server-only configuration, verification, authorization and
error helpers, with generated local RSA keys and synthetic identities in tests.
It does **not** expose these helpers over HTTP. GET/POST/DELETE `/mcp` still return
503 `INTEGRATION_NOT_CONFIGURED`; discovery routes do not exist. There are no
tools, callback handlers, login flows, account creation, deployments, database
connections, production credentials or changes to `references/phase0` or PR #2.

Additional operating costs must remain **$0 indefinitely**. Never add payment
methods, paid plans, trials, automatic upgrades, usage billing, add-ons, paid
domains or model APIs. Exhaustion means failure/downtime. Neither this policy nor
provider documentation guarantees that any vendor will remain free forever.
If terms change, disable the integration and review a free alternative.

## Implemented security boundary

`@weight-tracker/config/server` and `@weight-tracker/auth/server` import Next's
`server-only` poison module. Public package roots remain suitable for types/policy
contracts and expose no authentication constructors. The boundary checker follows
explicit package exports, blocks client reachability and disallows private
implementation subpaths. Unit tests use Node's `react-server` condition solely to
load those server entry points; a separate subprocess without that condition
checks that imports fail. No runtime client or cookie authentication fallback exists.

The authentication factory validates and snapshots configuration. It makes no
requests until verification. `authenticate(headers, requiredScopes)` is the future
route entry point: extract one Bearer JWT, verify it, resolve the owner, then check
all operation scopes. An empty/unknown required-scope list denies authorization.
Tool arguments have no role in any of these steps. Do not pass a client-provided
principal or use `verifier.verify` alone as authorization in Phase 1B.2.

Verification uses pinned `jose` 6.2.15 and requires:

- Compact signed JWT, bounded to 16 KiB; RS256 only; exact `typ: at+jwt`; a bounded
  `kid`; no `jku`, embedded `jwk`, `x5u` or critical-header extensions.
- Exact configured `iss`, exact audience membership (an audience array may also
  contain Auth0's UserInfo audience), required `exp`, `iat`, `sub`, `client_id`,
  `scope` and `jti`. No `azp` or generic `JWT` dialect fallback; ID tokens fail.
- Integer timestamps, no expiry grace, no future issuance, at most 600 seconds
  total lifetime/age; `nbf` validated when present. Plan Auth0 API lifetime 300s.
- A well-formed OAuth scope string and exact approved `client_id`. Only known
  application scopes grant authority; unrelated OIDC scopes are ignored.
  `permissions` never substitutes for `scope`.
- Exact issuer/subject owner binding, then an explicitly configured internal UUID.
  No email linking, signup-based authorization or subject-derived UUID guessing.

Only the configured standard Auth0 HTTPS tenant domain supplies discovery. The
OIDC document's issuer must match exactly, and `jwks_uri` must be that tenant's
`/.well-known/jwks.json`. Redirects and alternate/custom-domain key URLs fail
closed. Fetches omit credentials and tokens, time out after 5s each, and limit
each response to 64 KiB. Accept only public RSA signing keys marked RS256, with
a 2048–4096-bit canonical modulus and exponent 65537; duplicate eligible kids fail.
Metadata/JWKS are cached per factory for five minutes with a 30s fetch cooldown
and concurrent request coalescing. Unknown kids can refresh after cooldown.
No stale keys are used after cache expiry if refresh fails. Restart/cold start
loses caches and refetches; no auth decision or record depends on warm memory.

Identity objects are frozen and registered in a closure-local WeakSet. JSON
copies, type assertions and identities from another factory cannot pass owner
resolution. Expiry is checked again before resolution/scope use. Create one
factory per runtime instance, authorize afresh per HTTP request, and do not store
principals for later requests. Public TypeScript brands are compile-time aids,
not substitutes for these runtime checks. Trusted server application code remains
part of the security boundary.

Errors do not retain tokens, provider messages, validation issues, claims or
causes. No auth helper logs input. Missing/invalid bearer credentials yield 401;
insufficient scope yields 403; unapproved owner/client yields generic 403;
discovery/key availability failures yield 503. Prepared response helpers set
`no-store`/`no-cache`; 401 and insufficient-scope challenges contain only validated
canonical resource metadata URLs and known scopes. Missing-token challenges omit
an OAuth error, avoiding unsolicited error details. These helpers are **not
mounted** in this phase; configuration failures remain operator errors, never
anonymous success. Future transport code must additionally map tool-level auth
failures to ChatGPT's `_meta["mcp/www_authenticate"]` format without echoing input.

## Server configuration contract (do not configure hosted values yet)

No `.env` file is needed to install, test or build. `loadOAuthConfig(env)` takes an
explicit environment object; no import reads `process.env`. All five values are
required together; no mock owner, default tenant or enabled flag exists.

| Server variable | Required value / ownership |
| --- | --- |
| `MCP_OAUTH_ISSUER` | Exact `https://TENANT.auth0.com/` or regional `https://TENANT.au.auth0.com/` form; lowercase, trailing slash, no custom domain/port/path |
| `MCP_OAUTH_AUDIENCE` | Canonical HTTPS resource URL ending exactly `/mcp`, no credentials/query/fragment/port; later the stable provider hostname, not a preview URL |
| `MCP_OAUTH_CLIENT_ID` | Exact pre-registered ChatGPT OAuth application ID, not a user ID |
| `MCP_OWNER_SUBJECT` | Exact immutable owner `sub` from the approved tenant; not email or an `@clients` machine subject |
| `MCP_OWNER_USER_ID` | Explicit internal UUID; synthetic locally; later deliberately bound to the owner's Supabase profile |

These values are private server configuration even when some are public OAuth
identifiers. `NEXT_PUBLIC_` names containing AUTH0/MCP_OAUTH/MCP_OWNER are rejected.
Never put any of them in `next.config`'s `env` field, client components, public
files, page props, tool responses or logs. The future OAuth client secret belongs
only in Auth0 and ChatGPT's client configuration, **not** in this resource server.
No management API secret, refresh token, signing private key or Supabase service
key is needed here. Local test private keys are generated in process and discarded.

## Planned Auth0 configuration and ongoing Free eligibility gate

Recommend one manually pre-registered **strict third-party Regular Web
Application**, authorization-code flow with mandatory S256 PKCE and
`client_secret_post`. Disable client credentials, password and implicit grants;
allow only authorization-code and refresh-token grants. This is simpler for one
owner than open registration/CIMD. Auth0 documents mandatory PKCE and explicit
per-client API grants for strict third-party apps.
See [third-party security controls](https://auth0.com/docs/get-started/applications/third-party-applications/security-controls)
and [application configuration](https://auth0.com/docs/get-started/applications/third-party-applications/configure-third-party-applications).

The ongoing Free plan, **after any trial is disabled/ended**, must provide every
capability below. General OAuth feature documentation is not proof of this
tenant's Free entitlement. No account was inspected or created for this PR.

| Required ongoing capability | Intended setting / live proof required later |
| --- | --- |
| Hosted login on standard provider domain | One owner, public signup disabled; login and explicit third-party consent work |
| Pre-registered strict third-party client | Regular Web App; exact ChatGPT callback allowlist; confidential `client_secret_post`; S256 enforced, wrong verifier/code reuse rejected |
| Custom API and delegated permissions | Canonical `/mcp` identifier; explicit user-delegated client grant for `tracker:read` and `entries:write`; no M2M grants |
| Public OIDC discovery and JWKS | Exact issuer; S256 advertised; public RS256 keys and rotation available |
| Resource-bound tokens | Resource Parameter Compatibility Profile on; `resource` accepted at authorization, exchange and refresh; correct audience emitted |
| Issuer identification | Include Issuer in Authorization Responses on; successful/error callback `iss` matches discovery |
| RFC 9068 access-token profile | API `rfc9068_profile`, RS256; `at+jwt`, `client_id`, `scope`, `jti`, and 300s expiry; no RBAC/permissions enrichment required |
| Refresh tokens | API Allow Offline Access, `offline_access` consent, refresh grant enabled; rotation, bounded expiration and reuse detection work |
| Client access restriction and revocation | Explicit grant; revoke refresh family/disconnect; no unapproved client can get accepted access |

Auth0 [pricing](https://auth0.com/pricing) lists an ongoing $0 Free plan, no card
for signup and 25,000 MAU; the same page describes a 22-day trial. This is **not**
permission to start a trial: future setup must stop if no non-trial Free path is
available. Avoid its custom domain option (card verification), upgrades, paid
MFA, roles, enterprise connections, Actions, FGA, Token Vault and private-key JWT
client authentication. None is a dependency of this design. Do not rely on
features visible only while a trial is active. Quota denial is acceptable.

The [resource compatibility guide](https://auth0.com/ai/docs/mcp/guides/resource-param-compatibility-profile)
documents both tenant toggles and notes that an explicit `audience` takes priority
over `resource`; never configure a conflicting audience. The
[token profiles guide](https://auth0.com/docs/secure/tokens/access-tokens/access-token-profiles)
distinguishes RFC 9068 from Auth0's default dialect. Refresh requirements and
rotation controls are described in [Get refresh tokens](https://auth0.com/docs/secure/tokens/refresh-tokens/get-refresh-tokens)
and [Configure rotation](https://auth0.com/docs/secure/tokens/refresh-tokens/configure-refresh-token-rotation).
Set a proposed 7-day idle/30-day absolute refresh lifetime and a small documented
overlap window only after checking Free controls and ChatGPT behavior. Prefer
reauthorization over disabling rotation if refresh interoperability fails.

OpenAI supports pre-defined clients and CIMD; its current CIMD exchange methods
are `none` and `private_key_jwt`. Static client credentials avoid introducing
additional client-metadata trust and signing-key requirements for this one-owner
experiment. The callback must be copied from the actual ChatGPT management UI,
never guessed; the issuer-bound stable callback is only available when discovery
and callback issuer identification agree. See [OpenAI authentication](https://developers.openai.com/plugins/build/auth).

If any required control is trial-only/paid/unavailable, stop before enabling MCP.
Keep this disabled local foundation at $0, document the failed capability and
request an alternative-provider decision. Supabase OAuth is not an automatic
substitute: custom scopes and ChatGPT compatibility must be proven independently.
No authentication weakening or free-plan guarantee is implied by this code.

## Planned request flow (not connected)

```mermaid
sequenceDiagram
  participant C as ChatGPT
  participant W as Next.js MCP resource
  participant A as Auth0 Free
  participant O as Owner browser
  C->>W: Request without token
  W-->>C: 401 + canonical protected-resource metadata challenge
  C->>W: Discover resource and approved authorization server
  C->>A: OIDC discovery
  C->>O: Authorization redirect (state, S256 challenge, resource, scopes)
  O->>A: Owner login and explicit consent
  A-->>C: Exact allowlisted callback (code, state, iss)
  C->>A: Code + verifier + client credentials + resource
  A-->>C: Access token; rotating refresh token if consented
  C->>W: Bearer access token
  W->>A: Trusted discovery/JWKS on cache miss only
  W->>W: Verify, resolve owner, check operation scopes
  W-->>C: Authorized synthetic result, or sanitized failure
```

ChatGPT owns state/PKCE/callback checks and token storage/refresh. This application
is a resource server, not an OAuth authorization server or token proxy. Dashboard
Supabase sessions are a separate future trust domain and do not authenticate MCP.
No personal data, issuer subject or internal UUID belongs in synthetic responses.
Platform write permissions/confirmation must be honored; write annotations must
remain truthful. Passing this PR's tests proves none of the hosted flow above.

## Phase 1B.2 transport comparison and recommendation

This supersedes ADR 001's tentative v1 per-request transport sketch. No transport
dependency is installed here. Compare **SDK v2's official Web-standard handler**
with **`mcp-handler` 2.x**, not the old Redis/SSE adapter examples.

| Criterion | Official SDK v2 | `mcp-handler` 2.x |
| --- | --- | --- |
| App Router surface | `createMcpHandler(factory).fetch(Request, context)` returns `Response` | `createMcpHandler(initializer, options)` returns a Fetch handler; Next example exports GET/POST |
| Protocols | Current 2026-07-28 and stateless legacy 2025 client support | Wraps SDK v2 with the same two-era support; removes 2024 HTTP+SSE |
| Request isolation | Fresh server factory per request; pass verified auth context explicitly | Fresh servers via wrapper; auth wrapper and protected-resource metadata helpers available |
| Security ownership | Application enforces bearer verification, host/origin restrictions and scope/owner checks | `withMcpAuth` still requires a real verifier and explicit required auth; examples are not security implementations |
| State / free hosting | No session memory or Redis required | 2.x no longer needs Redis; does not require Vercel paid products |
| Tradeoff | Fewer dependencies; direct control and explicit wrappers/tests | Convenient helpers, additional adapter dependency/API and optional features to audit |

Recommend **official SDK v2 directly**, pinned and audited in a separately approved
Phase 1B.2 PR: Node runtime App Router, stateless factory, JSON responses for
short probe calls, current and legacy negotiation tested. This avoids another
adapter when the official handler already accepts Web Requests. Unlike SDK v1's
`WebStandardStreamableHTTPServerTransport`, v2 provides the higher-level factory;
do not mix the two API generations. `mcp-handler` 2.x remains a viable alternative
if a reproducible compatibility test justifies its helpers.

The [official HTTP guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/http.md)
documents the factory, explicit auth context, JSON response mode and legacy
support. The [SDK repository](https://github.com/modelcontextprotocol/typescript-sdk)
identifies v2 as stable and v1 as a maintenance line. The
[`mcp-handler` 2.x documentation](https://github.com/vercel-labs/mcp-handler)
and [authorization guide](https://github.com/vercel-labs/mcp-handler/blob/main/docs/AUTHORIZATION.md)
describe its equivalent Fetch adapter and auth helpers. Version 2.x is distinct
from 1.x: configuration knobs such as Redis URLs/session IDs were removed.

OpenAI's [custom MCP guide](https://developers.openai.com/api/docs/guides/custom-mcp-server)
supports Streamable HTTP but does not establish this account's exact negotiated
protocol revision. Do not infer that ChatGPT uses the newest revision because
an SDK supports it. Phase 1B.2 must test actual initialize/discover/tool behavior
for the negotiated era, legacy fallback and write permissions. No compatibility
claim here substitutes for a successful owner ChatGPT end-to-end test.

[Vercel Hobby](https://vercel.com/docs/plans/hobby) is suitable for personal,
non-commercial short serverless calls, not a persistent server. Its current
included limits list 1M invocations, 4 active CPU hours and 360 GB-hours memory;
recheck before deployment. Cold starts refetch keys and may fail requests while
the issuer is unavailable. Streams remain subject to function duration limits;
no indefinite SSE, resumability, durable map or paid Redis is needed for the
probe. Prefer JSON, short timeouts and bounded failures. Exceeding quotas must
cause downtime, never a plan upgrade. Do not create a Vercel project or connect
Git deployment automation as part of this PR.

## Acceptance, limitations and next gates

`pnpm check` runs boundaries, lint, strict types, local crypto/security unit tests,
a production build with synthetic secret canaries, browser artifact inspection,
and browser/HTTP regressions. The artifact scan covers `.next/static` and generated
HTML/RSC: no canary or server verifier/config implementation may appear there.
This is regression evidence, not a promise to detect every possible future leak.
Review all new client imports, public configuration and serialization changes.

Tests cover malformed config, wrong signatures/algorithms/issuer/audience/type,
expiry/issuance/not-before, missing claims/scopes, unauthorized client/owner,
forged/foreign/expired identity objects, metadata trust, fetch failure, oversized
responses, weak/private/duplicate keys, coalescing/cooldown/rotation, bearer parsing
and sanitized challenges. Production browser checks send anonymous and synthetic
Bearer requests to the disabled route; discovery remains absent. CI uses local
keys, no provider credentials, no deployments and read-only repository access.

Remaining risks: bearer theft permits replay until expiry; JWT validation does
not provide immediate provider-side user-block/token revocation awareness. Five
minutes of key caching and up to 30s rotation cooldown trade availability against
network amplification. Serverless instances do not share caches/rate limits;
distributed abuse controls need separate Phase 1B.2 design/testing. Operator
mistakes in owner/client binding remain security critical. Deny-by-default does
not replace eventual PostgreSQL RLS or dashboard authorization.

Separate approvals are still needed for transport/probe code, then any hosted
setup/deployment/ChatGPT connection. Later live acceptance must prove Free
entitlements outside trial, S256/discovery/callback correctness, consent, audience
and client isolation, authenticated read/write and platform confirmations,
refresh/rotation/revocation, anonymous and wrong-owner denials, cold-start behavior
and rollback. Use only synthetic records. Durable persistence remains out of scope.

To roll back this phase, revert its code PR through normal review; no external
resources or data require rollback. `/mcp` remains disabled before and after.
Remove local `node_modules`, `.next` and generated test reports if desired; they
contain only synthetic test/build artifacts and are ignored. Never merge or
deploy this PR automatically.
