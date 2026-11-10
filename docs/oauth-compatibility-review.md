# PR #6: targeted Supabase OAuth compatibility review

Reviewed 10 November 2026 (Australia/Melbourne). No hosted account, credentials,
deployment, migrations or activation were used. This review updates the existing
Supabase feature branch; it does not authorize merging or hosted testing.

## Evidence versions

Supabase Auth source commit
[`2550341d490e9123e69f08d27220c77f07fa207b`](https://github.com/supabase/auth/tree/2550341d490e9123e69f08d27220c77f07fa207b),
and installed `@supabase/supabase-js` / `@supabase/auth-js` **2.119.0**. Source is
pinned for reproducibility; the hosted project's deployed version is unverified.
Tests execute the actual pinned JavaScript SDK against synthetic HTTP responses.
They do not run Supabase Auth's Go server or simulate a successful live OAuth link.

## 1. Authorization-code and refresh token claims

[`handleAuthorizationCodeGrant`](https://github.com/supabase/auth/blob/2550341d490e9123e69f08d27220c77f07fa207b/internal/api/oauthserver/handlers.go)
sets `grantParams.OAuthClientID` to the authenticated client and `grantParams.Scopes`
to the pending authorization's scope string. The requested scope set must include
openid to request an ID token; openid is not automatically added to every flow.

[`Session.ApplyGrantParams`](https://github.com/supabase/auth/blob/2550341d490e9123e69f08d27220c77f07fa207b/internal/models/refresh_token.go)
stores nonempty scopes and the OAuth client on the session. Both issuance and
refresh ultimately call
[`GenerateAccessToken`](https://github.com/supabase/auth/blob/2550341d490e9123e69f08d27220c77f07fa207b/internal/tokens/service.go),
which reloads the session, reads its scopes and writes them into the access-token
claims. Refresh checks that the authenticated client matches the session's client.
It does not require the refresh request to repeat the scope string to preserve it.

**Precise finding:** for this inspected implementation, a normal code flow that
requested openid and retained its session scopes emits a JWT scope containing
openid on issuance and refresh, before token-hook modifications. This is not a
claim that every Supabase access token always has scope. `Scope` is serialized
with `omitempty`; nil/empty session scopes omit it, and a custom hook can change
claims. The documented required hook claims also do not include scope. The
OAuth response's top-level scope and the signed JWT scope are distinct fields.

The previous verifier unnecessarily required JWT scope and openid for tracker
access. It now treats scope as optional identity metadata. Missing or empty scope
is accepted; when present, nonempty scope must have valid bounded OAuth syntax.
It never grants or removes tracker permissions. Consent still requests openid and
validates the supported requested identity scopes. Our actual security policy is
one verified owner + one approved client + one canonical resource audience.
This correction does not introduce scope-based fallback or anonymous access.

The verifier still requires signature/pinned algorithm, exact issuer and audience,
approved client UUID, owner UUID, authenticated role, non-anonymous identity,
UUID session_id, integer exp/iat, <=600s lifetime/age, no future iat and valid nbf
when present. Token type remains JWT, consistent with the inspected signer.
ID-token and dashboard audiences remain rejected. No synthetic jti requirement.
Regression tests exercise both issuance- and refresh-shaped scope-less tokens
against each existing trust check, including wrong signatures and expired tokens.

## 2. Consent interface and SDK response contract

The official SDK's `OAuthAuthorizationDetails` fields are `authorization_id`,
`redirect_uri`, `client.id`, `user.id` and `scope` (a space-separated string).
The inspected backend's `AuthorizationDetailsResponse` emits those same fields;
its user ID is the authenticated user, and scope comes from the authorization.
See [`OAuthServerGetAuthorization`](https://github.com/supabase/auth/blob/2550341d490e9123e69f08d27220c77f07fa207b/internal/api/oauthserver/authorize.go).

`requireConsentDetails()` already checks the correct fields. No change to these
checks is needed. Tests now type-check a complete fixture against the actual SDK
export, feed it through `getAuthorizationDetails()`, and enforce the same owner,
client, callback and scope checks. Backend cosmetic fields (name/URI/logo/email)
can be absent; they are not authorization requirements even where SDK types mark
them required. Existing tests cover forged owner/client/ID/callback and scopes.

The SDK also returns an `OAuthRedirect` union member with only `redirect_url`
when prior consent covers the requested scopes. The GET page handles that through
the exact configured callback check. It does not pretend that union member has
client/user fields. A fresh approval POST cannot use that object as authorization
details. The SDK test verifies both response shapes and its actual approval POST
path/body. A pinned callback does not replace the MCP client/owner checks.

## 3. Custom Access Token hook contract

[`CustomAccessTokenInput`](https://github.com/supabase/auth/blob/2550341d490e9123e69f08d27220c77f07fa207b/internal/hooks/v0hooks/v0hooks.go)
contains `metadata`, `user_id`, `claims` and `authentication_method`. Client identity
is **claims.client_id**, not a top-level client_id. `GenerateAccessToken` builds
that claim from trusted issuance parameters and invokes the hook for both code
issuance and refresh (`token_refresh`). Our hook already reads the correct field
and does not branch on authentication_method, so both paths get the same audience.

No functional migration change is needed; explanatory comments were added.
PostgreSQL tests now cover realistic nested payloads for both methods, preservation
of requested/omitted scope, and misleading root-level/user_metadata client IDs.
Dashboard events remain unchanged; unknown clients retain their normal audience
and cannot pass MCP. Owner, role, private-setting and execution-privilege checks
remain intact. No hook fabricates scope or identity claims.

## 4. Remaining live acceptance gates

- Confirm the hosted issuer/JWKS, JWT header/profile and actual code/refresh claims
  against this source-backed expectation. Record presence/absence of JWT scope as
  an observation, never paste tokens or private identifiers into GitHub.
- Complete actual ChatGPT discovery, exact callback, S256 PKCE and explicit consent.
- Verify resource handling separately during authorization, form-encoded token
  exchange and refresh; fixed audience binding is not general RFC 8707 negotiation.
- Verify expired-token rejection, ChatGPT refresh/rotation and grant revocation.
- Independently verify custom-audience Supabase Data API access with owner/client
  RLS. No application database path or RLS acceptance is proven by hook tests.

The existing activation flag, <=24h expiry and fail-closed configuration are
unchanged. Only synthetic probes exist. Vercel Hobby + Supabase Free remain the
two selected services. No payment method, trial, paid API, billing or upgrade is
introduced. All live gates require separate approval; no deployment in this PR.
