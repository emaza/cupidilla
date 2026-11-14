import { expect, test, type Locator, type Page } from '@playwright/test';
import { startApiProxy, type ApiProxy } from './helpers/api-proxy.ts';
import { closeDb, revokeSessionsForEmail, rowsForEmail } from './helpers/db.ts';
import { fillRegister, login, PASSWORD, registerAdult, uniqueEmail } from './helpers/forms.ts';
import { startStack, type Stack } from './helpers/stack.ts';

// Criterios de UX 60 a 65: resultado incierto (OUTCOME_UNKNOWN) en registro y eliminación.
// La web habla con la API a través de un proxy que, en la ruta elegida, no responde nunca
// (`hang`: la web agota su plazo de 5 s y la API no ve nada) o pasa la petición a la API y corta
// la conexión sin devolver la respuesta (`cut`: la API sí la ha procesado).

test.setTimeout(120_000);

const REGISTER_UNCERTAIN =
  'No sabemos si tu cuenta se ha creado: se ha perdido la conexión antes de recibir la respuesta. Antes de volver a registrarte, prueba a entrar con este correo y esta contraseña. Si entras, la cuenta ya existe (con el correo sin confirmar, tendrás acceso limitado hasta que lo confirmes). Si no puedes entrar, pulsa «Crear cuenta» otra vez.';
const CHECK_LOGIN_LINK = 'Probar a entrar con este correo (se abre en una pestaña nueva)';
const DELETE_UNCERTAIN =
  'No sabemos si tu cuenta se ha eliminado: se ha perdido la conexión antes de recibir la respuesta. Para comprobarlo, ve a tu cuenta. Si la ves, sigue activa y puedes volver a intentarlo. Si te pide entrar, entra con tu correo y tu contraseña: si entras, la cuenta sigue activa. Si te dice que el correo o la contraseña son incorrectos y has escrito bien la contraseña, lo más probable es que se haya eliminado. Si te dice que hay demasiados intentos o que algo ha fallado, espera unos minutos y vuelve a intentarlo: eso no dice nada sobre tu cuenta.';
const CHECK_ACCOUNT_LINK = 'Ir a mi cuenta para comprobarlo';
const LOGIN_SERVER_ERROR =
  'Algo ha fallado por nuestra parte y no hemos podido iniciar tu sesión. Inténtalo de nuevo en unos minutos.';
const LOGOUT_SERVER_ERROR =
  'Algo ha fallado por nuestra parte y no hemos podido cerrar tu sesión. Inténtalo de nuevo en unos minutos.';

const REGISTER = 'POST /auth/register';
const DELETION = 'POST /users/me/deletion';

let proxy: ApiProxy;
let stack: Stack;

test.beforeAll(async () => {
  proxy = await startApiProxy();
  // Límites x100: todas las peticiones llegan desde la misma IP.
  stack = await startStack({ webApiUrl: proxy.url, rateLimitFactor: 100 });
  proxy.setTarget(stack.apiUrl);
});
test.afterAll(async () => {
  await stack?.stopAll();
  await proxy?.close();
  await closeDb();
});
test.afterEach(() => {
  proxy.setFault(REGISTER, null);
  proxy.setFault(DELETION, null);
  proxy.setFault('POST /auth/login', null);
  proxy.setFault('POST /auth/logout', null);
});

/** Estado de la acción: el HTTP sin JavaScript, el del JSON de `use:enhance` con él. */
async function actionStatus(page: Page, path: string, submit: () => Promise<void>) {
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes(path), {
      timeout: 15_000,
    }),
    submit(),
  ]);
  if ((response.headers()['content-type'] ?? '').includes('application/json')) {
    return ((await response.json()) as { status?: number }).status;
  }
  return response.status();
}

/** Lo común a los dos casos (criterio 64) y lo que nunca debe aparecer (criterios 60 y 62). */
async function expectUncertainBlock(
  page: Page,
  javaScriptEnabled: boolean,
  text: string,
  title: string,
  button: string,
): Promise<void> {
  const summary = page.locator('main > .error-summary');
  await expect(summary).toHaveAttribute('role', 'alert');
  await expect(summary).toHaveAttribute('tabindex', '-1');
  await expect(summary).toContainText(text);
  await expect(summary.getByRole('listitem')).toHaveCount(0);
  expect(
    await page.evaluate(() => document.querySelector('main')?.firstElementChild?.className),
  ).toBe('error-summary');
  await expect(page).toHaveTitle(title);
  if (javaScriptEnabled) await expect(summary).toBeFocused();
  await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);

  const main = await page.locator('main').innerText();
  expect(main).not.toMatch(/no hemos podido|sigue como estaba|OUTCOME_UNKNOWN|ECONN|fetch|503/);

  const submit = page.getByRole('button', { name: button });
  await expect(submit).toBeEnabled();
  await expect(submit).not.toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByLabel('Contraseña', { exact: true })).toHaveValue('');
}

/** Ruta a la que lleva un enlace (el `href` del HTML es relativo). */
const pathOf = (link: Locator) =>
  link.evaluate((anchor) => new URL((anchor as HTMLAnchorElement).href).pathname);

const hasSessionCookie = async (page: Page) =>
  (await page.context().cookies()).some((cookie) => cookie.name === 'cupidilla_session');

test(
  'C60, C61, C64: el registro se procesa pero la respuesta no llega; probar a entrar funciona',
  { tag: '@nojs' },
  async ({ browser, javaScriptEnabled }) => {
    const context = await browser.newContext({ baseURL: stack.webUrl, javaScriptEnabled });
    const page = await context.newPage();
    const email = uniqueEmail();
    proxy.setFault(REGISTER, 'cut');

    const status = await actionStatus(page, '/register', () => fillRegister(page, { email }));
    expect(status).toBe(503);
    expect(proxy.count(REGISTER)).toBe(1); // sin reintento automático
    expect((await rowsForEmail(email)).users).toBe(1); // la API sí lo procesó

    await expectUncertainBlock(
      page,
      javaScriptEnabled,
      REGISTER_UNCERTAIN,
      'Error: Crear cuenta — Cupidilla',
      'Crear cuenta',
    );
    expect(await hasSessionCookie(page)).toBe(false);
    await expect(page.getByLabel('Correo electrónico')).toHaveValue(email);
    await expect(page.getByLabel('Día')).toHaveValue('5');
    await expect(page.getByLabel('Mes')).toHaveValue('5');
    await expect(page.getByLabel('Año')).toHaveValue('1990');
    await expect(page.getByLabel(/Acepto las condiciones de uso/)).toBeChecked();
    expect(page.url()).not.toContain('?');
    expect(page.url()).not.toContain(encodeURIComponent(email));

    const link = page.locator('main > .error-summary').getByRole('link');
    await expect(link).toHaveText(CHECK_LOGIN_LINK);
    expect(await pathOf(link)).toBe('/login');
    await expect(link).toHaveAttribute('target', '_blank');

    // El enlace abre /login en otra pestaña; ahí se puede entrar porque la cuenta existe.
    const [tab] = await Promise.all([context.waitForEvent('page'), link.click()]);
    await tab.waitForLoadState();
    expect(new URL(tab.url()).pathname).toBe('/login');
    expect(tab.url()).not.toContain('?');
    await login(tab, email);
    await expect(tab).toHaveURL('/account');
    await tab.close();

    // Lo escrito sigue en la pestaña original.
    await expect(page.getByLabel('Correo electrónico')).toHaveValue(email);
    expect(proxy.count(REGISTER)).toBe(1);

    await context.close();
  },
);

test(
  'C60, C64: el registro no llega a responder (tiempo agotado); volver a enviar crea la cuenta',
  { tag: '@nojs' },
  async ({ browser, javaScriptEnabled }) => {
    const context = await browser.newContext({ baseURL: stack.webUrl, javaScriptEnabled });
    const page = await context.newPage();
    const email = uniqueEmail();
    proxy.setFault(REGISTER, 'hang');
    const before = proxy.count(REGISTER);

    const status = await actionStatus(page, '/register', () => fillRegister(page, { email }));
    expect(status).toBe(503);
    expect(proxy.count(REGISTER) - before).toBe(1);
    await expectUncertainBlock(
      page,
      javaScriptEnabled,
      REGISTER_UNCERTAIN,
      'Error: Crear cuenta — Cupidilla',
      'Crear cuenta',
    );
    expect(await hasSessionCookie(page)).toBe(false);
    expect((await rowsForEmail(email)).users).toBe(0);

    // Reintento a mano, como dice el texto: ahora sí se crea.
    proxy.setFault(REGISTER, null);
    await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(page).toHaveURL('/register/check-email');
    expect((await rowsForEmail(email)).users).toBe(1);

    await context.close();
  },
);

test(
  'si la cuenta ya se creó, volver a enviar el registro da la misma pantalla y no crea otra (correo §5.1)',
  { tag: '@nojs' },
  async ({ browser, javaScriptEnabled }) => {
    const context = await browser.newContext({ baseURL: stack.webUrl, javaScriptEnabled });
    const page = await context.newPage();
    const email = uniqueEmail();
    proxy.setFault(REGISTER, 'cut');
    await fillRegister(page, { email });
    await expect(page.getByText(REGISTER_UNCERTAIN)).toBeVisible();

    proxy.setFault(REGISTER, null);
    await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(page).toHaveURL('/register/check-email');
    expect((await rowsForEmail(email)).users).toBe(1);

    await context.close();
  },
);

/** Registra una cuenta (sin fallos) y abre /account/delete. */
async function signedInOnDeletePage(page: Page): Promise<string> {
  const email = await registerAdult(page);
  await page.goto('/account/delete');
  return email;
}

async function submitDeletion(page: Page): Promise<number | undefined> {
  return actionStatus(page, '/account/delete', async () => {
    await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Eliminar mi cuenta definitivamente' }).click();
  });
}

test(
  'C62, C63, C64: el borrado se procesa pero la respuesta no llega; comprobar lleva a /login',
  { tag: '@nojs' },
  async ({ browser, javaScriptEnabled }) => {
    const context = await browser.newContext({ baseURL: stack.webUrl, javaScriptEnabled });
    const page = await context.newPage();
    const email = await signedInOnDeletePage(page);
    proxy.setFault(DELETION, 'cut');

    expect(await submitDeletion(page)).toBe(503);
    expect(proxy.count(DELETION)).toBe(1);
    expect((await rowsForEmail(email)).users).toBe(0); // la API sí la borró

    await expectUncertainBlock(
      page,
      javaScriptEnabled,
      DELETE_UNCERTAIN,
      'Error: Eliminar tu cuenta — Cupidilla',
      'Eliminar mi cuenta definitivamente',
    );
    // La cookie se conserva: no sabemos qué ha pasado.
    expect(await hasSessionCookie(page)).toBe(true);
    await expect(page).not.toHaveURL(/notice=account-deleted/);

    const link = page.locator('main > .error-summary').getByRole('link');
    await expect(link).toHaveText(CHECK_ACCOUNT_LINK);
    expect(await pathOf(link)).toBe('/account');
    expect(await link.getAttribute('target')).toBeNull();

    await link.click();
    await expect(page).toHaveURL(/\/login/);
    expect(proxy.count(DELETION)).toBe(1);

    await context.close();
  },
);

test(
  'C62, C63, C64: el borrado no llega a responder (tiempo agotado); comprobar muestra /account',
  { tag: '@nojs' },
  async ({ browser, javaScriptEnabled }) => {
    const context = await browser.newContext({ baseURL: stack.webUrl, javaScriptEnabled });
    const page = await context.newPage();
    const email = await signedInOnDeletePage(page);
    proxy.setFault(DELETION, 'hang');
    const before = proxy.count(DELETION);

    expect(await submitDeletion(page)).toBe(503);
    expect(proxy.count(DELETION) - before).toBe(1);
    await expectUncertainBlock(
      page,
      javaScriptEnabled,
      DELETE_UNCERTAIN,
      'Error: Eliminar tu cuenta — Cupidilla',
      'Eliminar mi cuenta definitivamente',
    );
    expect(await hasSessionCookie(page)).toBe(true);
    expect((await rowsForEmail(email)).users).toBe(1);

    await page.locator('main > .error-summary').getByRole('link').click();
    await expect(page).toHaveURL('/account');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tu cuenta');

    await context.close();
  },
);

test(
  'C62, C63: borrado incierto sin borrar y con la sesión revocada: /login no confirma nada y se puede entrar',
  { tag: '@nojs' },
  async ({ browser, javaScriptEnabled }) => {
    const context = await browser.newContext({ baseURL: stack.webUrl, javaScriptEnabled });
    const page = await context.newPage();
    const email = await signedInOnDeletePage(page);
    proxy.setFault(DELETION, 'hang');
    const before = proxy.count(DELETION);

    expect(await submitDeletion(page)).toBe(503);
    const summary = page.locator('main > .error-summary');
    await expect(summary).toContainText(DELETE_UNCERTAIN);
    // El texto no afirma que ir a /login signifique que la cuenta se borró.
    await expect(page.locator('main')).not.toContainText('la cuenta ya no existe');
    expect((await rowsForEmail(email)).users).toBe(1);

    // La sesión caduca o se cierra con la cuenta activa.
    expect(await revokeSessionsForEmail(email)).toBe(1);
    await summary.getByRole('link', { name: CHECK_ACCOUNT_LINK }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('main')).not.toContainText('la cuenta ya no existe');

    // Con el correo y la contraseña correctos se entra: la cuenta sigue activa.
    await login(page, email);
    await expect(page).toHaveURL('/account');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tu cuenta');
    await expect(page.locator('main')).toContainText(email);
    expect(proxy.count(DELETION) - before).toBe(1); // sin reintento automático

    await context.close();
  },
);

test(
  'C62, C63: borrado incierto sin borrar, sesión revocada y /login que falla por servicio: su texto habitual, nada sobre el borrado',
  { tag: '@nojs' },
  async ({ browser, javaScriptEnabled }) => {
    const context = await browser.newContext({ baseURL: stack.webUrl, javaScriptEnabled });
    const page = await context.newPage();
    const email = await signedInOnDeletePage(page);
    proxy.setFault(DELETION, 'hang');

    expect(await submitDeletion(page)).toBe(503);
    await expect(page.locator('main > .error-summary')).toContainText(DELETE_UNCERTAIN);
    expect(await revokeSessionsForEmail(email)).toBe(1);

    await page
      .locator('main > .error-summary')
      .getByRole('link', { name: CHECK_ACCOUNT_LINK })
      .click();
    await expect(page).toHaveURL(/\/login/);

    // El servicio de entrada no responde: /login muestra su error de servidor de siempre.
    proxy.setFault('POST /auth/login', 'hang');
    await login(page, email);
    const main = page.locator('main');
    await expect(main).toContainText(LOGIN_SERVER_ERROR, { timeout: 15_000 });
    await expect(page.getByRole('alert')).toContainText(LOGIN_SERVER_ERROR);
    const text = await main.innerText();
    expect(text).not.toMatch(/eliminad|borrad|No sabemos si|ya no existe|sigue activa/i);

    // La cuenta sigue en la base de datos.
    expect((await rowsForEmail(email)).users).toBe(1);

    await context.close();
  },
);

test(
  'C65: OUTCOME_UNKNOWN nunca aparece en /login ni al cerrar sesión',
  { tag: '@nojs' },
  async ({ browser, javaScriptEnabled }) => {
    const context = await browser.newContext({ baseURL: stack.webUrl, javaScriptEnabled });
    const page = await context.newPage();
    const email = await registerAdult(page);

    // `hang` y no `cut`: si la API cerrara la sesión, /account ya no se podría volver a mostrar.
    proxy.setFault('POST /auth/logout', 'hang');
    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(page.getByRole('alert')).toContainText(LOGOUT_SERVER_ERROR, { timeout: 15_000 });
    await expect(page.locator('main')).not.toContainText('No sabemos si');

    proxy.setFault('POST /auth/logout', null);
    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(page).toHaveURL(/notice=signed-out/);

    proxy.setFault('POST /auth/login', 'hang');
    await page.goto('/login');
    await login(page, email);
    await expect(page.getByText(LOGIN_SERVER_ERROR)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('main')).not.toContainText('No sabemos si');

    await context.close();
  },
);
