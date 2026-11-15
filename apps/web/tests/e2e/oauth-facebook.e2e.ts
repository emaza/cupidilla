import { expect, test } from '@playwright/test';
import { closeDb, oauthRowsForEmail } from './helpers/db.ts';
import { uniqueEmail } from './helpers/forms.ts';
import { completeSignup, continueWith } from './helpers/oauth.ts';

test.afterAll(closeDb);

test(
  'E-O8: Facebook sin correo → /login con email-missing y nada guardado',
  { tag: '@nojs' },
  async ({ page }) => {
    await page.goto('/login');
    await continueWith(page, 'Facebook', { email: '' });
    await expect(page).toHaveURL('/login?error=email-missing&provider=facebook');
    await expect(page.getByRole('alert')).toContainText(
      'Facebook no nos ha enviado tu correo y lo necesitamos para crear tu cuenta.',
    );
  },
);

test('E-O8: alta con Facebook hasta /account', { tag: '@nojs' }, async ({ page }) => {
  const email = uniqueEmail();
  await page.goto('/register');
  await continueWith(page, 'Facebook', { email });
  await expect(page.getByText('Has entrado con Facebook.', { exact: false })).toBeVisible();
  await completeSignup(page);
  await expect(page).toHaveURL('/account');
  expect(await oauthRowsForEmail(email)).toEqual({ users: 1, identities: 1, pending: 0 });
});

test(
  'una cuenta creada con Google no entra con Facebook: «entra con Google»',
  { tag: '@nojs' },
  async ({ page }) => {
    const email = uniqueEmail();
    await page.goto('/register');
    await continueWith(page, 'Google', { email });
    await completeSignup(page);
    await page.getByRole('button', { name: 'Cerrar sesión' }).click();

    await page.goto('/login');
    await continueWith(page, 'Facebook', { email });
    await expect(page).toHaveURL('/login?error=other-provider&provider=google');
    await expect(page.getByRole('alert')).toContainText(
      'Ya existe una cuenta con ese correo, pero se creó con Google.',
    );
    expect(await oauthRowsForEmail(email)).toEqual({ users: 1, identities: 1, pending: 0 });
  },
);

test('los dos botones tienen el mismo tamaño (igual prominencia, UX §3.1.2)', async ({ page }) => {
  await page.goto('/login');
  const google = await page.getByRole('button', { name: 'Continuar con Google' }).boundingBox();
  const facebook = await page.getByRole('button', { name: 'Continuar con Facebook' }).boundingBox();
  expect(google && facebook).toBeTruthy();
  expect(google?.width).toBe(facebook?.width);
  expect(google?.height).toBe(facebook?.height);
  expect(google!.y).toBeLessThan(facebook!.y); // Google, Facebook
});
