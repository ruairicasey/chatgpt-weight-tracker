# Project instructions

## Non-negotiable cost boundary

Additional operating cost must remain **$0 indefinitely**. Use ongoing Free/Hobby
plans only. Never introduce paid services, trials, usage billing, paid domains,
payment methods, automatic upgrades, paid add-ons or additional model APIs.
Quota exhaustion must cause a bounded failure, read-only operation or downtime,
never charges. If free terms change, stop or propose a free migration; do not
upgrade. Provider availability and future pricing cannot be guaranteed.

Planned services: Vercel Hobby (one Next.js dashboard + MCP deployment), Supabase
Free (PostgreSQL + dashboard Auth), Auth0 Free (MCP OAuth). Use provider hostnames.
Do not assume trial features are Free entitlements. See docs/architecture.md.

## Approval and scope

Phase 1A authorizes only the monorepo scaffold, strict contracts and principal
types, configuration validation, package boundaries, documentation, synthetic
tests and CI. Phase 1B requires separate owner approval. Do not create external
infrastructure, deploy, configure credentials, enable OAuth/database connections,
implement tracker features or merge PRs without the corresponding authorization.
Opening a requested feature PR is authorized; merging it is not.

Phase 1B.1 separately authorizes server-only OAuth configuration, JWT verification,
owner/scope authorization, secure errors, synthetic tests and documentation only.
Keep `/mcp` unconditionally disabled and discovery absent. Phase 1B.2 transport,
tools, external setup, credentials and deployment require separate approval.
See docs/phase-1b1-authentication.md. No trial entitlement may be treated as Free.

Phase 1B.2 separately authorizes the official SDK v2 stateless Fetch handler,
protected-resource metadata and authenticated synthetic probes only. The
experiment must default to disabled, require complete validated configuration
and expire within 24 hours. Temporary bounded memory is permitted only for
synthetic probes and must never be described as durable. No deployment, account
creation, infrastructure, production credentials, Supabase integration or merge
of the Phase 1B.2 PR is authorized. See docs/phase-1b2-mcp.md.

## Security and privacy

- Never commit personal data, credentials, dumps, private screenshots or tokens.
- Never trust an acting user ID supplied through MCP arguments.
- Production must fail closed until token verification, identity mapping and
  authorization exist. No anonymous or synthetic-owner fallback.
- Keep database/configuration/authentication implementations server-side.
- Never log raw tokens, cookies, tool arguments or personal records.
- Preserve historical targets and durable idempotency; enforce one weigh-in per
  user per Australia/Melbourne day when implementing the future schema.
- Do not relabel write tools as read-only to bypass ChatGPT confirmation.
- references/phase0 is an immutable historical snapshot, excluded from the active
  workspace and production imports/build. Its noauth behavior is not a template
  for production. Do not start its server or tunnel as part of normal checks.

## Development

Use Node.js 24 and the pinned pnpm version. Install with a frozen lockfile.
Run `pnpm check` before opening a PR. Tests must remain synthetic and independent
of hosted services or credentials. Do not add paid CI actions or deployment jobs.
Keep shared package dependencies acyclic and enforce them in the boundary check.
Document what is implemented versus planned; do not imply OAuth, persistence,
RLS or ChatGPT end-to-end behavior is verified by Phase 1A tests.
