import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('Next.js global header preserves same-origin form request context', () => {
  const config = readFileSync(new URL('../apps/web/next.config.ts', import.meta.url), 'utf8');
  assert.ok(config.includes("source: '/:path*'"));
  assert.ok(config.includes("key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin'"));
  assert.ok(!config.includes("key: 'Referrer-Policy', value: 'no-referrer'"));
});
