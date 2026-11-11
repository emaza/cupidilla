import { expect, test, type Page } from '@playwright/test';
import { closeDb } from './helpers/db.ts';
import { fillRegister, PASSWORD, uniqueEmail } from './helpers/forms.ts';
import { startStack, type Stack } from './helpers/stack.ts';

// Criterios de UX 31 (servidor parado) y 32 (límite de intentos) y acuerdo A14 (fallo al salir).
// Cada test levanta su propia API y su propia web: la API compartida lleva los límites x100 y no
// se puede parar sin romper al resto de tests. Se repite con y sin JavaScript.

test.afterAll(closeDb);
test.setTimeout(120_000);

const SERVIDOR_REGISTRO =
  'Algo ha fallado por nuestra parte y no hemos podido crear tu cuenta. Inténtalo de nuevo en unos minutos.';
const SERVIDOR_ENTRAR =
  'Algo ha fallado por nuestra parte y no hemos podido iniciar tu sesión. Inténtalo de nuevo en unos minutos.';
const SERVIDOR_SALIR =
  'Algo ha fallado por nuestra parte y no hemos podido cerrar tu sesión. Inténtalo de nuevo en unos minutos.';
const SERVIDOR_ELIMINAR =
  'Algo ha fallado por nuestra parte y no hemos podido eliminar tu cuenta. Tu cuenta sigue como estaba. Inténtalo de nuevo en unos minutos.';
const LIMITE = 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.';

async function withStack(
  options: Parameters<typeof startStack>[0],
  body: (stack: Stack) => Promise<void>,
): Promise<void> {
  const stack = await startStack(options);
  try {
    await body(stack);
  } finally {
    await stack.stopAll();
  }
}

/** Los mensajes técnicos no llegan nunca a la pantalla. */
async function expectNoTechnicalDetails(page: Page): Promise<void> {
  const text = await page.locator('main').innerText();
  expect(text).not.toMatch(
    /ECONNREFUSED|fetch failed|API_UNAVAILABLE|INTERNAL_ERROR|\b50[0-9]\b|undefined/,
  );
}

test('C31: con el servidor parado, registro y entrada muestran su error y conservan lo escrito', async ({
  browser,
  javaScriptEnabled,
}) => {
  await withStack({ apiUp: false }, async (stack) => {
    const context = await browser.newContext({ baseURL: stack.webUrl, javaScriptEnabled });
    const page = await context.newPage();
    const email = uniqueEmail();

    await fillRegister(page, { email });
    await expect(page.getByText(SERVIDOR_REGISTRO)).toBeVisible();
    await expect(page).toHaveTitle('Error: Crear cuenta — Cupidilla');
    await expect(page.getByLabel('Correo electrónico')).toHaveValue(email);
    await expect(page.getByLabel('Día')).toHaveValue('5');
    await expect(page.getByLabel('Mes')).toHaveValue('5');
    await expect(page.getByLabel('Año')).toHaveValue('1990');
    await expect(page.getByLabel(/Acepto las condiciones de uso/)).toBeChecked();
    await expect(page.getByLabel('Contraseña', { exact: true })).toHaveValue('');
    await expectNoTechnicalDetails(page);
    // Es un error general: se anuncia y no se señala ningún campo.
    await expect(page.locator('.resumen-errores')).toHaveAttribute('role', 'alert');
    await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);

    await page.goto('/entrar');
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByText(SERVIDOR_ENTRAR)).toBeVisible();
    await expect(page.getByLabel('Correo electrónico')).toHaveValue(email);
    await expect(page.getByLabel('Contraseña', { exact: true })).toHaveValue('');
    await expectNoTechnicalDetails(page);

    await context.close();
  });
});

test('A14: si la API cae con la sesión abierta, «Cerrar sesión» no dice que has salido; al volver, sale', async ({
  browser,
  javaScriptEnabled,
}) => {
  await withStack({}, async (stack) => {
    const context = await browser.newContext({ baseURL: stack.webUrl, javaScriptEnabled });
    const page = await context.newPage();
    await fillRegister(page, { email: uniqueEmail() });
    await expect(page).toHaveURL('/cuenta');

    await stack.stopApi();
    await page.getByRole('button', { name: 'Cerrar sesión' }).click();

    await expect(page.getByText(SERVIDOR_SALIR)).toBeVisible();
    await expect(page.getByRole('alert')).toContainText(SERVIDOR_SALIR);
    await expect(page).not.toHaveURL(/aviso=sesion-cerrada/);
    await expect(page.getByRole('status').filter({ hasText: 'Has cerrado sesión.' })).toHaveCount(
      0,
    );
    await expect(page).toHaveTitle('Error: Tu cuenta — Cupidilla');
    // La cookie sigue ahí: la sesión no se ha podido revocar.
    expect((await context.cookies()).some((c) => c.name === 'cupidilla_session')).toBe(true);
    await expectNoTechnicalDetails(page);

    // Al volver la API, el mismo botón funciona. (La API nueva no recuerda nada en memoria, pero la
    // sesión está en la base de datos.)
    await stack.startApi();
    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(page).toHaveURL(/\/\?aviso=sesion-cerrada$/);
    await expect(page.getByRole('status')).toContainText('Has cerrado sesión.');
    expect((await context.cookies()).some((c) => c.name === 'cupidilla_session')).toBe(false);

    await context.close();
  });
});

test('con la API caída, eliminar la cuenta da eliminar.error.servidor y la cuenta sigue', async ({
  browser,
  javaScriptEnabled,
}) => {
  await withStack({}, async (stack) => {
    const context = await browser.newContext({ baseURL: stack.webUrl, javaScriptEnabled });
    const page = await context.newPage();
    await fillRegister(page, { email: uniqueEmail() });
    await expect(page).toHaveURL('/cuenta');
    await page.goto('/cuenta/eliminar');

    await stack.stopApi();
    await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Eliminar mi cuenta definitivamente' }).click();
    await expect(page.getByText(SERVIDOR_ELIMINAR).first()).toBeVisible();
    await expect(page).not.toHaveURL(/aviso=cuenta-eliminada/);
    await expect(page.getByLabel('Contraseña', { exact: true })).toHaveValue('');
    await expectNoTechnicalDetails(page);

    // Con la API otra vez en pie, la cuenta existe y la sesión también.
    await stack.startApi();
    await page.goto('/cuenta');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tu cuenta');

    await context.close();
  });
});

test('C32: el 6.º intento de entrada con el mismo correo muestra comun.error.limite', async ({
  browser,
  javaScriptEnabled,
}) => {
  await withStack({ rateLimitFactor: 1 }, async (stack) => {
    const context = await browser.newContext({ baseURL: stack.webUrl, javaScriptEnabled });
    const page = await context.newPage();
    const email = uniqueEmail();

    for (let attempt = 1; attempt <= 6; attempt++) {
      await page.goto('/entrar');
      await page.getByLabel('Correo electrónico').fill(email);
      await page.getByLabel('Contraseña', { exact: true }).fill(`contraseña errónea ${attempt}`);
      await page.getByRole('button', { name: 'Entrar' }).click();
      const expected = attempt <= 5 ? 'Correo o contraseña incorrectos.' : LIMITE;
      await expect(page.locator('.resumen-errores'), `intento ${attempt}`).toContainText(expected);
    }
    await expect(page.getByLabel('Correo electrónico')).toHaveValue(email);
    await expect(page.getByLabel('Contraseña', { exact: true })).toHaveValue('');
    await expect(page.locator('.resumen-errores')).toHaveAttribute('role', 'alert');
    await expect(page).toHaveTitle('Error: Entrar — Cupidilla');

    await context.close();
  });
});

test('C32: el 6.º registro desde la misma IP en una hora muestra comun.error.limite y conserva lo escrito', async ({
  browser,
  javaScriptEnabled,
}) => {
  await withStack({ rateLimitFactor: 1 }, async (stack) => {
    const context = await browser.newContext({ baseURL: stack.webUrl, javaScriptEnabled });
    const page = await context.newPage();

    for (let attempt = 1; attempt <= 5; attempt++) {
      await fillRegister(page, { email: uniqueEmail() });
      await expect(page, `registro ${attempt}`).toHaveURL('/cuenta');
      await context.clearCookies();
    }
    const email = uniqueEmail();
    await fillRegister(page, { email });
    await expect(page.locator('.resumen-errores')).toContainText(LIMITE);
    await expect(page).toHaveURL(/\/registro$/);
    await expect(page.getByLabel('Correo electrónico')).toHaveValue(email);
    await expect(page.getByLabel('Año')).toHaveValue('1990');
    await expect(page.getByLabel(/Acepto las condiciones de uso/)).toBeChecked();
    await expect(page.getByLabel('Contraseña', { exact: true })).toHaveValue('');
    await expect(page).toHaveTitle('Error: Crear cuenta — Cupidilla');

    await context.close();
  });
});
