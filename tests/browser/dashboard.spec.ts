import { expect, test } from '@playwright/test';

test('homepage advertises working ChatGPT logging and provides a sign-in link', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Logging works through ChatGPT.', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Sign in to view dashboard' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('dashboard redirects to login when no owner session is configured', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
});

test('week and month views also require sign-in', async ({ page }) => {
  for (const view of ['week', 'month']) {
    await page.goto(`/dashboard?view=${view}`);
    await expect(page).toHaveURL(/\/login$/);
  }
});

test('sign-out only accepts same-origin POSTs and never signs out via GET', async ({ request }) => {
  const crossSite = await request.post('/logout', { headers: { Origin: 'https://evil.example' }, maxRedirects: 0 });
  expect([403, 503]).toContain(crossSite.status());
  const get = await request.get('/logout', { maxRedirects: 0 });
  expect(get.status()).toBe(405);
});
