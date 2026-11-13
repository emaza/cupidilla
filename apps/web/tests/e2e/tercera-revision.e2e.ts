import { expect, test } from '@playwright/test';
import { startApiProxy, type ApiProxy } from './helpers/api-proxy.ts';
import { closeDb } from './helpers/db.ts';
import { fillRegister, uniqueEmail, PASSWORD } from './helpers/forms.ts';
import { startStack, type Stack } from './helpers/stack.ts';

// Tercera revisión (QA): detalles del enlace de comprobación del resultado incierto (criterios
// 61 y 63) que `outcome-unknown.e2e.ts` no mira.

test.setTimeout(120_000);

let proxy: ApiProxy;
let stack: Stack;

test.beforeAll(async () => {
  proxy = await startApiProxy();
  stack = await startStack({ webApiUrl: proxy.url, rateLimitFactor: 100 });
  proxy.setTarget(stack.apiUrl);
});
test.afterAll(async () => {
  await stack?.stopAll();
  await proxy?.close();
  await closeDb();
});
test.afterEach(() => {
  proxy.setFault('POST /auth/register', null);
  proxy.setFault('POST /users/me/deletion', null);
});

test('[QA-3] registro incierto: el enlace a /entrar lleva rel="noopener", target=_blank y nada en la URL', async ({
  browser,
  javaScriptEnabled,
}) => {
  const context = await browser.newContext({ baseURL: stack.webUrl, javaScriptEnabled });
  const page = await context.newPage();
  const email = uniqueEmail();
  proxy.setFault('POST /auth/register', 'cut');
  await fillRegister(page, { email });

  const link = page.locator('main > .resumen-errores a');
  await expect(link).toHaveCount(1);
  await expect(link).toHaveAttribute('target', '_blank');
  const rel = (await link.getAttribute('rel')) ?? '';
  expect(rel.split(/\s+/)).toContain('noopener');
  const href = (await link.getAttribute('href')) ?? '';
  expect(href).not.toContain('?');
  expect(href).not.toContain('@');
  expect(decodeURIComponent(href)).not.toContain(email);
  // El enlace va después del texto, dentro del bloque de alerta.
  const order = await page.evaluate(() => {
    const block = document.querySelector('main > .resumen-errores');
    const kids = [...(block?.children ?? [])].map(
      (el) => el.tagName + (el.querySelector('a') ? '+a' : ''),
    );
    return kids;
  });
  expect(order.at(-1)).toBe('P+a');
  // La pestaña nueva no puede manipular a la original.
  const [tab] = await Promise.all([context.waitForEvent('page'), link.click()]);
  await tab.waitForLoadState();
  expect(await tab.evaluate(() => window.opener)).toBeNull();
  await context.close();
});

test('[QA-3] borrado incierto: el enlace a /cuenta es de la misma pestaña, sin target y recarga completa', async ({
  browser,
  javaScriptEnabled,
}) => {
  const context = await browser.newContext({ baseURL: stack.webUrl, javaScriptEnabled });
  const page = await context.newPage();
  await fillRegister(page, { email: uniqueEmail() });
  await expect(page).toHaveURL('/cuenta');
  await page.goto('/cuenta/eliminar');
  proxy.setFault('POST /users/me/deletion', 'cut');
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Eliminar mi cuenta definitivamente' }).click();

  const link = page.locator('main > .resumen-errores a');
  await expect(link).toHaveCount(1);
  await expect(link).toHaveText('Ir a mi cuenta para comprobarlo');
  await expect(link).not.toHaveAttribute('target', /.+/);
  await expect(link).toHaveAttribute('data-sveltekit-reload', /.*/);
  // Pasar el ratón por encima no debe dejar datos de /cuenta precargados: se comprueba que, al
  // pulsar, el servidor ve la petición de /cuenta (la cuenta ya se borró: lleva a /entrar).
  await link.hover();
  await link.click();
  await expect(page).toHaveURL(/\/entrar/);
  await context.close();
});
