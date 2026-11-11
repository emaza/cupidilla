import { expect, test } from '@playwright/test';
import { registerAdult } from './helpers/forms.ts';

test('E-8: no hay violaciones de CSP en /, /registro ni /cuenta', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (/Content Security Policy|Refused to/i.test(text)) violations.push(text);
  });
  page.on('pageerror', (error) => violations.push(error.message));

  const responses = [await page.goto('/'), await page.goto('/registro')];
  for (const response of responses) {
    expect(response?.headers()['content-security-policy']).toContain("script-src 'self'");
  }
  await registerAdult(page);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tu cuenta');

  expect(violations).toEqual([]);
});
