import { SERVICE_TERMS_VERSION } from '@cupidilla/contracts';
import { expect, test } from '@playwright/test';
import { closeDb, rowsForEmail } from './helpers/db.ts';
import { login, logout, PASSWORD, registerAdult, uniqueEmail } from './helpers/forms.ts';
import { WEB_URL } from './helpers/oauth-env.ts';

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
  await expect(page.getByText(`versión ${SERVICE_TERMS_VERSION}, el ${accepted}`)).toBeVisible();

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

test('E-5: /account muestra los datos, las sesiones abiertas y no desborda a 320 px', async ({
  page,
  browser,
  javaScriptEnabled,
}) => {
  const email = await registerAdult(page);

  // Orden de las secciones.
  await expect(page.getByRole('heading', { level: 2 })).toHaveText([
    'Tus datos',
    'Formas de entrar',
    'Sesiones abiertas',
    'Cupidilla',
    'Sesión',
    'Eliminar tu cuenta',
  ]);

  // «Tus datos», en su orden. La fecha de nacimiento sale tal cual se escribió, sin desfase.
  const details = page.getByRole('region', { name: 'Tus datos' });
  await expect(details.locator('dt')).toHaveText([
    'Correo',
    'Fecha de nacimiento',
    'Cuenta creada el',
    'Inicio de la sesión actual',
    'Condiciones aceptadas',
  ]);
  await expect(details.locator('dd').nth(1)).toHaveText('5 de mayo de 1990');
  await expect(details.locator('dd time').first()).toHaveAttribute('datetime', '1990-05-05');
  const today = new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'long',
    timeZone: 'Europe/Madrid',
  }).format(new Date());
  await expect(details.locator('dd').nth(2)).toHaveText(today);
  await expect(details.locator('dd').nth(3)).toContainText(today);

  // Una sola sesión: la actual.
  const sessions = page.getByRole('region', { name: 'Sesiones abiertas' });
  await expect(
    sessions.getByText(
      'Estas son las sesiones que siguen abiertas con tu cuenta. De cada una solo guardamos las fechas, no el dispositivo ni el lugar.',
    ),
  ).toBeVisible();
  await expect(sessions.getByRole('listitem')).toHaveCount(1);
  await expect(sessions.getByRole('listitem').first()).toContainText('Sesión 1');
  await expect(sessions.getByText('Esta sesión', { exact: true })).toBeVisible();
  await expect(sessions.getByText('Solo tienes esta sesión abierta.')).toBeVisible();
  await expect(
    sessions.getByText('Las sesiones caducadas desaparecen de la lista solas.'),
  ).toBeVisible();
  await expect(sessions.locator('dt')).toHaveText([
    'Abierta el',
    'Último inicio de sesión',
    'Caduca el',
  ]);
  for (const time of await sessions.locator('time').all()) {
    expect(Number.isNaN(Date.parse((await time.getAttribute('datetime')) ?? ''))).toBe(false);
  }

  // Otra sesión desde otro navegador: aquí sigue primero la actual, y hay dos.
  const other = await browser.newContext({ baseURL: WEB_URL, javaScriptEnabled });
  const otherPage = await other.newPage();
  await otherPage.goto('/login');
  await login(otherPage, email);
  await expect(otherPage).toHaveURL('/account');
  await other.close();

  await page.goto('/account');
  const items = sessions.getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Esta sesión');
  await expect(items.nth(1)).not.toContainText('Esta sesión');
  await expect(sessions.getByText('Solo tienes esta sesión abierta.')).toHaveCount(0);

  // Sin scroll horizontal a 320 px.
  await page.setViewportSize({ width: 320, height: 800 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
