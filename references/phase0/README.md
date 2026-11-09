# Disposable ChatGPT MCP write probe

Phase 0 for [Issue #1](https://github.com/ruairicasey/chatgpt-weight-tracker/issues/1).
Tests whether the owner's actual Plus account can execute a custom MCP **write**,
rather than merely discover tools. No OAuth, credentials, database, personal data,
dashboard or production resources. Actual ChatGPT execution has not been tested.

## Run locally

Prerequisites: Node.js 24 LTS (Node >=22), pnpm 11.25.0. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

Start **one** process without a watcher, cluster, replicas or serverless hosting.
It binds only `127.0.0.1:3000` and shuts down after 15 minutes. Optional:
`PORT=3001 PROBE_TTL_SECONDS=300 pnpm start`; lifetime is restricted to 30–900
seconds. Changing port also requires changing the tunnel command below.
Restarting clears all records and changes the instance ID. Do not restart between chats.

## Scope and protection

- Official MCP TypeScript SDK; Streamable HTTP POST `/mcp` with JSON responses.
  GET/DELETE return 405; no standalone SSE subscription or unbounded session registry.
- Request-local SDK transports use one shared process-wide map, so independent
  MCP clients/chats see the same records. No disk writes or remote data services.
- Only keys matching `^(plus|control)-probe-00[1-9]$` and values
  `synthetic-apple`, `synthetic-banana`, `synthetic-control` are accepted.
  Extra tool arguments are rejected. At most 18 records can exist.
- Bodies: 4 KiB maximum. HTTP request/header/socket timeouts: 10 seconds.
  Global fixed-window rate limit: 120 HTTP requests/minute (including discovery),
  then 429 with Retry-After. Forwarded IP headers cannot bypass it.
- Host must be localhost/127.0.0.1. The tunnel rewrites Host as shown below.
  Supplied Origin must exactly match `https://chatgpt.com`, `https://chat.openai.com`,
  `http://localhost:6274` or `http://127.0.0.1:6274`. Others get 403.
  CORS is not enabled; use Inspector's default proxy mode, not browser-direct mode.
- **No authentication:** anyone reaching the endpoint can access these synthetic
  records or consume the rate budget. These limits do not establish identity.
  Do not share the URL beyond the test connection; it is not an auth credential.
- Application tool logs contain validated synthetic keys, outcomes, instance IDs
  and receipts; no raw bodies, headers, IPs or conversation text. Inspector and
  tunnel tools have separate logs. Do not commit their output or temporary URLs.

## MCP Inspector control test

Keep the server running in terminal A. In terminal B:

```sh
pnpm dlx @modelcontextprotocol/inspector@2.14.0
```

Open the local URL printed by Inspector, retaining its generated session token.
Select **Streamable HTTP**, `http://127.0.0.1:3000/mcp`, no authentication, default
proxy mode, and Connect.

1. List tools: exactly `read_probe` and `write_probe`.
2. Inspect metadata: both `_meta.securitySchemes` are `[{"type":"noauth"}]`.
   `read_probe` has `readOnlyHint: true`; `write_probe` has `readOnlyHint: false`.
   Both: `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`.
3. Read `{"key":"control-probe-001"}`: expect `found: false`.
4. Write `{"key":"control-probe-001","value":"synthetic-control"}`: expect
   `outcome: created`, a server-generated UUID receipt and instance ID.
5. Repeat: `outcome: replayed`, same receipt, `recordCount: 1`.
6. Read back. Write the same key with `synthetic-banana`: expect `isError: true`,
   `idempotency_conflict`, with the original record unchanged.
7. Disconnect Inspector. Restart the server for an empty ChatGPT test run and
   record its new instance ID.

Optional CLI commands against the same running server:

```sh
pnpm dlx @modelcontextprotocol/inspector@2.14.0 --cli http://127.0.0.1:3000/mcp --transport http --method tools/list
pnpm dlx @modelcontextprotocol/inspector@2.14.0 --cli http://127.0.0.1:3000/mcp --transport http --method tools/call --tool-name read_probe --tool-arg key=control-probe-001
pnpm dlx @modelcontextprotocol/inspector@2.14.0 --cli http://127.0.0.1:3000/mcp --transport http --method tools/call --tool-name write_probe --tool-arg key=control-probe-001 --tool-arg value=synthetic-control
```

## Temporary HTTPS (manual, only when ready)

Install `cloudflared` using [Cloudflare's official instructions](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).
The command requires Bash and GNU `timeout` (Linux; on macOS use `gtimeout` from
GNU coreutils). No Cloudflare account or named tunnel is required.

With the freshly restarted server in terminal A, run in terminal B:

```sh
timeout --signal=TERM --kill-after=5s 600s cloudflared tunnel --url http://127.0.0.1:3000 --http-host-header localhost:3000 --no-autoupdate
```

Copy the generated `https://<random>.trycloudflare.com` URL. The MCP URL is that
URL plus `/mcp`; do not use the placeholder literally. Host rewriting is required.
Quick tunnels are temporary test facilities, not production deployments. They do
not support SSE; the SDK uses Streamable HTTP's JSON response mode deliberately.
See [Quick Tunnel limitations](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/).

The tunnel stops after 10 minutes; the server stops after 15 minutes from its own
start. Stop either earlier with Ctrl-C. `timeout` exit status 124 means its timer
fired. Keep terminals visible; do not daemonize. If time runs out, stop both and
start a new run, recording the new instance ID/URL. Do not mix runs.

Before connecting ChatGPT, verify discovery through this HTTPS URL with Inspector.
Use only `control-probe-*` keys there; reserve `plus-probe-*` for ChatGPT. Fix any
transport/Host/TLS error before assessing account permissions.

## Connect and test in ChatGPT (manual; not yet performed)

Follow the current [custom MCP guide](https://developers.openai.com/api/docs/guides/custom-mcp-server)
and [connection/test guide](https://developers.openai.com/plugins/deploy/connect-chatgpt).
Account policies apply; visible configuration alone does not prove write permission.

1. On ChatGPT web, record the date/time, Plus account/workspace, model, server
   instance ID and confirmation settings. Do not record credentials.
2. **Plugins → + → Add custom MCP server**. Name: **Disposable Write Probe**.
   Enter the actual HTTPS `/mcp` URL; choose **No authentication**. Acknowledge
   the warning and select **Create as a plugin**.
3. Verify both tools are discovered/enabled and the write is not read-only.
   Install the plugin. In a new conversation, select it with `@`.
4. Send: `Use Disposable Write Probe's read_probe with key "plus-probe-001". Report the tool result.`
   Expect `found: false` and the current instance ID. If already found, use an
   unused allowed key or restart the run; do not claim an empty baseline.
5. Send: `Use Disposable Write Probe's write_probe with key "plus-probe-001" and value "synthetic-apple". Execute the tool and report its returned receipt.`
   Approve if prompted. Expand and retain actual tool input/output. Match its
   receipt and `created` event in terminal A. Prose alone is not proof.
6. Read the key back. Repeat the identical write: expect `replayed`, same receipt
   and unchanged count. Control records may also be included in that count.
7. Keep the same process running. Open a new chat, select the plugin and ask to
   read `plus-probe-001`, without supplying the expected value/receipt. Both must
   match, including instance ID. This proves cross-chat memory, not durable storage.
8. Record confirmation behavior and whether remembered approval is offered. To
   test that option, select it and write a second unused key in the same chat;
   record whether it prompts again. Never relabel writes as read-only. Confirmation
   counts as permitted execution, not proof of unattended/background writes.
9. Remove/disconnect the plugin, Ctrl-C the tunnel and server, and close Inspector.
   Verify the old HTTPS endpoint no longer serves MCP. Memory is discarded;
   separately retained evidence remains until deleted.

### Evidence and decision criteria

Record each tool's name, arguments, result, time, instance ID, confirmation and
matching server event. Keep evidence private and synthetic; do not commit account details.

- **PASS:** the correctly annotated write actually executes from this Plus account;
  server event/receipt match; reads return the value; retry adds no duplicate;
  a fresh chat reads the same receipt/instance. Next step is **planning only** for
  OAuth-protected Supabase integration, owner isolation and durable persistence.
  This does not satisfy Issue #1's original authenticated/database criteria.
- **PERMISSION BLOCKER:** an explicit plan/account/policy restriction prevents
  adding, enabling or executing the write. Stop and record the exact message,
  stage, account/workspace context, discovered metadata and available server events.
  Do not substitute API Playground, another plan or read-only annotations as proof.
- **INCONCLUSIVE:** timeout, schema/transport error, model failing to choose the
  tool, rate limit or process expiry/restart without explicit policy denial.
  Diagnose that cause; no server call alone does not prove a plan restriction.

No integration, real data, production deployment or merge follows automatically.

## Automated validation

`pnpm test` uses official SDK clients over real loopback Streamable HTTP. It covers
metadata, independent-client visibility, concurrent idempotency, conflicts,
synthetic validation, body/Host/Origin restrictions, rate limiting, expiry and
fresh-instance isolation. It creates no public endpoints and does not contact
ChatGPT. Also run `pnpm typecheck`, `pnpm build` and `pnpm audit --prod`.
