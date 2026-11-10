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
  for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
    const response = await request.get(path);
    expect(response.status()).toBe(503);
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'INTEGRATION_NOT_CONFIGURED' });
  }
});

test('unconfigured login and consent stay unavailable; credentials and actions fail closed', async ({ page, request }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Owner login' })).toBeVisible();
  await expect(page.getByText('Authentication is not configured.')).toBeVisible();
  await expect(page.locator('input[type=password]')).toHaveCount(0);
  await page.goto('/oauth/consent?authorization_id=synthetic');
  await expect(page.getByRole('heading', { name: 'Connection unavailable' })).toBeVisible();
  for (const path of ['/login/submit', '/oauth/consent/submit']) {
    const response = await request.post(path, { form: { authorization_id: 'synthetic', decision: 'approve', email: 'synthetic@example.invalid', password: 'synthetic-only' } });
    expect(response.status()).toBe(503);
    expect(await response.json()).toEqual({ error: 'AUTHENTICATION_NOT_CONFIGURED' });
    expect(response.headers()['set-cookie']).toBeUndefined();
  }
});
