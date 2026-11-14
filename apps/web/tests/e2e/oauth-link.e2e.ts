import { expect, test } from '@playwright/test';
import { closeDb, oauthRowsForEmail } from './helpers/db.ts';
import { login, logout, PASSWORD, registerAdult } from './helpers/forms.ts';
import { continueWith } from './helpers/oauth.ts';

test.afterAll(closeDb);

test(
  'E-O3: unión con la contraseña y, después, entrada directa con Google',
  { tag: '@nojs' },
  async ({ page }) => {
    const email = await registerAdult(page);
    await logout(page);

    await page.goto('/login');
    const subject = await continueWith(page, 'Google', { email });
    await expect(page).toHaveURL('/login/link');
    await expect(page).toHaveTitle('Unir tus cuentas — Cupidilla');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Ya tienes una cuenta con este correo',
    );
    await expect(page.getByText(email, { exact: true })).toBeVisible();

    // Contraseña errónea: error en el campo y resumen; el campo vuelve vacío.
    await page.getByLabel('Contraseña', { exact: true }).fill('una contraseña equivocada');
    await page.getByRole('button', { name: 'Unir cuentas' }).click();
    await expect(page).toHaveTitle('Error: Unir tus cuentas — Cupidilla');
    await expect(
      page.getByText('La contraseña no es correcta. No hemos unido las cuentas.').first(),
    ).toBeVisible();
    await expect(page.getByLabel('Contraseña', { exact: true })).toHaveValue('');

    await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Unir cuentas' }).click();
    await expect(page).toHaveURL('/account?notice=linked&provider=google');
    await expect(
      page.getByRole('status').filter({ hasText: 'Hemos unido Google a tu cuenta' }),
    ).toBeVisible();
    expect(await oauthRowsForEmail(email)).toEqual({ users: 1, identities: 1, pending: 0 });

    // Salir y entrar con Google: directo a la cuenta.
    await logout(page);
    await page.goto('/login');
    await continueWith(page, 'Google', { subject, email });
    await expect(page).toHaveURL('/account');

    // Con la contraseña sigue pudiendo entrar.
    await logout(page);
    await page.goto('/login');
    await login(page, email);
    await expect(page).toHaveURL('/account');
  },
);

test(
  'E-O3: cancelar la unión vuelve a /login con link-cancelled y no une nada',
  { tag: '@nojs' },
  async ({ page }) => {
    const email = await registerAdult(page);
    await logout(page);
    await page.goto('/login');
    await continueWith(page, 'Google', { email });
    await expect(page).toHaveURL('/login/link');
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page).toHaveURL('/login?notice=link-cancelled');
    await expect(page.getByText('No hemos unido las cuentas.')).toBeVisible();
    expect(await oauthRowsForEmail(email)).toEqual({ users: 1, identities: 0, pending: 0 });
  },
);
