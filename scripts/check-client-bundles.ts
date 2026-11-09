import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Synthetic tripwires only. Never print environment values or read actual credentials.
const canaries = {
  MCP_OAUTH_ISSUER: 'https://bundle-canary.auth0.com/',
  MCP_OAUTH_AUDIENCE: 'https://bundle-canary.vercel.app/mcp',
  MCP_OAUTH_CLIENT_ID: 'synthetic-private-client-bundle-canary',
  MCP_OWNER_SUBJECT: 'auth0|synthetic-private-owner-bundle-canary',
  MCP_OWNER_USER_ID: '00000000-0000-4000-8000-000000000123',
  AUTH0_CLIENT_SECRET: 'synthetic-secret-bundle-canary-never-real',
};
const build = spawnSync('pnpm', ['build'], { stdio: 'inherit', env: { ...process.env, ...canaries, NEXT_TELEMETRY_DISABLED: '1' } });
if (build.status !== 0) process.exit(build.status ?? 1);

let scanned = 0;
function scan(directory: string, onlyHtml = false) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) scan(path, onlyHtml);
    else if (!onlyHtml || /\.(html|rsc)$/.test(entry.name)) {
      scanned++;
      const content = readFileSync(path, 'utf8');
      if (Object.values(canaries).some(value => content.includes(value)) || /Invalid server OAuth configuration|createOwnerAuthentication/.test(content)) {
        throw new Error('Server authentication material leaked into a browser artifact.');
      }
    }
  }
}
scan('apps/web/.next/static');
scan('apps/web/.next/server/app', true);
if (scanned === 0) throw new Error('No browser artifacts found.');
console.log(`Browser bundle security check passed (${scanned} artifacts).`);
