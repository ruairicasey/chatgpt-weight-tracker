# Phase 2: exercise logging

Adds an owner-only exercise log, keeping the existing owner-only tracker, OAuth
configuration and free hosting unchanged. No new environment variables.

## Apply in order
1. In **Supabase SQL Editor**, run `supabase/migrations/202611170003_exercise_entries.sql`
   once. It creates `public.exercise_entries` with authenticated-owner RLS
   (select/insert/update/delete), forced RLS and no anonymous privileges.
2. Deploy the merged `main` commit on Vercel Hobby. Keep `MCP_PRODUCTION_ENABLED=true`.
3. In ChatGPT, open the Weight Tracker plugin settings and choose **Refresh tools** so
   `log_exercise` appears.
4. Check the dashboard's new Exercise section for a logged session.

## Semantics
- `log_exercise`: date, activity (1–100 chars, e.g. push/pull/legs/cardio), optional
  duration in minutes (1–1440), optional estimated calories burned (0–10000) and
  optional notes (≤500 chars). The owner is derived from the verified token, never
  from tool arguments.
- `correct_entry` and `delete_entry` accept `kind: "exercise"` with the same
  ID + expected-revision concurrency rules as weight and food. Corrections may set
  optional fields to null.
- `view_day` returns `exercises` alongside weight, food and targets.
- **Exercise calories are informational only.** They are never added to the daily
  calorie allowance; `remaining` is still target minus food consumed.
- Missing durations or burned calories are shown as "—" and count as zero in totals;
  they are never estimated by the server.

## Not in this phase
Idempotency keys, Claude as a second OAuth client and multi-user support (Phases 3–4).
