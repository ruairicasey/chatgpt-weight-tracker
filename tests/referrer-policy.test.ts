import assert from 'node:assert/strict';
import { test } from 'node:test';
import nextConfig from '../apps/web/next.config';

// A no-referrer policy can result in a null Origin on browser form submissions.
// Keep same-origin Origin available without permitting full cross-origin referrers.
test('browser form POSTs use a referrer policy compatible with strict Origin checks', async () => {
  assert.equal(typeof nextConfig.headers, 'function');
  const rules = await nextConfig.headers!();
  const global = rules.find(rule => rule.source === '/:path*');
  assert.ok(global && 'headers' in global);
  const policy = global.headers.find(header => header.key.toLowerCase() === 'referrer-policy');
  assert.equal(policy?.value, 'strict-origin-when-cross-origin');
});
