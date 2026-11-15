import { expect, test, type Page } from '@playwright/test';
import { closeDb, rowsForEmail } from './helpers/db.ts';
import { login, logout, PASSWORD, registerAdult, uniqueEmail } from './helpers/forms.ts';
import { pathIn, waitForMail } from './helpers/mailpit.ts';
import { completeSignup, continueWith } from './helpers/oauth.ts';

const RESET = 'Restablece tu contraseña';
const CHANGED = 'Tu contraseña ha cambiado';
const NEW_PASSWORD = 'otra frase larga nueva';

test.afterAll(closeDb);

/** Desde /forgot-password: pide el enlace, lo abre desde Mailpit y guarda la contraseña nueva. */
async function recoverPassword(page: Page, email: string, password = NEW_PASSWORD): Promise<void> {
  await expect(page).toHaveURL('/forgot-password');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByRole('button', { name: 'Enviar enlace' }).click();
  await expect(page).toHaveURL('/forgot-password/check-email');
  expect(page.url()).not.toContain(email);
  await expect(
    page.getByText(`Si hay una cuenta con ${email}, te hemos enviado un enlace`),
  ).toBeVisible();

  const message = await waitForMail(email, { subject: RESET });
  await page.goto(await pathIn(message, '/reset-password'));
  // El token sale de la URL antes de pintar nada (técnico §9.1).
  await expect(page).toHaveURL('/reset-password');
  await expect(page.getByText('e•••@example.com')).toBeVisible();
  await page.getByLabel('Contraseña nueva', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Guardar contraseña' }).click();
}

/** Fecha de alguien que tiene 10 años. */
function minorDate(): { day: string; month: string; year: string } {
  return { day: '5', month: '5', year: String(new Date().getUTCFullYear() - 10) };
}

/** Recuperación de la contraseña y revisión de datos (correo, fase C, tarea C.5). */
test.describe('C.5: recuperación de la contraseña', () => {
  test(
    'C5-1: desde /login, el enlace del correo fija la contraseña, cierra la otra sesión y avisa del cambio',
    { tag: '@nojs' },
    async ({ page, browser }) => {
      const other = await browser.newContext();
      try {
        const otherPage = await other.newPage();
        const email = await registerAdult(otherPage);

        await page.goto('/login');
        await page.getByRole('link', { name: '¿Olvidaste tu contraseña?' }).click();
        await recoverPassword(page, email);
        await expect(page).toHaveURL('/account?notice=password-reset');
        await expect(
          page.getByRole('status').filter({ hasText: 'Hemos guardado tu contraseña nueva' }),
        ).toBeVisible();
        await expect(
          page.getByText('También te hemos enviado un correo para avisarte del cambio.'),
        ).toBeVisible();

        // La sesión del otro contexto se ha cerrado.
        await otherPage.goto('/account');
        await expect(otherPage).toHaveURL('/login?next=/account');
        await waitForMail(email, { subject: CHANGED });

        // La contraseña vieja ya no vale y la nueva sí.
        await logout(page);
        await page.goto('/login');
        await login(page, email, PASSWORD);
        await expect(page.getByText('Correo o contraseña incorrectos.').first()).toBeVisible();
        await login(page, email, NEW_PASSWORD);
        await expect(page).toHaveURL('/account');
      } finally {
        await other.close();
      }
    },
  );

  test(
    'C5-2: en /login/link, «¿Olvidaste tu contraseña?» lleva a /forgot-password',
    { tag: '@nojs' },
    async ({ page }) => {
      const email = await registerAdult(page);
      await logout(page);
      await page.goto('/login');
      await continueWith(page, 'Google', { email });
      await expect(page).toHaveURL('/login/link');
      await expect(
        page.getByText('Si la recuperas, entrarás en tu cuenta y podrás añadir Google'),
      ).toBeVisible();
      // Con la cuenta confirmada no se explica cómo quedarse con ella.
      await expect(
        page.getByText('El correo de esa cuenta todavía no estaba confirmado.'),
      ).toHaveCount(0);
      await page.getByRole('link', { name: '¿Olvidaste tu contraseña?' }).click();
      await expect(page).toHaveURL('/forgot-password');
    },
  );

  test(
    'C5-2: en /login/link con la cuenta sin confirmar se explica cómo quedarse con ella',
    { tag: '@nojs' },
    async ({ page }) => {
      const email = await registerAdult(page, uniqueEmail(), { verified: false });
      await logout(page);
      await page.goto('/login');
      await continueWith(page, 'Google', { email });
      await expect(page).toHaveURL('/login/link');
      await expect(
        page.getByText('El correo de esa cuenta todavía no estaba confirmado.'),
      ).toBeVisible();
    },
  );

  test(
    'C5-3: una cuenta creada con Google crea su contraseña por correo y entra con ella',
    { tag: '@nojs' },
    async ({ page }) => {
      const email = uniqueEmail();
      await page.goto('/register');
      await continueWith(page, 'Google', { email });
      await completeSignup(page);
      await expect(page).toHaveURL('/account');
      await logout(page);

      await page.goto('/forgot-password');
      await recoverPassword(page, email);
      await expect(page).toHaveURL('/account?notice=password-reset');
      await logout(page);

      await page.goto('/login');
      await login(page, email, NEW_PASSWORD);
      await expect(page).toHaveURL('/account');
    },
  );

  test(
    'C5-4: una cuenta sin confirmar recupera la contraseña y pasa por /account/review',
    { tag: '@nojs' },
    async ({ page }) => {
      const email = await registerAdult(page, uniqueEmail(), { verified: false });
      await page.goto('/forgot-password');
      await recoverPassword(page, email);

      await expect(page).toHaveURL('/account/review?notice=password-reset');
      await expect(page).toHaveTitle('Revisa tus datos — Cupidilla');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Revisa tus datos');
      // La fecha guardada no se muestra: los campos salen vacíos y la casilla desmarcada.
      for (const label of ['Día', 'Mes', 'Año']) {
        await expect(page.getByLabel(label, { exact: true })).toHaveValue('');
      }
      await expect(page.getByLabel(/Acepto las condiciones de uso/)).not.toBeChecked();
      await expect(page.getByRole('region', { name: 'Aviso sobre tu correo' })).toHaveCount(0);

      // No se puede usar nada más hasta revisar.
      await page.goto('/account');
      await expect(page).toHaveURL('/account/review');
      await page.goto('/legal/terms');
      await expect(page).toHaveURL('/legal/terms');
      await page.goto('/account/review');

      await page.getByLabel('Día', { exact: true }).fill('14');
      await page.getByLabel('Mes', { exact: true }).fill('3');
      await page.getByLabel('Año', { exact: true }).fill('1990');
      await page.getByLabel(/Acepto las condiciones de uso/).check();
      await page.getByRole('button', { name: 'Guardar y continuar' }).click();
      await expect(page).toHaveURL('/account?notice=details-reviewed');
      await expect(
        page.getByText('Gracias, hemos guardado tus datos. Ya puedes usar tu cuenta.'),
      ).toBeVisible();
      await page.goto('/account/review');
      await expect(page).toHaveURL('/account');
    },
  );

  test(
    'C5-5: en /account/review, una fecha de menor borra la cuenta y muestra la pantalla de cierre',
    { tag: '@nojs' },
    async ({ page, context }) => {
      const email = await registerAdult(page, uniqueEmail(), { verified: false });
      await page.goto('/forgot-password');
      await recoverPassword(page, email);
      await expect(page).toHaveURL('/account/review?notice=password-reset');

      const { day, month, year } = minorDate();
      await page.getByLabel('Día', { exact: true }).fill(day);
      await page.getByLabel('Mes', { exact: true }).fill(month);
      await page.getByLabel('Año', { exact: true }).fill(year);
      await page.getByRole('button', { name: 'Guardar y continuar' }).click();

      await expect(page).toHaveTitle('No podemos mantener tu cuenta — Cupidilla');
      await expect(page.getByRole('alert')).toContainText(
        'hemos eliminado esta cuenta y los datos que tenía',
      );
      await expect(page.getByLabel('Año', { exact: true })).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText(year);
      await expect(page.getByRole('link', { name: 'Volver al inicio' })).toBeVisible();
      expect((await rowsForEmail(email)).users).toBe(0);
      expect((await context.cookies()).some((cookie) => cookie.name === 'cupidilla_session')).toBe(
        false,
      );
    },
  );
});
