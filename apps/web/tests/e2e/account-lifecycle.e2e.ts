import { expect, test } from '@playwright/test';
import { closeDb, rowsForEmail } from './helpers/db.ts';
import { login, logout, PASSWORD, registerAdult, uniqueEmail } from './helpers/forms.ts';

// En el proyecto chromium-no-js estos mismos tests son E-6: todo funciona sin JavaScript.

test.afterAll(closeDb);

test('E-1: el registro de una persona adulta lleva a /account con la sesión iniciada', async ({
  page,
  context,
}) => {
  const email = await registerAdult(page);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tu cuenta');
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  const accepted = new Intl.DateTimeFormat('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Madrid',
  }).format(new Date());
  await expect(page.getByText(`versión 2026-11-borrador, el ${accepted}`)).toBeVisible();

  const cookie = (await context.cookies()).find((c) => c.name === 'cupidilla_session');
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', secure: true });

  // El token solo vive en la cookie: nunca en el HTML ni en los datos de la página.
  expect(await page.content()).not.toContain(cookie!.value);
  expect(await rowsForEmail(email)).toEqual({ users: 1, sessions: 1, consents: 1 });
});

test('E-2: salir, volver a la ruta pedida y rechazar un «next» externo', async ({ page }) => {
  const email = await registerAdult(page);

  await logout(page);
  await expect(page.getByRole('status')).toHaveText(/Has cerrado sesión\./);

  await page.goto('/account');
  await expect(page).toHaveURL('/login?next=/account');
  await expect(page.getByText('Entra para ver esa página.')).toBeVisible();
  await login(page, email);
  await expect(page).toHaveURL('/account');

  for (const next of ['https://otro.sitio', '//otro.sitio']) {
    await logout(page);
    await page.goto(`/login?next=${encodeURIComponent(next)}`);
    await login(page, email);
    await expect(page).toHaveURL('/account');
  }

  await logout(page);
  await page.goto('/account/delete');
  await expect(page).toHaveURL('/login?next=/account/delete');
  await login(page, email);
  await expect(page).toHaveURL('/account/delete');
});

test('E-3: entrar, y un error de credenciales no dice qué dato falla', async ({ page }) => {
  const email = await registerAdult(page);
  await logout(page);

  await page.goto('/login');
  await login(page, email, 'contraseña equivocada');
  await expect(page.getByText('Correo o contraseña incorrectos.')).toBeVisible();
  await expect(page).toHaveTitle('Error: Entrar — Cupidilla');
  await expect(page.getByLabel('Correo electrónico')).toHaveValue(email);
  await expect(page.getByLabel('Contraseña', { exact: true })).toHaveValue('');
  const wrongPassword = await page.locator('.error-summary').innerText();

  await page.goto('/login');
  await login(page, uniqueEmail(), PASSWORD);
  await expect(page.locator('.error-summary')).toHaveText(wrongPassword);

  await page.goto('/login');
  await login(page, email);
  await expect(page).toHaveURL('/account');
});

test('E-4: eliminar la cuenta pide la contraseña y no deja nada', async ({ page }) => {
  const email = await registerAdult(page);

  await page.getByRole('link', { name: 'Eliminar mi cuenta' }).click();
  await expect(page).toHaveURL('/account/delete');
  await page.getByLabel('Contraseña', { exact: true }).fill('contraseña equivocada');
  await page.getByRole('button', { name: 'Eliminar mi cuenta definitivamente' }).click();
  await expect(page.locator('#password-error')).toContainText(
    'La contraseña no es correcta. No hemos borrado nada.',
  );
  await expect(page.getByLabel('Contraseña', { exact: true })).toHaveValue('');
  expect((await rowsForEmail(email)).users).toBe(1);

  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Eliminar mi cuenta definitivamente' }).click();
  await expect(page).toHaveURL('/?notice=account-deleted');
  await expect(page.getByRole('status')).toHaveText(
    /Tu cuenta se ha eliminado\. Hemos borrado tus datos y cerrado tu sesión\./,
  );

  await page.goto('/login');
  await login(page, email);
  await expect(page.getByText('Correo o contraseña incorrectos.')).toBeVisible();
  expect(await rowsForEmail(email)).toEqual({ users: 0, sessions: 0, consents: 0 });
});
