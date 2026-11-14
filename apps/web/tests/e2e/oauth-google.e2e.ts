import { DEFAULT_MIN_AGE, latestAdultBirthDate, referenceToday } from '@cupidilla/contracts';
import { expect, test, type Page } from '@playwright/test';
import { closeDb, oauthRowsForEmail } from './helpers/db.ts';
import { uniqueEmail } from './helpers/forms.ts';
import { completeSignup, continueWith } from './helpers/oauth.ts';

test.afterAll(closeDb);

/** Quien cumple 18 años mañana (hora de Madrid). */
function minorBirthDate(): { day: string; month: string; year: string } {
  const latest = new Date(
    `${latestAdultBirthDate(referenceToday(new Date()), DEFAULT_MIN_AGE)}T00:00:00Z`,
  );
  latest.setUTCDate(latest.getUTCDate() + 1);
  return {
    day: String(latest.getUTCDate()),
    month: String(latest.getUTCMonth() + 1),
    year: String(latest.getUTCFullYear()),
  };
}

/** Violaciones de CSP y errores de página durante el test (E-O9). */
function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (/Content Security Policy|Refused to/i.test(text)) violations.push(text);
  });
  page.on('pageerror', (error) => violations.push(error.message));
  return violations;
}

test('E-O1 y E-O9: alta con Google desde /register hasta /account, sin violaciones de CSP', async ({
  page,
  context,
}) => {
  const violations = watchCsp(page);
  const email = uniqueEmail();
  await page.goto('/register');
  await expect(page.getByRole('group', { name: 'Continuar con otro servicio' })).toBeVisible();
  await expect(page.getByText('O crea tu cuenta con tu correo')).toBeVisible();

  await continueWith(page, 'Google', { email });
  await expect(page).toHaveURL('/register/complete');
  await expect(page).toHaveTitle('Termina de crear tu cuenta — Cupidilla');
  await expect(page.getByText(email)).toBeVisible();
  await expect(
    page.getByText('Entrarás siempre con Google: no te pedimos contraseña.'),
  ).toBeVisible();
  // El correo no es un campo: no viaja en el formulario.
  await expect(page.locator(`input[value="${email}"]`)).toHaveCount(0);

  // Sin la casilla, error y se conserva la fecha.
  await page.getByLabel('Día').fill('5');
  await page.getByLabel('Mes').fill('5');
  await page.getByLabel('Año').fill('1990');
  await page.getByRole('button', { name: 'Crear mi cuenta' }).click();
  await expect(page).toHaveTitle('Error: Termina de crear tu cuenta — Cupidilla');
  await expect(page.getByLabel('Año')).toHaveValue('1990');

  await completeSignup(page);
  await expect(page).toHaveURL('/account');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tu cuenta');
  await expect(page.getByText(email)).toBeVisible();

  const cookies = await context.cookies();
  const session = cookies.find((cookie) => cookie.name === 'cupidilla_session');
  expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax' });
  expect(cookies.find((cookie) => cookie.name === 'cupidilla_oauth')).toBeUndefined();
  expect(await oauthRowsForEmail(email)).toEqual({ users: 1, identities: 1, pending: 0 });

  // Salir y volver a entrar con la misma identidad: directo a /account.
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL('/?notice=signed-out');
  expect(violations).toEqual([]);
});

test('E-O1: entrar con una identidad ya unida va directo a /account', async ({ page }) => {
  const email = uniqueEmail();
  await page.goto('/register');
  const subject = await continueWith(page, 'Google', { email });
  await completeSignup(page);
  await expect(page).toHaveURL('/account');
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();

  await page.goto('/login');
  await continueWith(page, 'Google', { subject, email });
  await expect(page).toHaveURL('/account');
  expect(await oauthRowsForEmail(email)).toEqual({ users: 1, identities: 1, pending: 0 });
});

test('E-O2: un menor ve la pantalla de cierre y no queda nada guardado', async ({ page }) => {
  const email = uniqueEmail();
  await page.goto('/register');
  await continueWith(page, 'Google', { email });
  await completeSignup(page, minorBirthDate());
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('No podemos crear tu cuenta');
  await expect(page).toHaveTitle('No podemos crear tu cuenta — Cupidilla');
  await expect(page.getByText('No hemos guardado nada de tu cuenta de Google.')).toBeVisible();
  await expect(page.locator('main form')).toHaveCount(0);
  // Lo que se ve no lleva el correo (con JavaScript, la carga inicial de la página aún lo tiene
  // en memoria: no es un dato guardado).
  await expect(page.locator('main')).not.toContainText(email);
  expect(await oauthRowsForEmail(email)).toEqual({ users: 0, identities: 0, pending: 0 });
  expect(
    (await page.context().cookies()).find((c) => c.name === 'cupidilla_oauth'),
  ).toBeUndefined();
});

test('E-O4: cancelar en el proveedor vuelve a la página de origen con un aviso informativo', async ({
  page,
}) => {
  await page.goto('/register');
  await continueWith(page, 'Google', { decision: 'deny' });
  await expect(page).toHaveURL('/register?notice=provider-cancelled&provider=google');
  const notice = page.getByRole('status').filter({ hasText: 'No has continuado con Google' });
  await expect(notice).toBeVisible();
  // Cancelar no es un error.
  await expect(page).toHaveTitle('Crear cuenta — Cupidilla');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continuar con Google' })).toBeVisible();
});

test('E-O4: cancelar en /register/complete no crea nada y vuelve con signup-cancelled', async ({
  page,
}) => {
  const email = uniqueEmail();
  await page.goto('/login');
  await continueWith(page, 'Google', { email });
  await expect(page).toHaveURL('/register/complete');
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page).toHaveURL('/login?notice=signup-cancelled');
  await expect(page.getByText('Has cancelado. No hemos creado ninguna cuenta')).toBeVisible();
  expect(await oauthRowsForEmail(email)).toEqual({ users: 0, identities: 0, pending: 0 });
});

test('errores del proveedor: correo sin verificar y fallo del proveedor vuelven con su error', async ({
  page,
}) => {
  await page.goto('/login');
  await continueWith(page, 'Google', { email: uniqueEmail(), emailVerified: false });
  await expect(page).toHaveURL('/login?error=email-unverified&provider=google');
  await expect(page.getByRole('alert')).toContainText(
    'El correo de tu cuenta de Google todavía no está verificado',
  );
  await expect(page).toHaveTitle('Error: Entrar — Cupidilla');

  await continueWith(page, 'Google', { email: uniqueEmail(), scenario: 'token_error' });
  await expect(page).toHaveURL('/login?error=provider-failed&provider=google');
  await expect(page.getByRole('alert')).toContainText('Google no ha respondido como esperábamos');
});

test('E-O5: una vuelta con el state manipulado o sin la cookie → provider-expired, sin sesión', async ({
  page,
  browser,
}) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continuar con Google' }).click();
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:4400\//);
  // Con la cookie del flujo, pero con un state que no es el suyo.
  await page.goto('/auth/google/callback?code=codigo-falso&state=manipulado');
  await expect(page).toHaveURL('/login?error=provider-expired');
  await expect(page.getByRole('alert')).toContainText('Ha pasado demasiado tiempo');
  expect((await page.context().cookies()).map((c) => c.name)).not.toContain('cupidilla_session');

  // Desde otro navegador, sin la cookie: ni siquiera se llama a la API.
  const other = await browser.newPage();
  await other.goto('/auth/google/callback?code=x&state=y');
  await expect(other).toHaveURL('/login?error=provider-expired');
  await other.close();
});

test('E-O6: next se conserva a través del proveedor; uno fuera de la lista se ignora', async ({
  page,
}) => {
  await page.goto('/login?next=/account/delete');
  await continueWith(page, 'Google', { email: uniqueEmail() });
  await completeSignup(page);
  await expect(page).toHaveURL('/account/delete');

  await page.getByRole('link', { name: 'Cancelar' }).click();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await page.goto('/login?next=//evil.example');
  await continueWith(page, 'Google', { email: uniqueEmail() });
  await completeSignup(page);
  await expect(page).toHaveURL('/account');
});

test('E-O10: CSRF: POST /auth/google desde otro origen → 403', async ({ request }) => {
  const response = await request.post('/auth/google', {
    headers: {
      Origin: 'https://evil.example',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    data: 'from=login',
    maxRedirects: 0,
  });
  expect(response.status()).toBe(403);
});

test('/register/complete sin estado pendiente → /login con provider-expired', async ({ page }) => {
  await page.goto('/register/complete');
  await expect(page).toHaveURL('/login?error=provider-expired');
});
