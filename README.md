# ChatGPT Weight Tracker

A personal fat-loss tracker planned around natural-language logging in ChatGPT,
private PostgreSQL storage and a private web dashboard. **Additional operating
cost must remain $0.** Only ongoing Free/Hobby plans are permitted; no trials,
usage billing, paid domains, automatic upgrades or additional model APIs.

## Current status: Phase 1B.2 (disabled by default)

This branch contains a credential-free monorepo foundation, not a working tracker.
The Next.js landing shell is available locally. Login, persistence, food/weight/
exercise features and hosted OAuth are not available. Server-only configuration,
cryptographic JWT verification, owner/scope authorization and secure OAuth error
helpers are implemented and tested locally. The official SDK v2 MCP adapter and
two authenticated synthetic probes are implemented but disabled by default:
`/mcp` and OAuth resource metadata return 503 without complete configuration,
explicit activation and an unexpired deadline. No hosted OAuth has been tested.
Deployment and ChatGPT connection require separate approval. See
[ADR 002](docs/phase-1b1-authentication.md) for configuration/security details,
Auth0 ongoing Free gates and the official SDK versus `mcp-handler` 2.x comparison.
Read [Phase 1B.2 and the manual acceptance runbook](docs/phase-1b2-mcp.md)
for the pinned SDK API, protocol results, activation and temporary storage limits.

The owner verified unauthenticated read/write execution, idempotent replay and
new-chat readback on their ChatGPT Plus account during Phase 0. OAuth and durable
persistence remain unverified. See [the preserved reference](references/README.md).

## Local development

Use Node.js 24 and pnpm 11.25.0. No environment files or credentials are needed.
Install that pnpm version through your existing package-manager tooling, then:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://127.0.0.1:3000`. The app uses system fonts and does not fetch remote
fonts or require hosted services during builds. Next.js offers optional telemetry;
set `NEXT_TELEMETRY_DISABLED=1` locally if desired (CI already does).

## Checks

Install the browser once, then run the complete checks:

```sh
pnpm exec playwright install chromium
pnpm check
```

On Linux where browser libraries are missing, use Playwright's documented
`install --with-deps chromium` in an environment where system package installation
is permitted. To use an existing compatible Chromium installation instead:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium pnpm check
```

Individual checks:

| Command | Purpose |
| --- | --- |
| `pnpm boundaries` | Package graph, client/server imports and Phase 0 isolation |
| `pnpm lint` | Next.js/TypeScript ESLint rules |
| `pnpm typecheck` | Strict workspace typing and negative principal assertions |
| `pnpm test` | Synthetic contracts, local JWT crypto, configuration, authorization and boundary regressions |
| `pnpm build` | Next.js production build, local only |
| `pnpm test:build-security` | Production build with synthetic secret canaries and browser artifact leak scan |
| `pnpm test:e2e` | Built app, desktop/mobile shell and disabled MCP HTTP behavior |
| `pnpm audit` | Registry dependency advisory check; not part of deterministic tests |

Browser tests start the built app on loopback port 3100 and stop it afterward.
They require `pnpm build` first; `pnpm check` already runs it. They never connect
to ChatGPT, Auth0 or Supabase. Playwright traces are disabled; generated reports,
local state and private backups are ignored. Standard GitHub-hosted Linux CI runs
these checks with no credentials and has no deployment job.

The workspace applies a targeted patched `minimatch` override for
GHSA-g3hv-75wg-m249 in lint dependencies. Revisit it when upstream ranges include
the fix; run the full check suite before changing it. CI actions are commit-pinned
and have read-only repository permissions.

## Workspace

| Path | Purpose |
| --- | --- |
| `apps/web` | Next.js App Router shell and disabled MCP entry point |
| `packages/contracts` | Zod contracts, identifiers, error/scope vocabulary |
| `packages/config` | Cost policy plus explicit server-only OAuth environment validation |
| `packages/auth` | Principal types plus server-only JWT verification and owner/scope resolution |
| `packages/mcp` | Server-only stateless SDK v2 adapter, activation gate and synthetic probes |
| `packages/domain` | Use-case/transaction boundaries; no tracker implementations |
| `packages/db` | Drizzle/Postgres types only; no connection or migrations |
| `references/phase0` | Original disposable probe, excluded from active workspace/build |

Shared packages are private source packages, not published npm packages. No
production source may import the reference. Principal brands do not verify a JWT;
only the trusted server verifier/resolver may establish authenticated ownership.

## Planned hosting and boundaries

One **Vercel Hobby** deployment will host the dashboard and stateless MCP HTTP
adapter, **Supabase Free** supplies PostgreSQL/dashboard login, and **Auth0 Free**
supplies managed MCP OAuth. Use free provider hostnames. Quotas can cause downtime;
there is no availability or indefinite-capacity guarantee. If free terms change,
stop or migrate, never enable billing. No infrastructure is configured here.

Read [AGENTS.md](AGENTS.md) before changing scope or dependencies, and
[ADR 001](docs/architecture.md) for OAuth, serverless adaptation, RLS/identity
boundaries, durable idempotency, free-tier limitations, backups and future gates.

Do not commit personal records, credentials, dumps or real screenshots. The public
portfolio will use synthetic examples; the eventual owner dashboard remains private.
