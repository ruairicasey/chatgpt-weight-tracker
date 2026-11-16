# Owner-only tracker: minimal production phase

This is a personal $0 project. The minimal scope is weight, food and day views through ChatGPT, with corrections and deletion. No exercise or dashboard implementation in this PR.

## Code changes
- One **explicit, default-off** production flag: `MCP_PRODUCTION_ENABLED=true`. There is no automatic time expiry. Remove the old `MCP_EXPERIMENT_ENABLED` and `MCP_EXPERIMENT_EXPIRES_AT` after rollout. MCP continues to enforce exact owner, OAuth client, audience and JWT checks.
- Five MCP tools: `log_weight`, `log_food`, `view_day`, `correct_entry`, `delete_entry`. The two existing synthetic probe tools remain for connectivity checks.
- Server-only, per-request Data API client forwards the **already verified caller bearer token** plus publishable API key. No service-role key, database password or global bearer cache.
- One manually applied migration: `supabase/migrations/202611170001_tracker_data_rls.sql` creates `weight_entries` and `food_entries`. Each has owner-scoped RLS for SELECT, INSERT, UPDATE and DELETE. Anonymous access is revoked.
- Inputs contain no owner ID. Melbourne calendar dates are supplied explicitly (`YYYY-MM-DD`); weight is unique per owner/date. Corrections and deletion require entry ID and current revision; a stale revision fails.
- Basic automated validation and mocked Data API tests. No second-user isolation test or operation-receipt RPC in this MVP. Repeating a create request can create duplicates for food; clients should not automatically retry mutating calls.

## Production steps
1. Review and apply the SQL migration in **Supabase SQL Editor** for the existing Free project. Do not apply it via a Vercel runtime account.
2. Verify existing Supabase OAuth and token hook remain intact. In particular confirm a real custom-audience OAuth token works with the Supabase Data API; this is a **live verification**, not proven by automated mock tests.
3. Set `MCP_PRODUCTION_ENABLED=true` on Vercel **Production only**, redeploy the reviewed merged commit. Do not set it on Preview. Remove the obsolete experiment switch and expiry values.
4. Connect the existing ChatGPT OAuth client. Call `view_day` for an unused date, `log_weight`, `log_food`, `view_day` again, `correct_entry` with returned ID/revision, and `delete_entry` with latest revision. Use real entries only after confirming the read/write path.
5. Verify persistence after a new conversation and redeploy; check token refresh after its ten-minute lifetime.

## Rollback
Set `MCP_PRODUCTION_ENABLED=false` or remove it and **redeploy**. Confirm `/mcp` and protected-resource metadata return HTTP 503. Keep your Supabase tables and data; do not drop them to disable access. If authentication or the Data API fails, stop instead of bypassing RLS.

## Limitations
- Data API acceptance of the custom-audience token and OAuth refresh are pending live verification.
- No durable operation idempotency or offline queue; food mutations must not be retried blindly.
- One owner is enforced at the MCP boundary; DB RLS isolates records by JWT `auth.uid()`. A dedicated second-user RLS test is intentionally deferred.
- Neither free hosting tier nor availability is guaranteed forever. Do not add any billing method or paid feature.
