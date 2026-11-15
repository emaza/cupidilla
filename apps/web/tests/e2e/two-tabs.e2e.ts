import { expect, test, type Browser } from '@playwright/test';
import { closeDb } from './helpers/db.ts';
import { PASSWORD, registerAdult, uniqueEmail } from './helpers/forms.ts';
import { pathIn, waitForMail } from './helpers/mailpit.ts';

test.afterAll(closeDb);

const STALE =
  'Has abierto un enlace más reciente en otra pestaña, así que este formulario ya no vale.';

/** Registra una cuenta en un contexto aparte (para que el de las pestañas no tenga sesión). */
async function account(browser: Browser, verified: boolean): Promise<string> {
  const context = await browser.newContext();
  try {
    return await registerAdult(await context.newPage(), uniqueEmail(), { verified });
  } finally {
    await context.close();
  }
}

// La cookie del token es de la ruta y se comparte entre pestañas: el enlace B sustituye al A, y el
// formulario de A (que enseña la cuenta de A) no debe actuar sobre la de B.
test(
  'dos pestañas con dos enlaces de recuperación: el formulario de la primera no restablece la cuenta de la segunda',
  { tag: '@nojs' },
  async ({ browser, javaScriptEnabled }) => {
    const a = await account(browser, true);
    const b = await account(browser, true);
    const context = await browser.newContext({ javaScriptEnabled });
    const tabA = await context.newPage();
    const tabB = await context.newPage();
    const linkFor = async (email: string) => {
      await tabA.goto('/forgot-password');
      await tabA.getByLabel('Correo electrónico').fill(email);
      await tabA.getByRole('button', { name: 'Enviar enlace' }).click();
      await expect(tabA).toHaveURL('/forgot-password/check-email');
      return pathIn(
        await waitForMail(email, { subject: 'Restablece tu contraseña' }),
        '/reset-password',
      );
    };
    const linkA = await linkFor(a);
    const linkB = await linkFor(b);

    await tabA.goto(linkA);
    await expect(tabA).toHaveURL('/reset-password');
    await tabB.goto(linkB);
    await expect(tabB).toHaveURL('/reset-password');

    await tabA.getByLabel('Contraseña nueva', { exact: true }).fill('otra frase larga nueva');
    await tabA.getByRole('button', { name: 'Guardar contraseña' }).click();
    await expect(tabA.locator('main > .error-summary')).toContainText(STALE);
    await expect(tabA).not.toHaveURL(/\/account/);

    // Ninguna de las dos cuentas cambió de contraseña: la vieja sigue valiendo para B.
    const check = await browser.newContext();
    const page = await check.newPage();
    await page.goto('/login');
    await page.getByLabel('Correo electrónico').fill(b);
    await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL('/account');
    await check.close();
    await context.close();
  },
);

test(
  'dos pestañas con dos enlaces de confirmación: el formulario de la primera no confirma la cuenta de la segunda',
  { tag: '@nojs' },
  async ({ browser, javaScriptEnabled }) => {
    const a = await account(browser, false);
    const b = await account(browser, false);
    const context = await browser.newContext({ javaScriptEnabled });
    const tabA = await context.newPage();
    const tabB = await context.newPage();
    const linkA = await pathIn(
      await waitForMail(a, { subject: 'Confirma tu correo' }),
      '/verify-email',
    );
    const linkB = await pathIn(
      await waitForMail(b, { subject: 'Confirma tu correo' }),
      '/verify-email',
    );

    await tabA.goto(linkA);
    await expect(tabA).toHaveURL('/verify-email');
    await tabB.goto(linkB);
    await expect(tabB).toHaveURL('/verify-email');

    await tabA.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
    await tabA.getByRole('button', { name: 'Confirmar mi correo' }).click();
    await expect(tabA.locator('main > .error-summary')).toContainText(
      'Has abierto un enlace más reciente en otra pestaña',
    );
    await expect(tabA).not.toHaveURL(/\/account/);
    await context.close();
  },
);
