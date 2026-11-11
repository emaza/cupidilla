import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { closeDb } from './helpers/db.ts';
import { fillRegister, PASSWORD, registerAdult, uniqueEmail } from './helpers/forms.ts';

// Segunda revisión de QA de H0: comprueba por otra vía que los arreglos de la primera revisión
// funcionan en cada pantalla y formulario, con y sin JavaScript, y que no han roto otra cosa.

test.afterAll(closeDb);

const SUMMARY_TITLE = 'Revisa esto antes de seguir';

async function mainText(page: Page): Promise<string> {
  return page.locator('main').innerText();
}

test('BUG-QA-1: ningún ?aviso= que no sea de la lista muestra un aviso (nombres de Object, mayúsculas, espacios, repetidos)', async ({
  page,
}) => {
  const unknown = [
    'constructor',
    'toString',
    'valueOf',
    '__proto__',
    '__defineGetter__',
    'hasOwnProperty',
    'isPrototypeOf',
    'sesion-cerrada%20',
    '%20sesion-cerrada',
    'SESION-CERRADA',
    'sesion_cerrada',
    'zzz',
    '',
  ];
  for (const aviso of unknown) {
    await page.goto(`/?aviso=${aviso}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('status'), `aviso=${aviso}`).toHaveCount(0);
  }
  // Un array (aviso[]=...) y un nombre heredado detrás de uno válido: gana el primero.
  await page.goto('/?aviso[]=sesion-cerrada');
  await expect(page.getByRole('status')).toHaveCount(0);
  await page.goto('/?aviso=constructor&aviso=sesion-cerrada');
  await expect(page.getByRole('status')).toHaveCount(0);
  // Los dos válidos siguen funcionando y con su texto.
  await page.goto('/?aviso=sesion-cerrada');
  await expect(page.getByRole('status')).toHaveText(/Has cerrado sesión\./);
  await page.goto('/?aviso=cuenta-eliminada');
  await expect(page.getByRole('status')).not.toHaveText(/^\s*$/);
});

test('BUG-QA-2: los textos de «vacío» y de «formato» salen donde toca en registro, entrar y eliminar', async ({
  page,
}) => {
  // Registro: todo vacío.
  await page.goto('/registro');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.getByText(SUMMARY_TITLE)).toBeVisible();
  let text = await mainText(page);
  expect(text).toContain('Escribe tu correo electrónico.');
  expect(text).toContain('Elige una contraseña.');
  expect(text).not.toContain('Ese correo no parece válido');
  expect(text).not.toContain('al menos 10 caracteres');

  // Registro: correo solo con espacios sigue siendo «vacío».
  await fillRegister(page, { email: '   ', password: '' });
  await expect(page.getByText(SUMMARY_TITLE)).toBeVisible();
  text = await mainText(page);
  expect(text).toContain('Escribe tu correo electrónico.');
  expect(text).toContain('Elige una contraseña.');

  // Registro: correo mal escrito y contraseña corta conservan su motivo.
  await fillRegister(page, { email: 'ana@', password: 'abc' });
  await expect(page.getByText(SUMMARY_TITLE)).toBeVisible();
  text = await mainText(page);
  expect(text).toContain('Ese correo no parece válido');
  expect(text).toContain('La contraseña necesita al menos 10 caracteres.');
  expect(text).not.toContain('Escribe tu correo electrónico.');
  expect(text).not.toContain('Elige una contraseña.');

  // Entrar: vacío.
  await page.goto('/entrar');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByText(SUMMARY_TITLE)).toBeVisible();
  text = await mainText(page);
  expect(text).toContain('Escribe tu correo electrónico.');
  expect(text).toContain('Escribe tu contraseña.');

  // Entrar: correo en blanco con contraseña.
  await page.goto('/entrar');
  await page.getByLabel('Correo electrónico').fill('   ');
  await page.getByLabel('Contraseña', { exact: true }).fill('lo que sea');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByText(SUMMARY_TITLE)).toBeVisible();
  text = await mainText(page);
  expect(text).toContain('Escribe tu correo electrónico.');
  expect(text).not.toContain('Correo o contraseña incorrectos.');

  // Eliminar: contraseña vacía.
  await registerAdult(page);
  await page.goto('/cuenta/eliminar');
  await page.getByRole('button', { name: /Eliminar/ }).click();
  await expect(page.getByText(SUMMARY_TITLE)).toBeVisible();
  expect(await mainText(page)).toContain('Escribe tu contraseña para confirmar.');
});

test('BUG-QA-2 (regresión): entrar con un correo mal escrito da el mismo mensaje genérico que con uno que no existe', async ({
  page,
}) => {
  const generic = 'Correo o contraseña incorrectos.';
  const html: string[] = [];
  for (const email of ['malcorreo', 'nadie.existe@example.com', 'sin-arroba.example.com']) {
    await page.goto('/entrar');
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page.getByText(SUMMARY_TITLE)).toBeVisible();
    const text = await mainText(page);
    expect(text, email).toContain(generic);
    expect(text, email).not.toContain('no parece válido');
    expect(text, email).not.toContain('Escribe tu correo');
    html.push(text.replaceAll(email, ''));
  }
  expect(new Set(html).size).toBe(1);
});

test('BUG-QA-5: entre la casilla y «Leer las condiciones» hay 8 px en todos los anchos', async ({
  page,
}) => {
  await page.goto('/registro');
  for (const width of [320, 360, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    const gap = await page.evaluate(() => {
      const row = document.querySelector('label.casilla')?.getBoundingClientRect();
      const link = document.querySelector('.enlace-bloque')?.getBoundingClientRect();
      return row && link ? link.top - row.bottom : Number.NaN;
    });
    expect(gap, `separación a ${width} px`).toBeGreaterThanOrEqual(8);
    expect(gap, `separación a ${width} px`).toBeLessThan(16);
  }
});

test('BUG-QA-4: con texto normal, día/mes/año van en una fila a 320 px; al 200 % se parten en líneas sin desbordar', async ({
  page,
  javaScriptEnabled,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/registro');
  const tops = () =>
    page.evaluate(() =>
      ['dia', 'mes', 'anio'].map((id) => document.getElementById(id)?.getBoundingClientRect()),
    );
  const row = await tops();
  expect(new Set(row.map((box) => Math.round(box?.top ?? -1))).size, 'una sola fila').toBe(1);
  expect(row[2]?.right).toBeLessThanOrEqual(320 - 16);
  if (!javaScriptEnabled) return;
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  const wide = await tops();
  expect(new Set(wide.map((box) => Math.round(box?.top ?? -1))).size).toBeGreaterThan(1);
  for (const box of wide) expect(box?.right).toBeLessThanOrEqual(320);
  // A 640 y 1280 px, al 200 % siguen en una fila (no se ha roto el diseño ancho).
  for (const width of [640, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    const boxes = await tops();
    expect(new Set(boxes.map((box) => Math.round(box?.top ?? -1))).size, `${width} px`).toBe(1);
  }
});

test('[BUG-QA-6] C44: sin desplazamiento horizontal a 320 px con el texto al 200 % en todas las pantallas y estados de error', async ({
  page,
  javaScriptEnabled,
}) => {
  test.skip(!javaScriptEnabled, 'Para ampliar el texto hace falta inyectar CSS desde el test');
  await page.setViewportSize({ width: 320, height: 700 });

  const overflows: string[] = [];
  const measure = async (where: string): Promise<void> => {
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    const { scroll, client, culprit } = await page.evaluate(() => {
      const root = document.documentElement;
      const wide = [...document.querySelectorAll<HTMLElement>('body *')].find(
        (el) => !el.matches('.saltar') && el.getBoundingClientRect().right > root.clientWidth + 0.5,
      );
      return {
        scroll: root.scrollWidth,
        client: root.clientWidth,
        culprit: wide
          ? `${wide.tagName.toLowerCase()} «${(wide.textContent ?? '').trim().slice(0, 40)}»`
          : '',
      };
    });
    if (scroll > client) overflows.push(`${where}: ${scroll} > ${client} (${culprit})`);
  };
  const open = async (path: string): Promise<void> => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  };
  const submit = async (name: string | RegExp, exact = false): Promise<void> => {
    await page.getByRole('button', { name, exact }).click();
    await expect(page.getByText(SUMMARY_TITLE)).toBeVisible();
  };

  for (const path of [
    '/',
    '/?aviso=sesion-cerrada',
    '/registro',
    '/entrar',
    '/legal/condiciones',
  ]) {
    await open(path);
    await measure(path);
  }
  await open('/una/ruta/que/no/existe');
  await measure('404');

  // Estados de error de /registro: cada uno con un texto distinto en el resumen y en el campo.
  const registroConErrores: [string, Parameters<typeof fillRegister>[1]][] = [
    ['correo vacío y contraseña vacía', { email: '', password: '' }],
    ['correo mal escrito', { email: 'ana@', password: PASSWORD }],
    ['correo sin arroba y contraseña corta', { email: 'anaexample.com', password: 'abc' }],
    [
      'correo de más de 254 caracteres',
      { email: `${'a'.repeat(250)}@example.com`, password: PASSWORD },
    ],
    ['contraseña de 129 caracteres', { email: uniqueEmail(), password: 'p'.repeat(129) }],
    ['fecha inexistente', { email: uniqueEmail(), day: '31', month: '2', year: '1990' }],
    ['fecha futura', { email: uniqueEmail(), year: String(new Date().getFullYear() + 5) }],
    ['fecha anterior a 1900', { email: uniqueEmail(), year: '1850' }],
    ['sin aceptar las condiciones', { email: uniqueEmail(), acceptTerms: false }],
  ];
  for (const [name, input] of registroConErrores) {
    await fillRegister(page, input);
    await expect(page.getByText(SUMMARY_TITLE), name).toBeVisible();
    await measure(`/registro: ${name}`);
  }

  // Pantalla de menor.
  await fillRegister(page, { email: uniqueEmail(), year: String(new Date().getFullYear() - 10) });
  await expect(page.getByRole('heading', { name: 'No podemos crear tu cuenta' })).toBeVisible();
  await measure('pantalla de menor');

  // Correo ya registrado (409) y errores de /entrar.
  const email = uniqueEmail();
  await registerAdult(page, email);
  await measure('/cuenta');
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL('/?aviso=sesion-cerrada');
  await fillRegister(page, { email });
  await expect(page.getByText(SUMMARY_TITLE)).toBeVisible();
  await measure('/registro: correo ya registrado');

  await open('/entrar');
  await submit('Entrar', true);
  await measure('/entrar: vacío');
  await open('/entrar');
  await page.getByLabel('Correo electrónico').fill('malcorreo');
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await submit('Entrar', true);
  await measure('/entrar: correo mal escrito');
  await open('/entrar');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill('contraseña equivocada');
  await submit('Entrar', true);
  await measure('/entrar: contraseña equivocada');

  // Pantallas con sesión: cuenta con un correo de 254 caracteres, y eliminar con errores.
  const unique = randomUUID().replaceAll('-', '');
  const longEmail = `${unique}${'a'.repeat(64 - unique.length)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}.com`;
  await page.setViewportSize({ width: 1280, height: 800 });
  await registerAdult(page, longEmail);
  await page.setViewportSize({ width: 320, height: 700 });
  await open('/cuenta');
  await measure('/cuenta con un correo de 254 caracteres');
  await open('/cuenta/eliminar');
  await measure('/cuenta/eliminar');
  await submit(/Eliminar/);
  await measure('/cuenta/eliminar: contraseña vacía');
  await page.getByLabel('Contraseña', { exact: true }).fill('contraseña equivocada');
  await submit(/Eliminar/);
  await measure('/cuenta/eliminar: contraseña equivocada');

  expect(overflows, 'pantallas que se desbordan a 320 px con el texto al 200 %').toEqual([]);
});

test('[BUG-QA-7] lo que se escribe antes de que cargue el JavaScript no se borra al hidratar la página', async ({
  page,
  javaScriptEnabled,
}) => {
  test.skip(!javaScriptEnabled, 'La hidratación solo existe con JavaScript');
  // Móvil con conexión lenta: el HTML ya se ve y se puede escribir, pero el JS tarda en llegar.
  await page.route(/\.m?js(\?.*)?$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.continue();
  });
  await page.goto('/registro', { waitUntil: 'domcontentloaded' });
  await page.locator('#correo').fill('ana@example.com');
  await page.locator('#dia').fill('5');
  await page.locator('#condiciones').check();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  await expect(page.locator('#correo')).toHaveValue('ana@example.com');
  await expect(page.locator('#dia')).toHaveValue('5');
  await expect(page.locator('#condiciones')).toBeChecked();
});
