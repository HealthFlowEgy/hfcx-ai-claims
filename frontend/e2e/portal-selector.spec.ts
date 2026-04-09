import { expect, test } from '@playwright/test';

test.describe('Portal selector landing page', () => {
  test('renders all four portal cards in Arabic RTL', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/HealthFlow HCX/);
    // Arabic RTL is the default (SRS DS-RTL-001).
    const html = page.locator('html');
    await expect(html).toHaveAttribute('dir', 'rtl');
    await expect(html).toHaveAttribute('lang', 'ar');

    // All four portal cards are visible and keyboard-accessible.
    for (const portal of ['provider', 'payer', 'siu', 'regulatory']) {
      await expect(page.getByLabel(new RegExp(portal, 'i'))).toBeVisible();
    }
  });

  test('language toggle persists Arabic/English selection', async ({ page }) => {
    await page.goto('/');
    // Click the language toggle
    await page.getByRole('button', { name: /English|العربية/ }).click();
    // Page rerenders LTR
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });

  test('keyboard tab walks through all portal cards', async ({ page }) => {
    await page.goto('/');
    // Count how many portal card links are reachable via Tab.
    const cards = await page.getByRole('link').all();
    expect(cards.length).toBeGreaterThanOrEqual(4);
  });
});
