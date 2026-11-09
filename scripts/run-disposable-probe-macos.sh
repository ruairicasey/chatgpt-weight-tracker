#!/usr/bin/env bash
# Disposable Phase 0 probe launcher for macOS. Run from the repository root.
set -Eeuo pipefail

for cmd in node pnpm cloudflared curl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing prerequisite: $cmd"
    echo "Install Node.js 24, pnpm (via corepack), and cloudflared before retrying."
    echo "On macOS with Homebrew: brew install node@24 cloudflared; corepack enable"
    exit 1
  fi
done

if [[ ! -f package.json || ! -f src/start.ts ]]; then
  echo "Run this from the checked-out feat/phase0-disposable-mcp repository root."
  exit 1
fi

WORKDIR="$(mktemp -d)"
SERVER_PID=""
TUNNEL_PID=""
cleanup() {
  trap - EXIT INT TERM
  echo
  echo "Stopping the disposable server and HTTPS tunnel..."
  [[ -n "$TUNNEL_PID" ]] && kill "$TUNNEL_PID" 2>/dev/null || true
  [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null || true
  wait "$TUNNEL_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "Installing pinned dependencies and running validations..."
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build

echo "Starting disposable MCP process on 127.0.0.1:3000 (max 15 minutes)..."
PROBE_TTL_SECONDS=900 pnpm start > "$WORKDIR/server.log" 2>&1 &
SERVER_PID=$!
for i in {1..30}; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    cat "$WORKDIR/server.log"
    echo "Server stopped unexpectedly."
    exit 1
  fi
  if grep -q '"event":"started"' "$WORKDIR/server.log"; then break; fi
  sleep 0.2
done
if ! grep -q '"event":"started"' "$WORKDIR/server.log"; then
  cat "$WORKDIR/server.log"
  echo "Server did not start."
  exit 1
fi
echo "Server event:"
grep '"event":"started"' "$WORKDIR/server.log" | head -1

echo "Opening a temporary Cloudflare HTTPS tunnel (max 10 minutes)..."
cloudflared tunnel --url http://127.0.0.1:3000 --http-host-header localhost:3000 --no-autoupdate > "$WORKDIR/tunnel.log" 2>&1 &
TUNNEL_PID=$!
TUNNEL_START=$SECONDS
URL=""
while (( SECONDS - TUNNEL_START < 35 )); do
  if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
    cat "$WORKDIR/tunnel.log"
    echo "Tunnel stopped unexpectedly."
    exit 1
  fi
  URL="$(grep -Eo 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$WORKDIR/tunnel.log" | head -1 || true)"
  [[ -n "$URL" ]] && break
  sleep 1
done
if [[ -z "$URL" ]]; then
  cat "$WORKDIR/tunnel.log"
  echo "Could not discover tunnel URL."
  exit 1
fi

echo
echo "Temporary MCP URL (do not publish): $URL/mcp"
echo "Validating HTTPS transport using the MCP Inspector CLI..."
# This makes a genuine public-HTTPS MCP discovery request without mutating state.
if ! pnpm dlx @modelcontextprotocol/inspector@2.14.0 --cli "$URL/mcp" --transport http --method tools/list; then
  echo
  echo "Inspector discovery failed. Check server/tunnel logs before trying ChatGPT."
  exit 1
fi
echo
echo "Discovery successful! In ChatGPT: Plugins > Add custom MCP server."
echo "Choose No authentication and paste the temporary MCP URL shown above."
echo "Run read_probe plus-probe-001, write_probe plus-probe-001 synthetic-apple,"
echo "then read_probe again and repeat in a new chat. Keep this terminal open."
echo "Stop and clear everything with Ctrl-C, or it stops after 10 minutes."
echo
deadline=$((SECONDS + 600))
while (( SECONDS < deadline )); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null || ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
    echo "Server or tunnel exited; test session ended."
    break
  fi
  sleep 1
done
