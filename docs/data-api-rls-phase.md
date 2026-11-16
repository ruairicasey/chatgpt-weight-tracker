# Phase 2 — Data API / RLS acceptance and implementation plan

Status: **draft / not deployable**. The migration establishes the tables and RLS but does not yet implement MCP CRUD or atomic receipt RPCs. Do not activate real data tools until every gate passes. Do not merge until implementation, tests and owner review are complete.

## Decisions
- Retain existing ChatGPT OAuth client, callback and `client_secret_post`; no re-registration.
- Supabase Free + Vercel Hobby only; no service-role key, database password, paid services or separate OAuth proxy.
- Keep current experiment's fail-closed 503 activation/expiry gate. Re-activate only after the PR is merged and a fresh expiry is approved.
- Preserve the existing synthetic probes for diagnostics; their temporary data can expire.
- User IDs are derived exclusively from verified JWTs; never accept `owner_id` in MCP tool inputs.
- Dates are explicit `YYYY-MM-DD` Australia/Melbourne calendar days. Do not convert UTC timestamps into dates implicitly. Enforce one weigh-in per owner/day.

## Compatibility gate (must precede CRUD)
With a real **custom-audience** OAuth access token, call the Supabase REST Data API using:
`apikey: <SUPABASE_PUBLISHABLE_KEY>` and `Authorization: Bearer <CALLER_ACCESS_TOKEN>`.
Use the exact configured project origin; no service key or fallback to a dashboard token.
Verify PostgREST accepts the token and `auth.uid()` resolves to its `sub`. If a custom `aud` is rejected, **stop and report**. Do not relax the MCP verifier, change token audience, or bypass RLS. Prove this with the second user as well. Never log bearer tokens.

## Migration
`supabase/migrations/202611170001_tracker_data_rls.sql`:
- `weight_entries`: UUID ID, owner, Melbourne date, weight kg, optional body-fat %, revision, timestamps, unique owner/date.
- `food_entries`: UUID ID, owner, Melbourne date, name, calories, protein grams, revision, timestamps.
- `operation_receipts`: (owner, operationKey) primary key, SHA-256 canonical payload hash, operation type, stable receipt and committed result.
- Explicit SELECT/INSERT/UPDATE/DELETE owner policies with USING and WITH CHECK; no anon grants. Receipt reads are owner-scoped, direct receipt writes denied.
- Apply migration through Supabase SQL editor as project administrator after review. No runtime migration privileges.

## Implementation tasks required before merge
1. Add a server-only Data API client that receives the **verified raw request bearer token** only inside the request lifetime, checks the configured Supabase URL, sets publishable `apikey`, `Authorization`, bounded timeout and `Cache-Control: no-store`. No process-global token/client, secrets in logs, or token in tool responses.
2. Implement six owner-scoped mutation RPC operations (create/update/delete for weight and food) with **one atomic PostgreSQL transaction** per operation. The RPC derives `auth.uid()`, validates the operation payload, acquires an operation-key lock, compares canonical payload hashes, applies the mutation and stores the receipt in the same transaction. Same key+payload returns stored result and receipt; same key+different payload raises `IDEMPOTENCY_CONFLICT`. Concurrent identical requests must not duplicate data. SECURITY INVOKER preferred; if SECURITY DEFINER is necessary, review its fixed search_path, grants, identity checks and RLS impact separately. Never implement receipts as two independent REST calls.
3. Update/delete RPCs require record ID and expected revision, and reject stale revisions. Return `NOT_FOUND` for other owners, without leaking their existence. Deletions retain operation receipts. Enforce unique owner/day and clear errors for duplicate weight dates.
4. Register MCP tools: `create_weight_entry`, `list_weight_entries`, `update_weight_entry`, `delete_weight_entry`, `create_food_entry`, `list_food_entries`, `update_food_entry`, `delete_food_entry`. Input schemas must be strict, bounded, date-aware, and must omit owner IDs. Mutations require fresh UUID `operationKey`; updates/deletes require `expectedRevision`. Read tools: `readOnlyHint: true`; mutations: `readOnlyHint: false`, with correct destructive annotations. Continue using existing verified principal, scope checks and MCP transport.
5. Use caller-token REST reads filtered by date/ID with bounded page sizes and stable ordering. Database RLS, not client filters, must be the isolation boundary.
6. Add PGlite/local Postgres tests for RLS with two authenticated users, anon, wrong owner writes and updates that attempt to change owner; concurrent idempotency; replay/conflict; revision races; unique owner/date; date/DST cases; and denied direct receipt writes.
7. Hosted acceptance: verify records after redeploy, on distinct Vercel instance IDs, and after 600s token expiry with a refreshed OAuth token. Test both positive CRUD and negative RLS. Record sanitized evidence only.
8. Update stale README/architecture docs and `AGENTS.md` after acceptance. Preserve $0 and no production secrets in repository.

## New Vercel variables
**None expected.** Reuse `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `MCP_OAUTH_ISSUER`, `MCP_OAUTH_AUDIENCE`, `MCP_OAUTH_CLIENT_ID`, `MCP_OWNER_USER_ID`, `MCP_EXPERIMENT_ENABLED`, `MCP_EXPERIMENT_EXPIRES_AT`, and existing signing algorithm/origin settings. Do not add `SUPABASE_SERVICE_ROLE_KEY` or database credentials. Any new gate must default disabled.

## Second test user
**Yes, required.** Create a second confirmed Supabase Auth user with a separate login, no admin role. Temporarily arrange a test-only way to obtain a valid second-user custom-audience token without broadening the production single-owner MCP allowlist. Prefer direct Data API integration tests using a separately minted legitimate user token and existing database RLS; never alter production `MCP_OWNER_USER_ID` or OAuth hook binding to grant second-user MCP access. If the provider cannot issue an equivalent token safely, mark the cross-user custom-audience test blocked rather than pretending it passed.

## Exact ChatGPT acceptance prompts
Run after migration, code, deployment and a new approved experiment window. Use new operation keys for each *new* mutation, retaining the same key only for replay/conflict checks.

1. `Using Weight Tracker, create a weight entry for 2026-11-17 with weightKg 75.50, bodyFatPercent 20.00 and operationKey 11111111-1111-4111-8111-111111111111. Report ID, revision and receipt.`
2. `Using Weight Tracker, list weight entries for 2026-11-17. Report the exact weight, date, ID and revision.`
3. `Using Weight Tracker, update the weight entry ID <ID> to weightKg 75.20 with expectedRevision 1 and operationKey 22222222-2222-4222-8222-222222222222. Report revision and receipt.`
4. `Using Weight Tracker, create a food entry for 2026-11-17 named Test oats, calories 300, proteinG 12.5, operationKey 33333333-3333-4333-8333-333333333333. Report ID and receipt.`
5. `Using Weight Tracker, list food entries for 2026-11-17. Report Test oats and its revision.`
6. `Using Weight Tracker, update food entry ID <FOOD_ID> to calories 310 with expectedRevision 1 and operationKey 44444444-4444-4444-8444-444444444444. Report revision.`
7. `Using Weight Tracker, repeat the exact food update using operationKey 44444444-4444-4444-8444-444444444444 and the original expectedRevision 1. Report whether the outcome is replayed and the receipt matches.`
8. `Using Weight Tracker, repeat that operationKey but change calories to 320. Report whether IDEMPOTENCY_CONFLICT is returned.`
9. `Using Weight Tracker, delete food entry ID <FOOD_ID> with expectedRevision 2 and operationKey 55555555-5555-4555-8555-555555555555. Report the receipt, then list food entries again.`
10. `Using Weight Tracker, delete weight entry ID <ID> with expectedRevision 2 and operationKey 66666666-6666-4666-8666-666666666666. Report receipt, then list weight entries again.`
11. `Using Weight Tracker, create a new synthetic food entry and report its ID. After a Vercel redeploy, read the same entry in a new conversation. Report whether it persisted and the responding instance ID if exposed by a safe diagnostic.`
12. `After waiting more than 600 seconds without reconnecting, using Weight Tracker list my food entries for 2026-11-17 and create another synthetic food entry with a new operationKey. Report whether both operations succeeded without reconnecting.`

### RLS negative tests (two identities; direct authenticated API harness, not owner MCP)
- As user A create a row; as user B SELECT by A's ID -> zero rows; UPDATE/DELETE by A's ID -> zero affected rows; INSERT with A's owner_id -> 403/RLS denial; UPDATE own row to A's owner_id -> RLS denial.
- As anon SELECT/INSERT/UPDATE/DELETE -> denied. Verify user A still sees original row unchanged.
- Test receipt reads from B -> zero rows; direct receipt insert/update/delete -> denied for both.
- Run both identities with custom-audience tokens where possible, and capture redacted HTTP status/row counts. No JWTs, emails or private user IDs in PR evidence.

### Exit criteria
No merge until local checks pass, the custom-audience Data API gate passes, two-user RLS tests pass, all eight MCP CRUD tools work, atomic idempotency works under concurrency, redeploy/cross-instance persistence is proven, and 600s refresh works with DB operations. Owner approval required to apply migration, activate and merge. Full shutdown only after end-to-end validation.
