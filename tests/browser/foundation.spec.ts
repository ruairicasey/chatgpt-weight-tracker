import { expect, test } from '@playwright/test';

test('landing page is usable on desktop and mobile without pretending login or logging works', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your progress.');
  await expect(page.getByRole('status')).toContainText('Logging and sign-in are not available yet.');
  await expect(page.getByRole('button')).toHaveCount(0);
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(failures).toEqual([]);
});

test('MCP stays disabled even when a caller sends tokens, synthetic writes or forged ownership', async ({ request }) => {
  for (const method of ['GET', 'POST', 'DELETE']) for (const headers of [{}, { Authorization: 'Bearer synthetic-not-a-token' }]) {
    const response = await request.fetch('/mcp', {
      method,
      headers,
      ...(method === 'POST' ? { data: { jsonrpc: '2.0', method: 'tools/call', params: { name: 'write_probe', arguments: { userId: 'forged' } }, id: 1 } } : {}),
    });
    expect(response.status()).toBe(503);
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'INTEGRATION_NOT_CONFIGURED' });
  }
  expect((await request.get('/.well-known/oauth-protected-resource')).status()).toBe(404);
  expect((await request.get('/.well-known/oauth-protected-resource/mcp')).status()).toBe(404);
});
