import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PASSWORD, uniqueEmail } from './helpers/forms.ts';
import { waitForMail } from './helpers/mailpit.ts';
import { WEB_URL } from './helpers/oauth-env.ts';

/**
 * Comprobación antibots activada, con la dificultad mínima (técnico de captcha §13: CA14–CA17;
 * UX de captcha §10). Corre con `npm run test:e2e:captcha`.
 */
const WIDGET_LABEL = 'Comprobación automática contra robots';
const VERIFIED = 'Comprobado';

function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (/Content Security Policy|Refused to/i.test(text)) violations.push(text);
  });
  page.on('pageerror', (error) => violations.push(error.message));
  return violations;
}

/**
 * La web lee `captcha.enabled` de `GET /config` con una caché de 60 s, y tras un fallo no vuelve a
 * preguntar en 5 s. Si sondeó `/` antes de que la API escuchara, las primeras páginas saldrían sin
 * widget: se espera a que /register lo pinte.
 */
test.beforeAll(async () => {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const html = await fetch(`${WEB_URL}/register`).then((response) => response.text());
    if (html.includes('captcha-field')) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('La web no pinta la comprobación: ¿la API arrancó con CAPTCHA_ENABLED=true?');
});

/**
 * Playwright desactiva JavaScript sin quitar el indicador de *scripting* del analizador de HTML: el
 * contenido de `<noscript>` no se pinta. Se comprueba en el HTML que llega.
 */
async function noscriptNotice(page: Page, field: string): Promise<string> {
  const html = await page.content();
  const start = html.indexOf('<noscript><div id="captcha"');
  expect(start).toBeGreaterThan(-1);
  expect(start).toBeLessThan(html.indexOf(`name="${field}"`));
  return html.slice(start, html.indexOf('</noscript>', start));
}

async function fillRegisterFields(page: Page, email: string) {
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Día').fill('5');
  await page.getByLabel('Mes').fill('5');
  await page.getByLabel('Año').fill('1990');
  await page.getByLabel(/Acepto las condiciones de uso/).check();
}

async function fillContact(page: Page, email: string, subject: string) {
  await page.getByLabel('Nombre', { exact: true }).fill('Lucía Pérez');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Asunto').fill(subject);
  await page.getByLabel('Mensaje').fill('Hola,\nno me llega el correo.');
  await page.getByLabel('He leído y acepto la política de privacidad.').check();
}

test.describe('Con JavaScript', () => {
  test('CA14 y CA16: /register se comprueba al entrar en un campo, llega a check-email y sin violaciones de CSP', async ({
    page,
  }) => {
    const violations = watchCsp(page);
    const workers: string[] = [];
    page.on('worker', (worker) => workers.push(worker.url()));
    const response = await page.goto('/register');
    expect(response?.headers()['content-security-policy']).toContain("worker-src 'self'");
    await expect(page.locator('altcha-widget')).toHaveCount(1);
    await expect(page.locator('altcha-widget input[type="hidden"][name="captcha"]')).toHaveCount(1);
    await expect(page.getByText('Protegido por')).toHaveCount(0);
    const email = uniqueEmail();
    await fillRegisterFields(page, email);
    await expect(page.locator('altcha-widget').getByText(VERIFIED)).toBeVisible();
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(page).toHaveURL('/register/check-email');
    await waitForMail(email, { subject: 'Confirma tu correo' });
    expect(workers.length).toBeGreaterThan(0);
    for (const url of workers) expect(url).toMatch(/^http:\/\/localhost:\d+\/_app\//);
    expect(violations).toEqual([]);
  });

  test('CA14: /contact llega a «Mensaje enviado»', async ({ page }) => {
    const violations = watchCsp(page);
    await page.goto('/contact');
    await fillContact(page, uniqueEmail(), `Duda ${randomUUID()}`);
    await expect(page.locator('altcha-widget').getByText(VERIFIED)).toBeVisible();
    await page.getByRole('button', { name: 'Enviar mensaje' }).click();
    await expect(page).toHaveURL('/contact/sent');
    expect(violations).toEqual([]);
  });

  test('CA15: con el reto retrasado, Intro dos veces envía una sola vez tras «Comprobando y enviando…»', async ({
    page,
  }) => {
    const posts: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST') posts.push(request.url());
    });
    await page.route('**/captcha/challenge', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await route.continue();
    });
    await page.goto('/forgot-password');
    const email = page.getByLabel('Correo electrónico');
    await email.fill(uniqueEmail());
    await email.press('Enter');
    await email.press('Enter');
    await expect(page.getByRole('button', { name: 'Enviando…' })).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: 'Comprobando y enviando…' }),
    ).toHaveCount(1);
    await expect(page).toHaveURL('/forgot-password/check-email');
    expect(posts.filter((url) => url.includes('/forgot-password'))).toHaveLength(1);
  });

  test('UX 6: si el reto falla, el widget enseña su error con role=alert y no se pierde nada', async ({
    page,
  }) => {
    await page.route('**/captcha/challenge', (route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"x"}' }),
    );
    await page.goto('/forgot-password');
    await page.getByLabel('Correo electrónico').fill('ana@example.com');
    await expect(
      page.getByRole('alert').filter({ hasText: 'No hemos podido hacer la comprobación' }),
    ).toBeVisible();
    await expect(page.getByLabel('Correo electrónico')).toHaveValue('ana@example.com');
  });

  test('UX 9: con el reto parado más de 20 s tras pulsar Enviar, aviso del tope y nada enviado', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const posts: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST') posts.push(request.url());
    });
    await page.route('**/captcha/challenge', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 30_000));
      await route.continue().catch(() => undefined);
    });
    await page.goto('/forgot-password');
    const email = page.getByLabel('Correo electrónico');
    await email.fill('ana@example.com');
    await email.press('Enter');
    await expect(
      page.getByRole('alert').filter({ hasText: 'La comprobación está tardando demasiado.' }),
    ).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole('button', { name: 'Enviar enlace' })).toBeVisible();
    await expect(page.locator('altcha-widget input[type="checkbox"]')).toBeFocused();
    await expect(email).toHaveValue('ana@example.com');
    expect(posts).toEqual([]);
  });

  test('UX 11: CAPTCHA_INVALID del servidor vuelve con el enlace a #captcha y lo escrito', async ({
    page,
  }) => {
    // Una solución ya usada: la API la rechaza (técnico de captcha CA5).
    const solution = page.locator('input[name="captcha"]');
    await page.goto('/contact');
    const subject = `Duda ${randomUUID()}`;
    await fillContact(page, uniqueEmail(), subject);
    await expect(page.locator('altcha-widget').getByText(VERIFIED)).toBeVisible();
    const used = await solution.inputValue();
    await page.getByRole('button', { name: 'Enviar mensaje' }).click();
    await expect(page).toHaveURL('/contact/sent');

    await page.goto('/contact');
    await fillContact(page, uniqueEmail(), subject);
    await expect(page.locator('altcha-widget').getByText(VERIFIED)).toBeVisible();
    await solution.evaluate((input, value) => ((input as HTMLInputElement).value = value), used);
    await page.getByRole('button', { name: 'Enviar mensaje' }).click();
    const link = page.locator('.error-summary a[href="#captcha"]');
    await expect(link).toContainText('La comprobación automática ha caducado o no es válida.');
    await expect(page.getByLabel('Asunto')).toHaveValue(subject);
    await link.click();
    await expect(page.locator('altcha-widget input[type="checkbox"]')).toBeFocused();
  });

  test('UX 10: el reenvío de /register/check-email funciona con el widget invisible', async ({
    page,
  }) => {
    await page.goto('/register');
    const email = uniqueEmail();
    await fillRegisterFields(page, email);
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(page).toHaveURL('/register/check-email');
    await expect(page.getByLabel(WIDGET_LABEL)).toBeHidden();
    await page.getByRole('button', { name: 'Enviar otro mensaje' }).click();
    await expect(page).toHaveURL('/register/check-email?notice=resent');
  });
});

test.describe('Sin JavaScript', () => {
  test(
    'CA17: /register avisa antes del primer campo y, al enviar, conserva los datos sin crear cuenta',
    { tag: '@nojs' },
    async ({ page }) => {
      await page.goto('/register');
      const notice = await noscriptNotice(page, 'email');
      expect(notice).toContain('Este formulario necesita JavaScript.');
      expect(notice).toContain('Actívalo para crear tu cuenta.');
      expect(notice).toContain('También puedes entrar con Google o Facebook.');
      expect(notice).toContain('href="mailto:soporte@example.com"');
      await expect(page.locator('altcha-widget')).toHaveCount(0);

      const email = uniqueEmail();
      await fillRegisterFields(page, email);
      await page.getByRole('button', { name: 'Crear cuenta' }).click();
      await expect(page).toHaveTitle(/^Error: /);
      const link = page.locator('.error-summary a[href="#captcha"]');
      await expect(link).toContainText('Falta la comprobación automática.');
      await expect(page.getByLabel('Correo electrónico')).toHaveValue(email);
      await expect(page.getByLabel('Año')).toHaveValue('1990');
      await expect(page.getByLabel('Contraseña', { exact: true })).toHaveValue('');
    },
  );

  test('CA17: /contact conserva nombre, asunto y mensaje', { tag: '@nojs' }, async ({ page }) => {
    await page.goto('/contact');
    expect(await noscriptNotice(page, 'name')).toContain('Actívalo para enviar tu mensaje.');
    const subject = `Duda ${randomUUID()}`;
    await fillContact(page, uniqueEmail(), subject);
    await page.getByRole('button', { name: 'Enviar mensaje' }).click();
    await expect(page.locator('.error-summary a[href="#captcha"]')).toBeVisible();
    await expect(page.getByLabel('Nombre', { exact: true })).toHaveValue('Lucía Pérez');
    await expect(page.getByLabel('Asunto')).toHaveValue(subject);
    await expect(page.getByLabel('Mensaje')).toHaveValue('Hola,\nno me llega el correo.');
  });

  test('CA25: el login no lleva aviso ni widget', { tag: '@nojs' }, async ({ page }) => {
    await page.goto('/login');
    expect(await page.content()).not.toContain('<noscript><div id="captcha"');
    await expect(page.locator('altcha-widget')).toHaveCount(0);
  });
});
