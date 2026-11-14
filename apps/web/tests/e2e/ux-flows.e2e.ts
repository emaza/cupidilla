import {
  DEFAULT_MIN_AGE,
  latestAdultBirthDate,
  referenceToday,
  SERVICE_TERMS_VERSION,
} from '@cupidilla/contracts';
import { expect, test } from '@playwright/test';
import { closeDb, rowsForEmail } from './helpers/db.ts';
import { fillRegister, login, logout, registerAdult, uniqueEmail } from './helpers/forms.ts';

// Criterios de aceptación de UX §9 que los E-1 a E-8 no cubren. Se repiten con y sin JavaScript.

test.afterAll(closeDb);

test('C11: tras cerrar sesión, «atrás» no muestra la cuenta y pide entrar', async ({ page }) => {
  const email = uniqueEmail();
  await fillRegister(page, { email });
  await expect(page).toHaveURL('/account');

  // La página privada pide que no se guarde en caché.
  const response = await page.goto('/account');
  expect(response?.headers()['cache-control']).toBe('private, no-store');

  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL('/?notice=signed-out');

  await page.goBack();
  // Con JavaScript el router de SvelteKit sigue la redirección sin cambiar la barra de direcciones;
  // lo que importa es lo que se ve: la pantalla de entrar, con el aviso, y ni rastro de la cuenta.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Entra en tu cuenta');
  await expect(page.getByText('Entra para ver esa página.')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(email);
  await expect(page.getByRole('heading', { level: 1, name: 'Tu cuenta', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toHaveCount(0);
});

test('C58: visitar por GET la URL de la acción de salir no cierra la sesión', async ({
  page,
  context,
}) => {
  const email = await registerAdult(page);
  await page.goto('/account?/logout');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tu cuenta');
  await page.goto('/account');
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  expect((await context.cookies()).some((c) => c.name === 'cupidilla_session')).toBe(true);
  expect((await rowsForEmail(email)).sessions).toBe(1);
});

test('C58: la acción de salir solo existe como POST (no hay ningún enlace que la dispare)', async ({
  page,
}) => {
  await registerAdult(page);
  const form = page.locator('form[action="/account?/logout"]');
  await expect(form).toHaveAttribute('method', /post/i);
  await expect(page.locator('a[href*="logout"]')).toHaveCount(0);
});

test('[BUG-QA-1] C18: un ?notice= desconocido no muestra ningún aviso (tampoco los nombres heredados de Object)', async ({
  page,
}) => {
  // `constructor`, `toString`, `__proto__`… existen en cualquier objeto: la lista de avisos tiene
  // que ser cerrada de verdad. Hoy salen como un aviso verde con el texto vacío.
  for (const notice of [
    'zzz',
    '',
    'SIGNED-OUT',
    // Valores de antes de pasar las rutas a inglés.
    'sesion-cerrada',
    'cuenta-eliminada',
    'constructor',
    'toString',
    '__proto__',
    'hasOwnProperty',
  ]) {
    await page.goto(`/?notice=${encodeURIComponent(notice)}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('status'), `notice=${notice}`).toHaveCount(0);
  }
  // El parámetro de antes tampoco muestra nada.
  await page.goto('/?aviso=sesion-cerrada');
  await expect(page.getByRole('status')).toHaveCount(0);
  await page.goto('/?notice=signed-out');
  await expect(page.getByRole('status')).toContainText('Has cerrado sesión.');
});

test('C3: quien cumple 18 hoy puede registrarse (y el de mañana, no: ver E-5)', async ({
  page,
}) => {
  const [year, month, day] = latestAdultBirthDate(referenceToday(new Date()), DEFAULT_MIN_AGE)
    .split('-')
    .map(Number) as [number, number, number];
  const email = uniqueEmail();
  await fillRegister(page, { email, day: String(day), month: String(month), year: String(year) });
  await expect(page).toHaveURL('/account');
  expect((await rowsForEmail(email)).users).toBe(1);
});

test('C6: correo ya registrado (con otras mayúsculas y espacios): error en el campo, valores conservados', async ({
  page,
  browser,
}) => {
  const other = await browser.newPage();
  const email = await registerAdult(other);
  await other.close();

  await fillRegister(page, {
    email: `  ${email.toUpperCase()} `,
    day: '7',
    month: '8',
    year: '1985',
  });
  const message =
    'No hemos podido crear la cuenta con ese correo. Si ya tienes una, entra; si no, comprueba que está bien escrito o prueba con otro.';
  await expect(page.locator('#email-error')).toContainText(message);
  await expect(page.locator('#email')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#email-error').getByRole('link', { name: 'entra' })).toHaveAttribute(
    'href',
    /login$/,
  );
  await expect(page.getByLabel('Día')).toHaveValue('7');
  await expect(page.getByLabel('Mes')).toHaveValue('8');
  await expect(page.getByLabel('Año')).toHaveValue('1985');
  await expect(page.getByLabel(/Acepto las condiciones de uso/)).toBeChecked();
  await expect(page.getByLabel('Contraseña', { exact: true })).toHaveValue('');
  expect((await rowsForEmail(email)).users).toBe(1);
});

test('C9: un correo mal formado al entrar da el mismo mensaje genérico, no uno de formato', async ({
  page,
}) => {
  await page.goto('/login');
  await login(page, 'esto no es un correo', 'cualquiera');
  await expect(page.locator('.error-summary')).toContainText('Correo o contraseña incorrectos.');
  await expect(page.locator('.error-summary')).not.toContainText('formato');
  await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);
});

test('entrar: un correo existente con contraseña errónea y uno inexistente son indistinguibles (C8)', async ({
  page,
}) => {
  const email = await registerAdult(page);
  await logout(page);
  const attempt = async (address: string): Promise<{ text: string; html: string }> => {
    await page.goto('/login');
    await login(page, address, 'contraseña equivocada');
    await expect(page.locator('.error-summary')).toBeVisible();
    return {
      text: await page.locator('.error-summary').innerText(),
      html: (await page.locator('main').innerHTML()).replace(/value="[^"]*"/g, ''),
    };
  };
  const known = await attempt(email);
  const unknown = await attempt(uniqueEmail());
  expect(unknown.text).toBe(known.text);
  expect(unknown.html).toBe(known.html);
});

const PASSWORD_CASES: [string, string, string | null][] = [
  ['9 caracteres', 'a'.repeat(9), 'La contraseña necesita al menos 10 caracteres.'],
  ['10 minúsculas', 'abcdefghij', null],
  ['128 caracteres', 'ñ'.repeat(128), null],
  ['129 caracteres', 'a'.repeat(129), 'La contraseña no puede tener más de 128 caracteres.'],
];

for (const [name, password, error] of PASSWORD_CASES) {
  test(`C25: contraseña de ${name}`, async ({ page }) => {
    await fillRegister(page, { email: uniqueEmail(), password });
    if (error) await expect(page.locator('#password-error')).toContainText(error);
    else await expect(page).toHaveURL('/account');
  });
}

const DATE_CASES: [string, string, string, string][] = [
  ['31', '2', '2000', 'Esa fecha no existe. Revisa el día, el mes y el año.'],
  ['29', '2', '2001', 'Esa fecha no existe. Revisa el día, el mes y el año.'],
  ['0', '5', '1990', 'Escribe el día con uno o dos números, del 1 al 31.'],
  ['12', '13', '1990', 'Escribe el mes con uno o dos números, del 1 al 12.'],
  ['5', '5', '990', 'Escribe el año con cuatro números.'],
  ['5', '5', '1899', 'Escribe el año con cuatro números.'],
  ['5', '5', '2099', 'La fecha de nacimiento no puede ser posterior a hoy.'],
  ['', '', '', 'Escribe tu fecha de nacimiento.'],
];

for (const [day, month, year, error] of DATE_CASES) {
  test(`C26: fecha ${day || '·'}/${month || '·'}/${year || '·'}`, async ({ page }) => {
    await fillRegister(page, { email: uniqueEmail(), day, month, year });
    await expect(page.locator('#birth-date-error')).toContainText(error);
    await expect(page.locator('#birth-date-error')).toHaveCount(1);
  });
}

for (const [day, month] of [
  ['5', '5'],
  ['05', '05'],
  ['5 ', '5 '],
]) {
  test(`C26: «${day}» y «${month}» se aceptan como día y mes`, async ({ page }) => {
    const email = uniqueEmail();
    await fillRegister(page, { email, day: day ?? '', month: month ?? '', year: '1990' });
    await expect(page).toHaveURL('/account');
    expect((await rowsForEmail(email)).users).toBe(1);
  });
}

test('C21: sin marcar la casilla no se crea la cuenta; C20: tras el error la casilla se conserva como estaba', async ({
  page,
}) => {
  const email = uniqueEmail();
  await fillRegister(page, { email, acceptTerms: false });
  await expect(page.locator('#accept-terms-error')).toContainText(
    'Para crear la cuenta tienes que aceptar las condiciones de uso.',
  );
  await expect(page.getByLabel(/Acepto las condiciones de uso/)).not.toBeChecked();
  expect((await rowsForEmail(email)).users).toBe(0);

  // Con otro error y la casilla marcada, vuelve marcada.
  await page.getByLabel(/Acepto las condiciones de uso/).check();
  await page.getByLabel('Contraseña', { exact: true }).fill('corta');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.locator('#password-error')).toBeVisible();
  await expect(page.getByLabel(/Acepto las condiciones de uso/)).toBeChecked();
});

test('C17: el consentimiento guarda la versión vigente y la fecha del registro', async ({
  page,
}) => {
  const email = await registerAdult(page);
  await expect(page.locator('dl.data-list')).toContainText('Condiciones aceptadas');
  await expect(page.locator('dl.data-list')).toContainText(
    new RegExp(`versión ${SERVICE_TERMS_VERSION}, el \\d{1,2} de [a-zé]+ de \\d{4}`),
  );
  expect((await rowsForEmail(email)).consents).toBe(1);
});

test('C52: /legal/terms es pública, enseña el borrador, la versión y los [PENDIENTE] tal cual', async ({
  page,
}) => {
  await page.goto('/legal/terms');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Condiciones de uso');
  await expect(
    page.getByText(
      'Borrador pendiente de revisión jurídica. No es el texto definitivo y puede cambiar.',
    ),
  ).toBeVisible();
  await expect(page.getByText(`Versión ${SERVICE_TERMS_VERSION}`, { exact: true })).toBeVisible();
  await expect(page.locator('main')).toContainText(
    '[PENDIENTE: jurisdicción, ley aplicable y vías de reclamación.]',
  );
  await expect(page).toHaveTitle('Condiciones de uso (borrador) — Cupidilla');

  await registerAdult(page);
  await page.goto('/legal/terms');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Condiciones de uso');
});

test('el token de sesión no aparece nunca en el HTML, en los datos de la página ni en una respuesta de error', async ({
  page,
  context,
}) => {
  const email = await registerAdult(page);
  const token = (await context.cookies()).find((c) => c.name === 'cupidilla_session')?.value ?? '';
  expect(token).toHaveLength(43);

  for (const path of ['/account', '/account/delete', '/', '/legal/terms']) {
    const response = await page.goto(path);
    expect(await response?.text(), path).not.toContain(token);
    expect(await page.content(), path).not.toContain(token);
  }
  for (const path of ['/account/__data.json', '/__data.json']) {
    const response = await page.request.get(path);
    expect(await response.text(), path).not.toContain(token);
    // La fecha de nacimiento ya se muestra en /account (la ve su titular), así que su clave puede
    // estar en los datos de la página. Lo que no puede llegar nunca al cliente son los datos
    // internos de la cuenta, de las sesiones ni del proveedor.
    for (const internal of [
      'tokenHash',
      'token_hash',
      'passwordHash',
      'subject',
      'providerEmail',
    ]) {
      expect(await response.text(), `${path} ${internal}`).not.toContain(internal);
    }
  }
  // Un error de contraseña al eliminar tampoco lo devuelve.
  await page.goto('/account/delete');
  await page.getByLabel('Contraseña', { exact: true }).fill('contraseña equivocada');
  await page.getByRole('button', { name: 'Eliminar mi cuenta definitivamente' }).click();
  await expect(page.locator('#password-error')).toBeVisible();
  expect(await page.content()).not.toContain(token);
  expect(await page.content()).not.toContain('contraseña equivocada');
  expect((await rowsForEmail(email)).users).toBe(1);
});
