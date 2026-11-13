import { expect, test, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { closeDb } from './helpers/db.ts';
import { fillRegister, PASSWORD, registerAdult, uniqueEmail } from './helpers/forms.ts';

// Criterios de accesibilidad, estructura y adaptación de UX §9 que se pueden comprobar sin un lector
// de pantalla: estructura del DOM, atributos ARIA, orden de tabulación, tamaños y desbordamiento.
// Se repiten con y sin JavaScript.

test.afterAll(closeDb);

/** Texto accesible de lo enfocado: id o nombre visible. */
async function focusedLabel(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return '(cuerpo)';
    return element.id ? `#${element.id}` : (element.textContent ?? '').trim().replace(/\s+/g, ' ');
  });
}

/** Pulsa Tab hasta llegar al final de la página y devuelve lo enfocado en cada paso. */
async function tabOrder(page: Page, max = 40): Promise<string[]> {
  const order: string[] = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const label = await focusedLabel(page);
    if (label === '(cuerpo)') break;
    order.push(label);
  }
  return order;
}

async function expectNoHorizontalScroll(page: Page, where: string): Promise<void> {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, `desplazamiento horizontal en ${where}`).toBeLessThanOrEqual(client);
}

test('C23/C24/C33/C46: atributos de los campos, fecha en fieldset sin date/number y sin placeholders', async ({
  page,
}) => {
  await page.goto('/register');
  const attributes = (locator: Locator, names: string[]) =>
    Promise.all(names.map((name) => locator.getAttribute(name)));

  expect(await attributes(page.locator('#email'), ['type', 'autocomplete', 'inputmode'])).toEqual([
    'email',
    'username',
    'email',
  ]);
  expect(await attributes(page.locator('#password'), ['type', 'autocomplete'])).toEqual([
    'password',
    'new-password',
  ]);
  for (const [id, autocomplete] of [
    ['day', 'bday-day'],
    ['month', 'bday-month'],
    ['year', 'bday-year'],
  ] as const) {
    expect(await attributes(page.locator(`#${id}`), ['type', 'inputmode', 'autocomplete'])).toEqual(
      ['text', 'numeric', autocomplete],
    );
  }
  await expect(page.locator('fieldset legend')).toHaveText('Fecha de nacimiento');
  await expect(page.locator('fieldset input[type="text"]')).toHaveCount(3);
  await expect(page.locator('input[type="date"], input[type="number"]')).toHaveCount(0);
  await expect(page.locator('[placeholder]')).toHaveCount(0);
  await expect(page.locator('#acceptTerms')).not.toBeChecked();

  // Todo control visible tiene una etiqueta asociada.
  const unlabeled = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLInputElement>('input:not([type="hidden"])')]
      .filter((input) => !input.labels || input.labels.length === 0)
      .map((input) => input.id),
  );
  expect(unlabeled).toEqual([]);
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
});

test('C34/C35/C36/C37: con errores, el resumen es lo primero de <main>, enlaza a los campos y los asocia por ARIA', async ({
  page,
  javaScriptEnabled,
}) => {
  await fillRegister(page, {
    email: 'MAL CORREO',
    password: 'corta',
    day: '31',
    month: '2',
    year: '2000',
    acceptTerms: false,
  });

  const summary = page.locator('main > .error-summary');
  await expect(summary).toBeVisible();
  // Es lo primero dentro de <main>, antes de la <h1>.
  expect(
    await page.evaluate(() => document.querySelector('main')?.firstElementChild?.className),
  ).toBe('error-summary');
  await expect(summary.getByRole('heading', { level: 2 })).toHaveText(
    'Revisa esto antes de seguir',
  );
  await expect(page).toHaveTitle('Error: Crear cuenta — Cupidilla');
  if (javaScriptEnabled) await expect(summary).toBeFocused();

  const links = summary.getByRole('link');
  await expect(links).toHaveCount(4);
  expect(await links.evaluateAll((els) => els.map((el) => el.getAttribute('href')))).toEqual([
    '#email',
    '#password',
    '#day',
    '#acceptTerms',
  ]);

  // Cada campo con error: aria-invalid y aria-describedby apuntando a elementos que existen.
  const expectations: Record<string, string[]> = {
    email: ['email-error'],
    password: ['password-help', 'password-error'],
    day: ['birth-date-error'],
    month: ['birth-date-error'],
    year: ['birth-date-error'],
    acceptTerms: ['accept-terms-help', 'accept-terms-error'],
  };
  for (const [id, described] of Object.entries(expectations)) {
    const field = page.locator(`#${id}`);
    await expect(field, id).toHaveAttribute('aria-invalid', 'true');
    expect((await field.getAttribute('aria-describedby'))?.split(' '), id).toEqual(described);
    for (const target of described) await expect(page.locator(`#${target}`), target).toHaveCount(1);
  }
  // Los errores llevan texto oculto «Error:», un icono y el color: no dependen solo del color.
  await expect(page.locator('#email-error .visually-hidden')).toHaveText('Error:');
  await expect(page.locator('#email-error .icon')).toHaveText('⚠');

  // El enlace del resumen lleva al campo.
  await links.nth(1).click();
  if (javaScriptEnabled) await expect(page.locator('#password')).toBeFocused();
  else await expect(page).toHaveURL(/#password$/);

  // Un campo sin error no tiene aria-invalid ni describedby de error.
  await fillRegister(page, { email: uniqueEmail(), password: 'corta' });
  await expect(page.locator('#password-error')).toBeVisible();
  await expect(page.locator('#email')).not.toHaveAttribute('aria-invalid', /.*/);
  await expect(page.locator('#day')).not.toHaveAttribute('aria-invalid', /.*/);
  await expect(page.locator('#day')).not.toHaveAttribute('aria-describedby', /.*/);
});

test('C59: la contraseña nunca reaparece en el HTML tras un error en registro, entrada y eliminar', async ({
  page,
}) => {
  const secret = 'contraseña-secreta-que-no-debe-volver';
  await fillRegister(page, { email: 'mal', password: secret });
  await expect(page.locator('#email-error')).toBeVisible();
  expect(await page.content()).not.toContain(secret);
  await expect(page.locator('#password')).toHaveValue('');
  expect(await page.locator('#password').getAttribute('value')).toBeNull();

  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill('alguien@example.com');
  await page.getByLabel('Contraseña', { exact: true }).fill(secret);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.locator('.error-summary')).toBeVisible();
  expect(await page.content()).not.toContain(secret);
  await expect(page.locator('#password')).toHaveValue('');

  await registerAdult(page);
  await page.goto('/account/delete');
  await page.getByLabel('Contraseña', { exact: true }).fill(secret);
  await page.getByRole('button', { name: 'Eliminar mi cuenta definitivamente' }).click();
  await expect(page.locator('#password-error')).toBeVisible();
  expect(await page.content()).not.toContain(secret);
  await expect(page.locator('#password')).toHaveValue('');
});

test('C38/C40: orden de tabulación de /register y «Saltar al contenido»', async ({
  page,
  javaScriptEnabled,
}) => {
  await page.goto('/register');
  const order = await tabOrder(page);
  const expected = [
    'Saltar al contenido',
    'Cupidilla',
    'Entrar',
    'Crear cuenta',
    // Botones de proveedor encima del formulario (UX terceros §3.1.1), en orden alfabético.
    'Continuar con Google',
    'Continuar con Facebook',
    '#email',
    '#password',
    ...(javaScriptEnabled ? ['Mostrar contraseña'] : []),
    '#day',
    '#month',
    '#year',
    '#acceptTerms',
    'Leer las condiciones (se abre en una pestaña nueva)',
    'Crear cuenta',
    '¿Ya tienes cuenta? Entra',
    'Condiciones de uso',
  ];
  expect(order).toEqual(expected);

  // «Saltar al contenido» es lo primero, se ve al recibir el foco y lleva a <main>.
  // Página nueva: el recorrido anterior dejó la ventana desplazada hasta el final y, al recargar la
  // misma URL, el navegador restaura ese desplazamiento (con la máquina cargada, DESPUÉS de que
  // Tab ya haya enfocado el enlace). El enlace seguía enfocado pero fuera de la pantalla, y el
  // test fallaba a ratos. Una pestaña nueva no tiene desplazamiento que restaurar.
  const fresh = await page.context().newPage();
  await fresh.goto('/register');
  await fresh.keyboard.press('Tab');
  const skip = fresh.getByRole('link', { name: 'Saltar al contenido' });
  await expect(skip).toBeFocused();
  const box = await skip.boundingBox();
  expect(box && box.y >= 0 && box.x >= 0 && box.width > 0 && box.height > 0).toBe(true);
  await fresh.keyboard.press('Enter');
  await expect(fresh).toHaveURL(/#content$/);
  await expect(fresh.locator('main')).toBeFocused();
});

test('C38: registrarse, salir y eliminar la cuenta solo con el teclado, sin trampas de foco', async ({
  page,
}) => {
  const email = uniqueEmail();
  await page.goto('/register');
  await page.locator('#email').focus();
  await page.keyboard.type(email);
  await page.keyboard.press('Tab');
  await page.keyboard.type(PASSWORD);
  if (await page.getByRole('button', { name: 'Mostrar contraseña' }).count())
    await page.keyboard.press('Tab');
  for (const part of ['5', '5', '1990']) {
    await page.keyboard.press('Tab');
    await page.keyboard.type(part);
  }
  await page.keyboard.press('Tab'); // casilla
  await expect(page.locator('#acceptTerms')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.locator('#acceptTerms')).toBeChecked();
  await page.keyboard.press('Tab'); // enlace a las condiciones
  await page.keyboard.press('Tab'); // botón de enviar
  await expect(page.locator('form button.button-primary[type="submit"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/account');

  // En /account se llega con Tab al botón de salir y al enlace de eliminar, en ese orden.
  const order = await tabOrder(page);
  expect(order).toEqual([
    'Saltar al contenido',
    'Cupidilla',
    'Mi cuenta',
    'Cerrar sesión',
    'Eliminar mi cuenta',
    'Condiciones de uso',
  ]);

  await page.getByRole('link', { name: 'Eliminar mi cuenta' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/account/delete');
  await page.locator('#password').focus();
  await page.keyboard.type(PASSWORD);
  await page.keyboard.press('Enter'); // Intro en el campo envía el formulario
  await expect(page).toHaveURL('/?notice=account-deleted');
});

test('C46/C47: una sola <h1>, títulos sin saltos de nivel, <title> con el patrón y landmarks, en todas las pantallas', async ({
  page,
}) => {
  await registerAdult(page);
  for (const path of [
    '/',
    '/account',
    '/account/delete',
    '/legal/terms',
    '/pagina-que-no-existe',
  ]) {
    await page.goto(path);
    const structure = await page.evaluate(() => {
      const levels = [...document.querySelectorAll('h1, h2, h3, h4')].map((h) =>
        Number(h.tagName[1]),
      );
      return {
        h1: levels.filter((level) => level === 1).length,
        jumps: levels.some((level, i) => i > 0 && level > (levels[i - 1] ?? 0) + 1),
        title: document.title,
        landmarks: ['header', 'nav[aria-label]', 'main', 'footer'].map(
          (s) => !!document.querySelector(s),
        ),
        lang: document.documentElement.lang,
      };
    });
    expect(structure.h1, `h1 en ${path}`).toBe(1);
    expect(structure.jumps, `saltos de nivel en ${path}`).toBe(false);
    expect(structure.title, `title de ${path}`).toMatch(/ — Cupidilla$/);
    expect(structure.landmarks, `landmarks de ${path}`).toEqual([true, true, true, true]);
    expect(structure.lang).toBe('es');
  }
  for (const path of ['/register', '/login']) {
    await page.context().clearCookies();
    await page.goto(path);
    expect(await page.locator('h1').count(), `h1 en ${path}`).toBe(1);
  }
});

test('C43/C45: controles de al menos 44 px, filas de la casilla y campos con letra de 16 px o más (móvil)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/register');
  const tooSmall = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        'a, button, input:not([type="hidden"]):not(#acceptTerms)',
      ),
    ]
      .filter((el) => !el.matches('.skip-link') && el.getBoundingClientRect().width > 0)
      .filter((el) => {
        const box = el.getBoundingClientRect();
        return box.height < 43.5 || box.width < 43.5;
      })
      .map(
        (el) =>
          `${el.tagName}#${el.id} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`,
      ),
  );
  expect(tooSmall).toEqual([]);
  const row = await page.locator('label.checkbox').boundingBox();
  expect(row?.height).toBeGreaterThanOrEqual(44);
  const checkbox = await page.locator('#acceptTerms').boundingBox();
  expect(checkbox && Math.round(checkbox.width)).toBe(24);
  const sizes = await page.evaluate(() =>
    [...document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"])')].map((el) =>
      parseFloat(getComputedStyle(el).fontSize),
    ),
  );
  expect(sizes.length).toBeGreaterThan(0);
  for (const size of sizes) expect(size).toBeGreaterThanOrEqual(16);
});

test('C44/C55/C56: a 320 px no hay desplazamiento horizontal en ninguna pantalla (ni con un correo de 254 caracteres); día, mes y año caben en una fila', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  for (const path of ['/', '/register', '/login', '/legal/terms', '/no-existe']) {
    await page.goto(path);
    await expectNoHorizontalScroll(page, path);
  }
  await page.goto('/register');
  const rows = await page.evaluate(() =>
    ['day', 'month', 'year'].map((id) => document.getElementById(id)?.getBoundingClientRect()),
  );
  expect(new Set(rows.map((box) => box?.y)).size).toBe(1);
  expect(rows[2]?.right).toBeLessThanOrEqual(320);
  // Botones de ancho completo y apilados.
  const button = await page.locator('form button.button-primary[type="submit"]').boundingBox();
  expect(button?.width).toBeGreaterThanOrEqual(320 - 2 * 16 - 1);

  // Único por ejecución: los dos proyectos de Playwright corren este test a la vez.
  const unique = randomUUID().replaceAll('-', '');
  const longEmail = `${unique}${'a'.repeat(64 - unique.length)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}.com`;
  expect(longEmail).toHaveLength(254);
  await page.setViewportSize({ width: 1280, height: 800 });
  await registerAdult(page, longEmail);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/account');
  await expect(page.locator('dl.data-list')).toContainText(longEmail);
  await expectNoHorizontalScroll(page, '/account con un correo de 254 caracteres');
});

test('C55: a partir de 48em el formulario se centra en una tarjeta de 28rem y la página en 40rem', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/register');
  const card = await page.locator('.card').boundingBox();
  expect(card?.width).toBeLessThanOrEqual(28 * 16 + 1);
  expect(card?.width).toBeGreaterThan(28 * 16 - 20);
  const main = await page.locator('main').boundingBox();
  expect(main?.width).toBeLessThanOrEqual(40 * 16 + 1);
  const centre = (card?.x ?? 0) + (card?.width ?? 0) / 2;
  expect(Math.abs(centre - 640)).toBeLessThan(2);
});

test('C39: todo lo tabulable enseña un anillo de foco de 3 px con el color --color-foco y 2 px de margen', async ({
  page,
}) => {
  await page.goto('/register');
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body || element === document.documentElement)
        return null;
      const style = getComputedStyle(element);
      return [style.outlineWidth, style.outlineStyle, style.outlineColor, style.outlineOffset];
    });
    if (ring === null) break; // fin del documento
    expect(ring, `anillo en el paso ${i + 1}`).toEqual(['3px', 'solid', 'rgb(11, 87, 208)', '2px']);
  }
});

test('C48: la casilla se activa con la barra espaciadora y con un clic en cualquier parte de su etiqueta; el enlace de las condiciones no la toca', async ({
  page,
}) => {
  await page.goto('/register');
  const checkbox = page.locator('#acceptTerms');
  await checkbox.focus();
  await page.keyboard.press('Space');
  await expect(checkbox).toBeChecked();
  await page.keyboard.press('Space');
  await expect(checkbox).not.toBeChecked();
  await page.locator('label.checkbox span').click();
  await expect(checkbox).toBeChecked();
  await page.locator('label.checkbox span').click();
  await expect(checkbox).not.toBeChecked();
  // El enlace está fuera de la etiqueta: pulsarlo no cambia la casilla (se abre en otra pestaña).
  expect(await page.evaluate(() => document.querySelectorAll('label a').length)).toBe(0);
});

test('C22/C28: el enlace a las condiciones abre una pestaña nueva y avisa; lo escrito no se pierde; se puede pegar', async ({
  page,
  context,
}) => {
  await page.goto('/register');
  const email = uniqueEmail();
  await page.getByLabel('Correo electrónico').fill(email);
  const link = page.getByRole('link', { name: /Leer las condiciones/ });
  await expect(link).toContainText('(se abre en una pestaña nueva)');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
  const [popup] = await Promise.all([context.waitForEvent('page'), link.click()]);
  await popup.waitForLoadState();
  await expect(popup).toHaveURL(/\/legal\/terms$/);
  await expect(page.getByLabel('Correo electrónico')).toHaveValue(email);
  await popup.close();

  // Ningún campo bloquea el pegado.
  const prevented = await page.evaluate(() =>
    ['email', 'password', 'day', 'month', 'year'].map((id) => {
      const event = new ClipboardEvent('paste', { cancelable: true, bubbles: true });
      document.getElementById(id)?.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  );
  expect(prevented).toEqual([false, false, false, false, false]);
});

test('C30: con JavaScript, el botón muestra «enviando» y un segundo envío no genera otra petición', async ({
  page,
  javaScriptEnabled,
}) => {
  test.skip(!javaScriptEnabled, 'El estado «enviando» solo existe con JavaScript');
  const posts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') posts.push(request.url());
  });
  await page.route('**/register', async (route) => {
    if (route.request().method() === 'POST') await new Promise((done) => setTimeout(done, 1500));
    await route.continue();
  });
  await page.goto('/register');
  await page.getByLabel('Correo electrónico').fill(uniqueEmail());
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Día').fill('5');
  await page.getByLabel('Mes').fill('5');
  await page.getByLabel('Año').fill('1990');
  await page.getByLabel(/Acepto las condiciones de uso/).check();

  const button = page.locator('form button.button-primary[type="submit"]');
  await button.click();
  await expect(button).toHaveText('Creando cuenta…');
  await expect(button).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('form [role="status"]')).toHaveText('Creando tu cuenta…');
  await button.click({ force: true });
  await page.getByLabel('Correo electrónico').press('Enter');
  await expect(page).toHaveURL('/account');
  expect(posts).toHaveLength(1);
});

test('C29: «Mostrar contraseña» solo existe con JavaScript, alterna la visibilidad y cambia su texto', async ({
  page,
  javaScriptEnabled,
}) => {
  await page.goto('/register');
  const toggle = page.locator('.button-text');
  if (!javaScriptEnabled) {
    await expect(toggle).toHaveCount(0);
    return;
  }
  await expect(toggle).toHaveText('Mostrar contraseña');
  await page.locator('#password').fill('algo');
  await toggle.click();
  await expect(page.locator('#password')).toHaveAttribute('type', 'text');
  await expect(toggle).toHaveText('Ocultar contraseña');
  await toggle.click();
  await expect(page.locator('#password')).toHaveAttribute('type', 'password');
  await expect(toggle).toHaveText('Mostrar contraseña');
  await expect(page.locator('#password')).toHaveValue('algo');
});

test('[BUG-QA-4] C44: a 320 px con el texto ampliado al 200 %, ninguna pantalla se desborda horizontalmente', async ({
  page,
  javaScriptEnabled,
}) => {
  test.skip(!javaScriptEnabled, 'Para ampliar el texto hace falta inyectar CSS desde el test');
  // Texto ampliado (Android/iOS, UX §4 «texto ampliado»): se simula duplicando el tamaño de la
  // letra raíz. Todo el CSS va en `rem`, así que la página debería reajustarse. Hoy /register se
  // desborda porque día, mes y año tienen anchos fijos en `rem` y no se parten en varias líneas.
  await page.setViewportSize({ width: 320, height: 700 });
  for (const path of ['/', '/login', '/register', '/legal/terms']) {
    await page.goto(path);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await expectNoHorizontalScroll(page, `${path} con el texto al 200 %`);
  }
});

test('[BUG-QA-5] C43: entre objetivos táctiles contiguos hay al menos 8 px (registro, entrar, cuenta y eliminar, en móvil)', async ({
  page,
}) => {
  // UX §6: «Separación de al menos 8 px entre objetivos». Hoy la fila de la casilla y el enlace
  // «Leer las condiciones» están pegados (0 px).
  await page.setViewportSize({ width: 320, height: 700 });
  const tooClose: string[] = [];
  const check = async (path: string): Promise<void> => {
    await page.goto(path);
    const gaps = await page.evaluate(() => {
      const targets = [
        ...document.querySelectorAll<HTMLElement>(
          'a, button, input:not([type="hidden"]):not([type="checkbox"]), label.checkbox',
        ),
      ].filter((el) => !el.matches('.skip-link') && el.getBoundingClientRect().width > 0);
      const name = (el?: HTMLElement) => el?.id || (el?.textContent ?? '').trim().slice(0, 20);
      const result: { pair: string; gap: number }[] = [];
      for (let i = 1; i < targets.length; i++) {
        const a = targets[i - 1]?.getBoundingClientRect();
        const b = targets[i]?.getBoundingClientRect();
        if (!a || !b) continue;
        const sameRow = Math.abs(a.top - b.top) < 4;
        result.push({
          pair: `${name(targets[i - 1])} → ${name(targets[i])}`,
          gap: Math.round(sameRow ? b.left - a.right : b.top - a.bottom),
        });
      }
      return result;
    });
    for (const { pair, gap } of gaps) if (gap < 8) tooClose.push(`${path}: ${pair} (${gap} px)`);
  };
  await check('/register');
  await check('/login');
  await registerAdult(page);
  await check('/account');
  await check('/account/delete');
  expect(tooClose).toEqual([]);
});
