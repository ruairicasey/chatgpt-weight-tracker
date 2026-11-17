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
