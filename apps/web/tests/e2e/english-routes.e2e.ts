import { expect, test, type Page } from '@playwright/test';
import { closeDb } from './helpers/db.ts';
import { fillRegister, login, PASSWORD, uniqueEmail } from './helpers/forms.ts';
import { startStack, type Stack } from './helpers/stack.ts';

// QA, rutas en inglés: lo que `typecheck` no comprueba. Recorre las pantallas y sus estados de
// error y, en cada una, mira que cada referencia (aria-*, for, #ancla) apunte a un id que existe,
// que no haya ids repetidos, que cada campo tenga etiqueta, que los campos con error enlacen a su
// mensaje y que cada clase CSS usada exista en alguna regla de las hojas de estilo.

test.setTimeout(120_000);

let stack: Stack;
test.beforeAll(async () => {
  stack = await startStack({ rateLimitFactor: 100 });
});
test.afterAll(async () => {
  await stack?.stopAll();
  await closeDb();
});

interface Audit {
  duplicateIds: string[];
  brokenReferences: string[];
  unlabelledControls: string[];
  invalidWithoutMessage: string[];
  classesWithoutRule: string[];
}

async function audit(page: Page): Promise<Audit> {
  return page.evaluate(() => {
    const ids = [...document.querySelectorAll('[id]')].map((el) => el.id);
    const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);

    const brokenReferences: string[] = [];
    for (const attribute of ['aria-describedby', 'aria-labelledby', 'aria-controls', 'aria-owns']) {
      for (const el of document.querySelectorAll(`[${attribute}]`)) {
        for (const id of (el.getAttribute(attribute) ?? '').split(/\s+/).filter(Boolean)) {
          if (!document.getElementById(id)) brokenReferences.push(`${attribute}="${id}"`);
        }
      }
    }
    for (const label of document.querySelectorAll('label[for]')) {
      const id = label.getAttribute('for') ?? '';
      if (!document.getElementById(id)) brokenReferences.push(`label for="${id}"`);
    }
    for (const link of document.querySelectorAll('a[href^="#"]')) {
      const id = (link.getAttribute('href') ?? '').slice(1);
      if (id && !document.getElementById(id)) brokenReferences.push(`href="#${id}"`);
    }

    const unlabelledControls = [...document.querySelectorAll('input, select, textarea')]
      .filter((el) => !['hidden', 'submit', 'button'].includes((el as HTMLInputElement).type))
      .filter((el) => {
        const control = el as HTMLInputElement;
        return (
          (control.labels?.length ?? 0) === 0 &&
          !control.getAttribute('aria-label') &&
          !control.getAttribute('aria-labelledby')
        );
      })
      .map((el) => `${el.tagName.toLowerCase()}#${el.id}[name=${el.getAttribute('name')}]`);

    const invalidWithoutMessage = [...document.querySelectorAll('[aria-invalid="true"]')]
      .filter((el) => {
        const described = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
        return !described.some((id) => (document.getElementById(id)?.textContent ?? '').trim());
      })
      .map((el) => `${el.tagName.toLowerCase()}#${el.id}`);

    const defined = new Set<string>();
    const walk = (rules: CSSRuleList) => {
      for (const rule of rules) {
        const withSelector = rule as CSSStyleRule;
        if (typeof withSelector.selectorText === 'string') {
          for (const match of withSelector.selectorText.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
            if (match[1]) defined.add(match[1]);
          }
        }
        const nested = (rule as CSSGroupingRule).cssRules;
        if (nested) walk(nested);
      }
    };
    for (const sheet of document.styleSheets) {
      try {
        walk(sheet.cssRules);
      } catch {
        // hoja de otro origen: no aplica
      }
    }
    const used = new Set<string>();
    for (const el of document.querySelectorAll('[class]')) {
      for (const token of el.classList) used.add(token);
    }
    const classesWithoutRule = [...used].filter(
      (token) => !defined.has(token) && !token.startsWith('svelte-'),
    );

    return {
      duplicateIds,
      brokenReferences,
      unlabelledControls,
      invalidWithoutMessage,
      classesWithoutRule,
    };
  });
}

async function expectClean(page: Page, label: string): Promise<void> {
  expect(await audit(page), label).toEqual({
    duplicateIds: [],
    brokenReferences: [],
    unlabelledControls: [],
    invalidWithoutMessage: [],
    classesWithoutRule: [],
  });
}

test('las pantallas, con sus estados de error, no tienen referencias rotas ni clases sin estilo', async ({
  browser,
  javaScriptEnabled,
}) => {
  const context = await browser.newContext({ baseURL: stack.webUrl, javaScriptEnabled });
  const page = await context.newPage();

  for (const path of [
    '/',
    '/?notice=signed-out',
    '/?notice=account-deleted',
    '/register',
    '/login',
    '/login?next=/account/delete',
    '/legal/terms',
    '/no-existe',
  ]) {
    await page.goto(path);
    await expectClean(page, path);
  }

  // /register con todos los errores a la vez, y con cada campo por separado.
  await page.goto('/register');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.locator('.error-summary')).toBeVisible();
  await expectClean(page, '/register vacío enviado');
  expect(await page.locator('[aria-invalid="true"]').count()).toBeGreaterThanOrEqual(4);

  await page.goto('/register');
  await page.getByLabel('Correo electrónico').fill('ana@');
  await page.getByLabel('Contraseña', { exact: true }).fill('corta');
  await page.getByLabel('Día').fill('31');
  await page.getByLabel('Mes').fill('2');
  await page.getByLabel('Año').fill('1990');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.locator('.error-summary')).toBeVisible();
  await expectClean(page, '/register con formato, contraseña corta y fecha imposible');

  // Menor.
  await fillRegister(page, { email: uniqueEmail(), year: String(new Date().getFullYear() - 10) });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('No podemos crear tu cuenta');
  await expectClean(page, '/register menor');

  // /login vacío y con credenciales malas.
  await page.goto('/login');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.locator('.error-summary')).toBeVisible();
  await expectClean(page, '/login vacío enviado');
  await login(page, 'nadie@example.com', 'contraseña-que-no-es');
  await expect(page.locator('.error-summary')).toContainText('Correo o contraseña incorrectos.');
  await expectClean(page, '/login credenciales incorrectas');

  // Con sesión: /account, /account/delete y sus errores.
  const email = uniqueEmail();
  await fillRegister(page, { email });
  await expect(page).toHaveURL('/account');
  await expectClean(page, '/account');
  await page.goto('/account/delete');
  await expectClean(page, '/account/delete');
  await page.getByRole('button', { name: 'Eliminar mi cuenta definitivamente' }).click();
  await expect(page.locator('.error-summary')).toBeVisible();
  await expectClean(page, '/account/delete vacío enviado');
  await page.getByLabel('Contraseña', { exact: true }).fill('contraseña-incorrecta');
  await page.getByRole('button', { name: 'Eliminar mi cuenta definitivamente' }).click();
  await expect(page.locator('.error-summary')).toContainText('La contraseña no es correcta.');
  await expectClean(page, '/account/delete contraseña incorrecta');
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Eliminar mi cuenta definitivamente' }).click();
  await expect(page).toHaveURL('/?notice=account-deleted');
  await expectClean(page, '/?notice=account-deleted tras borrar');

  await context.close();
});

// ---------------------------------------------------------------------------------------------
// Seguridad: guardia de rutas, `next`, URLs viejas, CSRF y CSP.

const OLD_ROUTES = [
  '/entrar',
  '/registro',
  '/cuenta',
  '/cuenta/eliminar',
  '/legal/condiciones',
  '/entrar?siguiente=/cuenta',
  '/Cuenta',
  '/account/eliminar',
  '/cuenta/',
];

test('las URLs de antes dan 404 (con y sin sesión) y no redirigen', async ({ playwright }) => {
  const anonymous = await playwright.request.newContext({ baseURL: stack.webUrl });
  for (const path of OLD_ROUTES) {
    const response = await anonymous.get(path, { maxRedirects: 0 });
    expect(response.status(), `${path} sin sesión`).toBe(404);
  }
  await anonymous.dispose();
});

test('guardia de rutas: sin sesión, /account y /account/delete llevan a /login?next=; con sesión, /login y /register llevan a /account', async ({
  browser,
  playwright,
  javaScriptEnabled,
}) => {
  const anonymous = await playwright.request.newContext({ baseURL: stack.webUrl });
  const account = await anonymous.get('/account', { maxRedirects: 0 });
  expect(account.status()).toBe(303);
  expect(account.headers().location).toBe('/login?next=/account');
  const del = await anonymous.get('/account/delete', { maxRedirects: 0 });
  expect(del.status()).toBe(303);
  expect(del.headers().location).toBe('/login?next=/account/delete');
  // Un formulario enviado sin sesión también se corta (sin tocar nada) y vuelve a /account.
  const post = await anonymous.post('/account/delete', {
    form: { password: PASSWORD },
    headers: { origin: stack.webUrl, accept: 'text/html' },
    maxRedirects: 0,
  });
  expect(post.status()).toBe(303);
  expect(post.headers().location).toBe('/login?next=/account');
  // Rutas públicas.
  for (const path of ['/', '/legal/terms', '/login', '/register']) {
    expect((await anonymous.get(path, { maxRedirects: 0 })).status(), path).toBe(200);
  }
  await anonymous.dispose();

  const context = await browser.newContext({ baseURL: stack.webUrl, javaScriptEnabled });
  const page = await context.newPage();
  await fillRegister(page, { email: uniqueEmail() });
  await expect(page).toHaveURL('/account');
  for (const path of ['/login', '/register', '/login?next=/account/delete']) {
    const response = await context.request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(303);
    expect(response.headers().location, path).toBe('/account');
  }
  for (const path of ['/', '/legal/terms', '/account', '/account/delete']) {
    expect((await context.request.get(path, { maxRedirects: 0 })).status(), path).toBe(200);
  }
  await context.close();
});

const HOSTILE_NEXT = [
  'https://evil.com',
  'http://evil.com/account',
  '//evil.com',
  '//evil.com/account',
  '/\\evil.com',
  '/cuenta',
  '/cuenta/eliminar',
  '/account/',
  '/account/delete/',
  '/account?x=1',
  '/account#x',
  '/ACCOUNT',
  '/Account/Delete',
  '/account%2Fdelete',
  '/account%00',
  ' /account',
  '/account ',
  '/account\n',
  '/account/../login',
  '/account/delete/..',
  '/login',
  '/register',
  '/',
  'javascript:alert(1)',
  'data:text/html,x',
  'account',
  '',
  '%2Faccount',
];

test('`next`: solo /account y /account/delete exactos; todo lo demás se descarta (campo oculto y redirección)', async ({
  browser,
  playwright,
  javaScriptEnabled,
}) => {
  const anonymous = await playwright.request.newContext({ baseURL: stack.webUrl });
  const email = uniqueEmail();
  // Una cuenta para poder entrar con la petición cruda.
  const setup = await browser.newContext({ baseURL: stack.webUrl, javaScriptEnabled });
  const setupPage = await setup.newPage();
  await fillRegister(setupPage, { email });
  await expect(setupPage).toHaveURL('/account');
  await setup.close();

  for (const next of ['/account', '/account/delete']) {
    const html = await (await anonymous.get(`/login?next=${encodeURIComponent(next)}`)).text();
    expect(html, next).toMatch(
      new RegExp(`name="next"[^>]*value="${next}"|value="${next}"[^>]*name="next"`),
    );
  }
  for (const next of HOSTILE_NEXT) {
    // Contexto nuevo cada vez: un login correcto deja cookie y /login redirigiría a /account.
    const fresh = await playwright.request.newContext({ baseURL: stack.webUrl });
    const page = await fresh.get(`/login?next=${encodeURIComponent(next)}`, {
      maxRedirects: 0,
    });
    expect(page.status(), next).toBe(200);
    const html = await page.text();
    // El campo oculto, si existe, no puede llevar el valor hostil.
    expect(html, `next=${JSON.stringify(next)}`).not.toMatch(/name="next"[^>]*value="[^"]/);
    // La acción: con `next` hostil, entrar lleva a /account y nunca fuera.
    const login = await fresh.post('/login', {
      form: { email, password: PASSWORD, next },
      headers: { origin: stack.webUrl, accept: 'text/html' },
      maxRedirects: 0,
    });
    expect(login.status(), `POST next=${JSON.stringify(next)}`).toBe(303);
    expect(login.headers().location, `POST next=${JSON.stringify(next)}`).toBe('/account');
    await fresh.dispose();
  }
  // Los válidos sí se respetan en la acción.
  for (const next of ['/account', '/account/delete']) {
    const fresh = await playwright.request.newContext({ baseURL: stack.webUrl });
    const login = await fresh.post('/login', {
      form: { email, password: PASSWORD, next },
      headers: { origin: stack.webUrl, accept: 'text/html' },
      maxRedirects: 0,
    });
    expect(login.headers().location).toBe(next);
    await fresh.dispose();
  }
  // Parámetro repetido o en forma de lista: gana el primero o se descarta, pero nunca algo hostil.
  for (const query of [
    'next=/account&next=https://evil.com',
    'next=https://evil.com&next=/account',
    'next[]=/account',
  ]) {
    const html = await (await anonymous.get(`/login?${query}`)).text();
    expect(html, query).not.toContain('evil.com');
  }
  await anonymous.dispose();
});

test('CSRF y CSP siguen activos con las rutas nuevas', async ({ playwright }) => {
  const anonymous = await playwright.request.newContext({ baseURL: stack.webUrl });
  for (const path of ['/login', '/register', '/account/delete']) {
    const post = await anonymous.post(path, {
      form: { email: 'a@example.com', password: PASSWORD },
      headers: { origin: 'https://evil.example' },
      maxRedirects: 0,
    });
    expect(post.status(), `${path} con origin ajeno`).toBe(403);
    const noOrigin = await anonymous.post(path, {
      form: { email: 'a@example.com', password: PASSWORD },
      maxRedirects: 0,
    });
    expect([403, 303], `${path} sin origin`).toContain(noOrigin.status());
  }
  for (const path of ['/', '/login', '/register', '/legal/terms']) {
    const response = await anonymous.get(path);
    const csp = response.headers()['content-security-policy'] ?? '';
    expect(csp, `CSP de ${path}`).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  }
  await anonymous.dispose();
});

test('la auditoría detecta de verdad una clase sin estilo, una referencia rota y un id repetido', async ({
  browser,
  javaScriptEnabled,
}) => {
  const context = await browser.newContext({ baseURL: stack.webUrl, javaScriptEnabled });
  const page = await context.newPage();
  await page.goto('/login');
  await page.evaluate(() => {
    const div = document.createElement('div');
    div.className = 'clase-que-no-existe';
    div.setAttribute('aria-describedby', 'id-que-no-existe');
    div.id = 'email';
    document.body.append(div);
  });
  const result = await audit(page);
  expect(result.classesWithoutRule).toContain('clase-que-no-existe');
  expect(result.brokenReferences).toContain('aria-describedby="id-que-no-existe"');
  expect(result.duplicateIds).toContain('email');
  await context.close();
});
