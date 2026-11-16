import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('Next.js globally preserves a usable referrer context for same-origin forms', () => {
  const config = readFileSync(new URL('../apps/web/next.config.ts', import.meta.url), 'utf8');
  assert.match(config, /source:\\s*['"]\\/:path\\*['"]/);
  assert.match(config, /key:\\s*['"]Referrer-Policy['"],\\s*value:\\s*['"]strict-origin-when-cross-origin['"]/);
  assert.doesNotMatch(config, /key:\\s*['"]Referrer-Policy['"],\\s*value:\\s*['"]no-referrer['"]/);
});
