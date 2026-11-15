import { expect, test, type Page } from '@playwright/test';
import { closeDb } from './helpers/db.ts';
import { registerAdult, uniqueEmail } from './helpers/forms.ts';
import { pathIn, waitForMail } from './helpers/mailpit.ts';
import { completeSignup, continueWith } from './helpers/oauth.ts';

const NEW_PASSWORD = 'otra frase larga nueva';
test.afterAll(closeDb);

async function recover(page: Page, email: string): Promise<void> {
  await page.goto('/forgot-password');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByRole('button', { name: 'Enviar enlace' }).click();
  await expect(page).toHaveURL('/forgot-password/check-email');
  const message = await waitForMail(email, { subject: 'Restablece tu contraseña' });
  await page.goto(await pathIn(message, '/reset-password'));
  await page.getByLabel('Contraseña nueva', { exact: true }).fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Guardar contraseña' }).click();
}

/** QA-C1: tres cuentas; con otra abierta en el mismo navegador, la cookie pasa a la cuenta del enlace. */
test('QA-C1: con Ana abierta, recuperar Carla (Google) y Beto (sin confirmar) cambia la cuenta de la cookie', async ({
  page,
  browser,
}) => {
  const aux = await browser.newContext();
  try {
    const auxPage = await aux.newPage();
    const beto = await registerAdult(auxPage, uniqueEmail(), { verified: false });
    await aux.clearCookies();
    await auxPage.goto('/register');
    const carla = uniqueEmail();
    await continueWith(auxPage, 'Google', { email: carla });
    await completeSignup(auxPage);
    await expect(auxPage).toHaveURL('/account');

    const ana = await registerAdult(page);
    await page.goto('/account');
    await expect(page.getByText(ana).first()).toBeVisible();

    await recover(page, carla);
    await expect(page).toHaveURL('/account?notice=password-reset');
    await expect(page.getByText(carla).first()).toBeVisible();
    await expect(page.getByText(ana)).toHaveCount(0);

    await recover(page, beto);
    await expect(page).toHaveURL('/account/review?notice=password-reset');
    await page.goto('/account');
    await expect(page).toHaveURL('/account/review');
  } finally {
    await aux.close();
  }
});
