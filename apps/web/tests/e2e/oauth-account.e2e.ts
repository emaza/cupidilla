import { expect, test, type Page } from '@playwright/test';
import { closeDb, oauthRowsForEmail } from './helpers/db.ts';
import { login, logout, PASSWORD, registerAdult, uniqueEmail } from './helpers/forms.ts';
import { completeSignup, continueWith } from './helpers/oauth.ts';

test.afterAll(closeDb);

/** Cuenta nueva creada con Google; queda en /account con la sesión recién creada. */
async function googleAccount(page: Page): Promise<{ email: string; subject: string }> {
  const email = uniqueEmail();
  await page.goto('/register');
  const subject = await continueWith(page, 'Google', { email });
  await completeSignup(page);
  await expect(page).toHaveURL('/account');
  return { email, subject };
}

const accessRow = (page: Page, name: string) =>
  page.locator('.access-row').filter({ has: page.locator('.access-name', { hasText: name }) });

test('E-O11: «Formas de entrar»; añadir Facebook, quitar Google y la última no se puede quitar', async ({
  page,
}) => {
  const { email } = await googleAccount(page);
  await expect(page.getByRole('heading', { name: 'Formas de entrar' })).toBeVisible();
  await expect(accessRow(page, 'Correo y contraseña')).toContainText('No tienes contraseña');
  await expect(accessRow(page, 'Google')).toContainText('Unido el');
  // Con Google como única forma, no hay botón de quitar.
  await expect(page.getByRole('button', { name: 'Quitar Google' })).toHaveCount(0);
  await expect(accessRow(page, 'Google')).toContainText(
    'Es tu única forma de entrar, así que no se puede quitar.',
  );
  await expect(accessRow(page, 'Facebook')).toContainText('No unido');

  // Añadir Facebook (sesión recién creada: reciente), con otro correo.
  await accessRow(page, 'Facebook').getByRole('button', { name: 'Continuar con Facebook' }).click();
  await page.getByLabel('Identificador').fill(`fb-${Date.now()}`);
  await page.getByLabel('Correo', { exact: true }).fill(uniqueEmail());
  await page.getByRole('button', { name: 'Autorizar' }).click();
  await expect(page).toHaveURL('/account?notice=linked&provider=facebook');
  await expect(
    page.getByRole('status').filter({ hasText: 'Hemos unido Facebook a tu cuenta' }),
  ).toBeVisible();
  await expect(accessRow(page, 'Facebook')).toContainText('Unido el');

  // Quitar Google.
  await page.getByRole('button', { name: 'Quitar Google' }).click();
  await expect(page).toHaveURL('/account?notice=unlinked&provider=google');
  await expect(page.getByRole('status').filter({ hasText: 'Hemos quitado Google' })).toBeVisible();
  await expect(accessRow(page, 'Google')).toContainText('No unido');

  // Facebook es ahora la última: sin botón.
  await expect(page.getByRole('button', { name: 'Quitar Facebook' })).toHaveCount(0);
  expect(await oauthRowsForEmail(email)).toMatchObject({ users: 1 });
});

test('E-O12: crear una contraseña en /account/password y entrar después con ella', async ({
  page,
}) => {
  const { email } = await googleAccount(page);
  await page.getByRole('link', { name: 'Crear contraseña' }).click();
  await expect(page).toHaveURL('/account/password');
  await expect(page).toHaveTitle('Crear contraseña — Cupidilla');
  await expect(page.getByText('además de con Google')).toBeVisible();
  await expect(page.getByText(email, { exact: true })).toBeVisible();

  // Corta: error en el campo.
  await page.getByLabel('Contraseña', { exact: true }).fill('corta');
  await page.getByRole('button', { name: 'Crear contraseña' }).click();
  await expect(page).toHaveTitle('Error: Crear contraseña — Cupidilla');
  await expect(
    page.getByText('La contraseña necesita al menos 10 caracteres.').first(),
  ).toBeVisible();

  await page.getByLabel('Contraseña', { exact: true }).fill('mi frase larga y nueva');
  await page.getByRole('button', { name: 'Crear contraseña' }).click();
  await expect(page).toHaveURL('/account?notice=password-created');
  await expect(accessRow(page, 'Correo y contraseña')).toContainText('Activa');
  // Ahora Google ya se puede quitar.
  await expect(page.getByRole('button', { name: 'Quitar Google' })).toBeVisible();

  // Con contraseña, /account/password vuelve a /account.
  await page.goto('/account/password');
  await expect(page).toHaveURL('/account');

  await logout(page);
  await page.goto('/login');
  await login(page, email, 'mi frase larga y nueva');
  await expect(page).toHaveURL('/account');
});

test('E-O7: borrar una cuenta sin contraseña escribiendo ELIMINAR', async ({ page }) => {
  const { email } = await googleAccount(page);
  await page.goto('/account/delete');
  await expect(
    page.getByText('las uniones con Google. No tocamos nada en tu cuenta de Google.'),
  ).toBeVisible();
  await expect(page.getByLabel('Contraseña', { exact: true })).toHaveCount(0);

  await page.getByLabel('Escribe ELIMINAR para confirmar').fill('borrar');
  await page.getByRole('button', { name: 'Eliminar mi cuenta definitivamente' }).click();
  await expect(page).toHaveTitle('Error: Eliminar tu cuenta — Cupidilla');
  await expect(
    page.getByText('Escribe ELIMINAR para confirmar. No hemos borrado nada.').first(),
  ).toBeVisible();
  expect(await oauthRowsForEmail(email)).toMatchObject({ users: 1 });

  await page.getByLabel('Escribe ELIMINAR para confirmar').fill('eliminar');
  await page.getByRole('button', { name: 'Eliminar mi cuenta definitivamente' }).click();
  await expect(page).toHaveURL('/?notice=account-deleted');
  expect(await oauthRowsForEmail(email)).toEqual({ users: 0, identities: 0, pending: 0 });
});

test('E-O9: sin violaciones de CSP en /account y /account/password', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text());
  });
  page.on('pageerror', (error) => violations.push(error.message));
  await googleAccount(page);
  await page.reload();
  await page.goto('/account/password');
  await page.goto('/account/delete');
  expect(violations).toEqual([]);
});

test('decisión 20: con contraseña, añadir y quitar un proveedor la piden en el mismo formulario', async ({
  page,
}) => {
  const email = await registerAdult(page);
  await expect(page).toHaveURL('/account');
  // Sin bloque de confirmar: el botón de añadir está siempre, con su campo de contraseña.
  await expect(page.getByRole('heading', { name: 'Confirma que eres tú' })).toHaveCount(0);
  const facebook = accessRow(page, 'Facebook');
  await expect(facebook.getByLabel('Tu contraseña, para añadir Facebook')).toBeVisible();

  // Vacía: vuelve con el error y sin ir al proveedor.
  await facebook.getByRole('button', { name: 'Continuar con Facebook' }).click();
  await expect(page).toHaveURL('/account?error=password-required');
  await expect(page.getByRole('alert')).toContainText(
    'Escribe tu contraseña para confirmar el cambio.',
  );

  // Errónea.
  await accessRow(page, 'Facebook')
    .getByLabel('Tu contraseña, para añadir Facebook')
    .fill('otra frase mala');
  await accessRow(page, 'Facebook').getByRole('button', { name: 'Continuar con Facebook' }).click();
  await expect(page).toHaveURL('/account?error=password-incorrect');
  await expect(page.getByRole('alert')).toContainText('La contraseña no es correcta.');

  // Correcta: al proveedor y de vuelta, unido.
  await accessRow(page, 'Facebook')
    .getByLabel('Tu contraseña, para añadir Facebook')
    .fill(PASSWORD);
  await continueWith(page, 'Facebook', { email });
  await expect(page).toHaveURL('/account?notice=linked&provider=facebook');

  // Quitar: con la contraseña errónea no quita nada; con la correcta, sí.
  const linked = accessRow(page, 'Facebook');
  await linked.getByLabel('Tu contraseña, para quitar Facebook').fill('otra frase mala');
  await linked.getByRole('button', { name: 'Quitar Facebook' }).click();
  await expect(
    page.getByText('La contraseña no es correcta. No hemos hecho ningún cambio.').first(),
  ).toBeVisible();
  await expect(accessRow(page, 'Facebook')).toContainText('Unido el');
  await accessRow(page, 'Facebook')
    .getByLabel('Tu contraseña, para quitar Facebook')
    .fill(PASSWORD);
  await accessRow(page, 'Facebook').getByRole('button', { name: 'Quitar Facebook' }).click();
  await expect(page).toHaveURL('/account?notice=unlinked&provider=facebook');
  expect(await oauthRowsForEmail(email)).toMatchObject({ identities: 0 });
});
