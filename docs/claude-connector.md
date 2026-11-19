# Claude connector

Claude (claude.ai) connects to the same `/mcp` server as ChatGPT, as a second approved
OAuth client. Both write to the same owner's records, so entries from either show up on
the same dashboard.

## What changes

- **Config:** optional `MCP_CLAUDE_OAUTH_CLIENT_ID` (server-only UUID). When it's unset,
  only ChatGPT is approved and behaviour is unchanged. It must differ from `MCP_OAUTH_CLIENT_ID`.
- **MCP verifier:** accepts a token whose `client_id` is either approved client. Issuer,
  canonical audience, owner `sub`, role, anonymity, lifetime and signature checks are the
  same for both clients.
- **Consent:** each client is pinned to its own callbacks. ChatGPT can only use
  `CHATGPT_OAUTH_REDIRECT_URI`. Claude can only use `https://claude.ai/api/mcp/auth_callback`
  or `https://claude.com/api/mcp/auth_callback` (Anthropic has said the latter may replace
  the former). Neither client can borrow the other's callback.
- **Token hook** (`202611190001_mcp_additional_clients.sql`):
  - Adds `private.mcp_oauth_additional_clients`, which is RLS-forced and has no grants.
  - Its `label` is restricted to `Claude`.
  - The hook sets the MCP audience for these clients too, with the same owner checks.

## Setup (owner approval required for each step)

1. **Supabase → Authentication → OAuth Apps:** create a confidential app with:
   - name "Claude Weight Tracker"
   - both Claude callbacks registered as redirect URIs
2. **Apply the migration.** Then privately run
   `insert into private.mcp_oauth_additional_clients(client_id, label) values ('<id>', 'Claude');`.
3. **Vercel (Production only):** set `MCP_CLAUDE_OAUTH_CLIENT_ID`, then redeploy.
4. **Claude → Settings → Connectors → Add custom connector:**
   - URL: `https://<app>/mcp`
   - Under Advanced settings, the owner enters the client ID and pastes the secret.
5. **Connect:**
   - Sign in.
   - Approve "Connect Claude to your tracker".
   - Test `view_day`.

If the token exchange fails with an auth-method mismatch, switch the Supabase app's token
endpoint auth method. (ChatGPT needed `client_secret_post`.)
