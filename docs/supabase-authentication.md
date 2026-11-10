# Supabase authentication: setup and acceptance runbook

Status: implemented for review, not deployed. Date: 10 November 2026, Melbourne.
See the [targeted OAuth contract review](oauth-compatibility-review.md) for pinned
source evidence, the optional JWT scope decision and SDK response checks.
All hosted steps below require separate owner approval. Do not create an account,
enter real credentials, apply SQL, enable MCP or connect ChatGPT as part of this PR.
No tracker data or durable tracker storage is implemented.

## Evidence and compatibility limits

Start with Supabase's official [MCP authentication guide](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication).
It documents OAuth discovery, registration, PKCE, managed refresh and no separate
MCP-auth charge. [OAuth flows](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows)
support authorization code and refresh but not custom application scopes.
[Token security](https://supabase.com/docs/guides/auth/oauth-server/token-security)
documents client_id, default audience authenticated and client-specific audience
hooks. [Auth Hooks](https://supabase.com/docs/guides/auth/auth-hooks) lists Custom
Access Token on Free. Use a PostgreSQL hook, not another deployed HTTP service.

[OpenAI authentication](https://developers.openai.com/plugins/build/auth) requires
S256 advertised in discovery and resource indicators on authorize/token requests.
It supports pre-registered clients. Copy the exact callback shown in ChatGPT;
issuer-identification support can change which callback form is selected.

The inspected [Supabase source](https://github.com/supabase/auth/blob/2550341d490e9123e69f08d27220c77f07fa207b/internal/api/oauthserver/handlers.go)
has a resource field but does not copy it from form-encoded token requests or pass
it to refresh handling. Authorization accepts/stores the resource parameter.
This source inspection is not proof of the hosted version. The token hook binds
our one approved client to one fixed audience independently of that parameter.
It does not implement dynamic resource negotiation or prove RFC 8707 mismatch
rejection. Do not add an OAuth proxy or silently accept authenticated as MCP aud.

| Check | Local evidence | Mandatory live evidence |
| --- | --- | --- |
| Discovery and PKCE | Configured issuer/JWKS URLs are pinned; MCP metadata tests | Hosted discovery advertises S256; actual ChatGPT code flow succeeds; wrong verifier/reused code fails |
| Resource during authorization/exchange | Fixed client-to-resource hook tested in PostgreSQL | Normal ChatGPT requests with resource succeed; inspect behaviour for mismatched resource without logging tokens |
| Refresh | Hook tested with refresh-shaped claims; SDK manages refresh | Expired token fails; actual refresh retains resource audience/client/owner and respects rotation |
| JWT claims | Generated RSA/P-256 keys; positive/negative crypto tests | Hosted access token matches the pinned profile; ID/session tokens fail MCP |
| Database API and RLS | **Not established**; no data API client or RLS schema in this phase | A disposable synthetic table accepts the custom-audience user token; RLS refuses wrong ownership/anon/unknown client |
| Login and consent | Owner/client/callback/CSRF validation and offline tests | Owner approval/denial, cookies, callback and revocation work in real browser |

Passing local tests is not proof that ChatGPT OAuth or custom-audience PostgREST
works. A failed database gate blocks the proposed user-token runtime data path;
do not change aud, use a service-role bypass or introduce another provider to
hide it. Return the specific evidence for review. Provider-only bugs are not
fixed by creating a custom OAuth server.

## Implemented security contract

- Pin one project issuer: `https://<20-character-project-ref>.supabase.co/auth/v1`
  with no trailing slash. Fetch only its OIDC metadata and exact
  `/auth/v1/.well-known/jwks.json`; metadata issuer and JWKS URI must match.
- JWT header `typ: JWT`, configured ES256 (default) or RS256, bounded kid; reject
  embedded keys/URLs, symmetric algorithms and critical extensions. This is the
  Supabase token profile, not the superseded Auth0 RFC 9068 profile.
- Require iss/aud/exp/iat/sub/client_id/role/session_id/is_anonymous. Exact
  MCP audience membership, authenticated role, non-anonymous owner UUID, approved
  client. The JWT scope claim is optional and never grants tracker access; when
  present it must be a bounded, well-formed string. Consent still requests openid. Timestamps are integers; no future iat/expiry grace; maximum
  age and total lifetime 600 seconds. Validate nbf when present. jti is not required
  by this profile; it was never durable business-operation idempotency.
- Internal owner permissions cover tracker read/write/delete/targets. They are
  issued only after verified owner/client binding, not from OIDC scopes,
  user_metadata, email, permissions or tool arguments. The historical internal
  requireScopes method name remains; it checks application policy, not OAuth grants.
- Discovery/keys: no redirects, credentials or bearer forwarding; 5s fetch timeout,
  64 KiB response bound, five-minute cache, 30s cooldown and concurrent coalescing.
  Public RS256 RSA keys require canonical 2048–4096-bit modulus/exponent 65537;
  ES256 requires canonical P-256 coordinates. Never use the legacy shared JWT secret.
- Generic no-store OAuth responses advertise only openid, never entries:write.
- Login uses official @supabase/ssr and supabase-js server-side. Cookies are Secure,
  HttpOnly, SameSite=Lax. The Next proxy refreshes sessions before owner pages.
  Forms require the exact configured Origin, reject duplicate fields and bound
  bodies to 16 KiB. Login also has a basic per-instance 20-attempt/minute limit;
  this is not a globally coordinated limiter. Supabase's own limits still apply.
- Consent re-fetches provider authorization details on POST and validates owner,
  approved client, authorization ID, callback and standard scopes. Hidden fields
  never grant authority. Previously granted consent can return an automatic
  redirect; only the configured ChatGPT callback is allowed, and MCP still checks
  the approved client. No new custom grant server or token store is implemented.
- Only a publishable key is used by the web client, kept in server configuration.
  No service-role key, client secret or database password belongs in the app.
  Provider errors, passwords, tokens, cookies and records are never logged.

## Setup order after explicit approval

1. **Free plan check.** Use Vercel Hobby and a Supabase Free organization/project,
   not a marketplace integration or promotion. No card, trials, paid upgrades,
   add-ons or paid domains. Confirm Free before any setup. If a payment method,
   trial or billing subscription is required, stop. Read [Supabase pricing](https://supabase.com/pricing)
   and [Vercel Hobby](https://vercel.com/docs/plans/hobby) again at execution time.
2. **Reserve application URL.** Create the Vercel Hobby project from this monorepo
   using Next.js and Root Directory `apps/web`. Include files outside the root.
   Install Command: `pnpm install --frozen-lockfile`. Build Command: `pnpm build`
   (the web package script runs `next build --webpack`). Keep Output Directory
   at the Next.js default and use Node.js 24 with pnpm 11.25.0.
   Use the assigned production `*.vercel.app` hostname, not a preview URL. Start
   with MCP disabled. No paid storage, integrations, analytics upgrades or domains.
   Restrict production deployment to reviewed commits/manual promotion. Do not
   deploy unreviewed PRs with production environment values. No deploy job is added.
3. **Owner account.** In Supabase Authentication create one password user manually
   and confirm that user in the dashboard. Disable public signup and anonymous
   sign-ins. Use a generated password stored in your password manager. Normal login
   does not depend on paid SMTP/SMS. Recovery can be an owner-admin action; do not
   purchase a mail service for this experiment. Never commit owner identifiers.
4. **Signing and lifetime.** Select an asymmetric signing key (ES256 recommended;
   RS256 supported when explicitly configured). Set JWT expiry to 600 seconds or
   less. This also affects dashboard sessions; SSR refresh handles those. No HS256.
5. **OAuth server.** Enable Authentication > OAuth Server. Site URL is the exact
   Vercel origin. Authorization Path is `/oauth/consent`. Disable dynamic client
   registration. Inspect discovery; confirm issuer, endpoints and S256. No CIMD
   implementation is needed for one pre-registered client.
6. **Client/callback.** Obtain the exact redirect URI from ChatGPT's MCP connection
   management interface. Register a confidential OAuth client with that exact URI,
   authorization-code and refresh support, and client_secret_basic (or post if the
   interface requires it). Supabase requires PKCE for code flow; test S256. Configure
   ChatGPT with the client ID/secret privately. The secret is not a Vercel variable.
   If the UI requires a reachable endpoint first, expose the disabled deployment,
   obtain the callback without completing authorization, then register/update it.
   Do not activate until callback, hook and environment agree; report a UI blocker
   rather than enabling anonymous access. Accept the provider-advertised standard
   OIDC scopes; request openid, with no invented tracker scopes or offline_access.
7. **Hook migration.** Review then apply
   `supabase/migrations/202611100001_mcp_access_token_hook.sql` using the Supabase
   SQL editor/migration admin role. Privately insert the single operator setting:

   ```sql
   insert into private.mcp_oauth_settings (client_id, owner_id, resource)
   values ('<approved-client-uuid>', '<owner-uuid>', 'https://<production-host>/mcp');
   ```

   These placeholders must never be replaced in GitHub. Enable the **Custom Access
   Token** hook and select `public.mcp_access_token_hook` (Postgres function).
   The function is SECURITY DEFINER with empty search_path and fixed table access;
   only supabase_auth_admin can execute it. anon/authenticated cannot call it or
   read settings. Missing settings refuse OAuth issuance but preserve dashboard
   sessions. Other clients keep their default audience and fail our MCP boundary.
8. **Server environment**, Production only, privately in Vercel:

   | Variable | Value |
   | --- | --- |
   | SUPABASE_URL | `https://<project-ref>.supabase.co` |
   | SUPABASE_PUBLISHABLE_KEY | Project publishable key (`sb_publishable_…`), not service-role |
   | APP_ORIGIN | Exact HTTPS production origin without trailing slash |
   | CHATGPT_OAUTH_REDIRECT_URI | Exact callback registered in step 6 |
   | MCP_OAUTH_ISSUER | `https://<project-ref>.supabase.co/auth/v1` |
   | MCP_OAUTH_AUDIENCE | Exact `APP_ORIGIN` + `/mcp` |
   | MCP_OAUTH_CLIENT_ID | Approved UUID |
   | MCP_OWNER_USER_ID | Owner Supabase UUID; also the expected JWT sub |
   | MCP_OAUTH_SIGNING_ALGORITHM | `ES256` or explicit `RS256`, matching project |
   | MCP_EXPERIMENT_ENABLED | `false` until activation approval |
   | MCP_EXPERIMENT_EXPIRES_AT | Leave absent until activation approval |

   `MCP_OWNER_SUBJECT` is obsolete and unused. No NEXT_PUBLIC authentication
   variables. Web configuration works independently of MCP activation and requires
   issuer/audience consistency. Build/test needs none of these variables.
9. **Login and consent smoke check.** After deployment approval, visit `/login`.
   Verify owner login, unknown-user rejection, Secure/HttpOnly cookies, session
   refresh, explicit approval/denial and exact callback handling. Keep MCP disabled.
10. **Activation requires separate approval.** Set exactly true and a fixed future
    ISO timestamp no more than 24h away, then redeploy the reviewed commit. Public
    production MCP/metadata routes must be reachable by ChatGPT (not behind Vercel
    deployment login). The dashboard and tools remain application-authenticated.
    Use the canonical production hostname; preview aliases, forwarded hosts and
    foreign Origin headers are not trusted. Then connect `/mcp` in ChatGPT's custom
    MCP interface with OAuth and perform the synthetic acceptance below.

## Synthetic hosted acceptance and stop conditions

- Fetch resource metadata and provider discovery. Confirm exact resource/issuer,
  S256 and client authentication method. Confirm callback mode matches registration.
- Deny consent and confirm no usable access; approve with the owner and confirm
  code exchange. Wrong PKCE verifier, reused code and wrong redirect must fail.
- Inspect claims locally without pasting tokens/IDs into GitHub. Confirm resource
  aud, owner sub, approved client_id, non-anonymous authenticated role and <=600s
  lifetime. Test authorization/token/refresh resource parameters separately,
  including a different resource. Other-resource requests must never yield access
  to another service through this verifier; do not claim full RFC 8707 rejection.
- Through actual ChatGPT: read a fixed empty slot, write alpha with a fresh UUID,
  read the receipt, replay the identical operation. Preserve mutation prompts and
  readOnlyHint=false. Open a new conversation. A cold/new instance may lose memory;
  an empty slot is not a persistence or authentication failure.
- Wait for token expiry: direct old-token call returns 401; ChatGPT must refresh
  and retain resource/client/owner, then continue. Test refresh reuse/revocation
  according to provider rotation policy; record observed behaviour, not assumptions.
- Test anonymous, normal dashboard, ID, wrong owner/client and wrong-audience tokens
  against MCP; none may execute probes. Unknown-user consent must also be denied.
- **Database gate, separately approved:** create a disposable RLS-enabled synthetic
  table, test select/insert/update/delete with publishable key + custom-audience
  access token. Assert owner checks in USING/WITH CHECK and reject anon, unknown
  OAuth clients and ownership changes. Compare a normal owner dashboard session.
  This PR does not create that table or implement a database runtime client.
- Expire/disable the experiment: all MCP and metadata routes return 503. Confirm
  no account was upgraded, no payment method exists and no paid add-on was enabled.

If any gate fails, stop and report the exact failing stage with redacted evidence.
Local PostgreSQL/PGlite hook execution proves the function and privileges, not
Supabase Data API behaviour, hosted OAuth discovery, PKCE or ChatGPT refresh.

## Shutdown and rollback

Disable MCP in Vercel and redeploy; verify 503 before continuing. Remove the
ChatGPT connection and revoke that client's Supabase grants/sessions. Revocation
blocks refresh; locally verified JWTs can remain valid until exp unless MCP is
disabled. Do not weaken validation or roll back to the unauthenticated reference.

Keep the hook enabled while old MCP client grants remain, or revoke/delete the
client first. To remove the auth-only migration after disabling the hook in the
Supabase dashboard, drop `public.mcp_access_token_hook(jsonb)` then
`private.mcp_oauth_settings`; never drop the entire private schema. Remove unused
Vercel environment values and optionally delete the disposable free project.
Revert to a reviewed disabled application commit, not obsolete provider settings.

Free limits can pause service; accept cold starts, restart losses and manual
resumption. No keep-alive scheduler, paid backup or usage-billed escape hatch.
No actual tracker records or additional model API is involved in this experiment.
