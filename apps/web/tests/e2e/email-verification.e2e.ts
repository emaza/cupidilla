import { expect, test } from '@playwright/test';
import { emailVerifiedAt, rowsForEmail } from './helpers/db.ts';
import {
  confirmEmail,
  fillRegister,
  PASSWORD,
  registerAdult,
  uniqueEmail,
} from './helpers/forms.ts';
import { linkIn, mailTo, waitForMail, waitForMailCount } from './helpers/mailpit.ts';

const CONFIRM = 'Confirma tu correo';
const NOTICE = 'Alguien ha intentado registrarse con tu correo';

/** Registro uniforme y verificación del correo (correo, fase B, tarea B.8). */
test.describe('B.8: verificación del correo', () => {
  test('B8-1: alta nueva → «Revisa tu correo», enlace sin token en la URL y confirmar con la contraseña', async ({
    page,
    context,
  }) => {
    const email = uniqueEmail();
    await fillRegister(page, { email });
    await expect(page).toHaveURL('/register/check-email');
    expect(page.url()).not.toContain(encodeURIComponent(email));
    expect(page.url()).not.toContain(email);
    await expect(page.getByText(`Te hemos enviado un mensaje a ${email}.`)).toBeVisible();
    expect((await context.cookies()).some((cookie) => cookie.name === 'cupidilla_session')).toBe(
      false,
    );

    const message = await waitForMail(email, { subject: CONFIRM });
    await page.goto(await linkIn(message, '/verify-email'));
    await expect(page).toHaveURL('/verify-email');
    // Sin sesión se pide la contraseña, con la pista que da la API (`e2e+…` → `e•••@example.com`).
    await expect(page.getByText('e•••@example.com')).toBeVisible();
    await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Confirmar mi correo' }).click();

    await expect(page).toHaveURL('/account?notice=email-verified-signin');
    await expect(
      page.getByText('Hemos confirmado tu correo y has entrado en tu cuenta.'),
    ).toBeVisible();
    await expect(page.locator('#correo')).toHaveCount(0);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Aviso sobre tu correo' })).toHaveCount(0);
    const session = (await context.cookies()).find((cookie) => cookie.name === 'cupidilla_session');
    expect(session).toMatchObject({ httpOnly: true, sameSite: 'Lax', secure: true });
  });

  test('B8-2: registrarse con un correo ya registrado da la misma pantalla y un aviso, sin cuenta nueva', async ({
    page,
    browser,
  }) => {
    const email = uniqueEmail();
    await fillRegister(page, { email });
    await expect(page).toHaveURL('/register/check-email');
    await waitForMail(email, { subject: CONFIRM });

    const other = await browser.newContext();
    try {
      const second = await other.newPage();
      await fillRegister(second, { email, password: 'otra frase distinta y larga' });
      await expect(second).toHaveURL('/register/check-email');
      await expect(second.getByText(`Te hemos enviado un mensaje a ${email}.`)).toBeVisible();
    } finally {
      await other.close();
    }
    await waitForMail(email, { subject: NOTICE });
    const subjects = (await mailTo(email)).map((message) => message.Subject);
    expect(subjects.filter((subject) => subject === CONFIRM)).toHaveLength(1);
    expect((await rowsForEmail(email)).users).toBe(1);
  });

  test('B8-3: sin confirmar, banda y sección con la fecha; reenviar anula el primer enlace y el segundo confirma con la sesión', async ({
    page,
  }) => {
    const email = await registerAdult(page, uniqueEmail(), { verified: false });
    const first = await linkIn(await waitForMail(email, { subject: CONFIRM }), '/verify-email');

    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Aviso sobre tu correo' })).toContainText(
      'Tu correo aún no está confirmado.',
    );
    await page.goto('/account');
    const section = page.locator('section#correo');
    await expect(section).toContainText(
      /Si no lo confirmas antes del \d+ de \w+ de \d{4}, borraremos la cuenta\./,
    );
    await expect(page.getByText('Sin confirmar')).toBeVisible();

    await section.getByRole('button', { name: 'Enviar otro mensaje' }).click();
    await expect(page).toHaveURL('/account?notice=verification-sent');
    const [latest] = await waitForMailCount(email, 2);
    const second = await linkIn(latest!, '/verify-email');
    expect(second).not.toBe(first);

    await page.goto(first);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Este enlace ya no sirve');

    await page.goto(second);
    await expect(page.getByLabel('Contraseña', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Confirmar mi correo' }).click();
    await expect(page).toHaveURL('/account?notice=email-verified');
    await expect(page.locator('#correo')).toHaveCount(0);
  });

  test('B8-4: con la sesión de otra cuenta se pide la contraseña y la sesión no cambia', async ({
    page,
    browser,
  }) => {
    const owner = await registerAdult(page);
    const other = await browser.newContext();
    const email = uniqueEmail();
    try {
      const otherPage = await other.newPage();
      await fillRegister(otherPage, { email });
      await expect(otherPage).toHaveURL('/register/check-email');
    } finally {
      await other.close();
    }

    await page.goto(await linkIn(await waitForMail(email, { subject: CONFIRM }), '/verify-email'));
    await expect(
      page.getByText('Ahora mismo estás dentro con otra cuenta. No la cambiaremos.'),
    ).toBeVisible();
    await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Confirmar mi correo' }).click();
    await expect(page).toHaveURL('/account?notice=email-verified-other');
    await expect(page.locator('.data-list').first()).toContainText(owner);
    expect(await emailVerifiedAt(email)).toBeInstanceOf(Date);
  });

  test('B8-5: un GET del enlace (escáner) no confirma nada y lleva las cabeceras de privacidad', async ({
    page,
    request,
  }) => {
    const email = uniqueEmail();
    await fillRegister(page, { email });
    await expect(page).toHaveURL('/register/check-email');
    const link = await linkIn(await waitForMail(email, { subject: CONFIRM }), '/verify-email');

    const first = await request.get(link, { maxRedirects: 0 });
    expect(first.status()).toBe(303);
    expect(first.headers()['referrer-policy']).toBe('no-referrer');
    const followed = await request.get(link);
    // La página ya no lleva el token en la URL: `same-origin`, para que su formulario funcione
    // sin JavaScript (ver hooks.server.ts).
    expect(followed.headers()['referrer-policy']).toBe('same-origin');
    for (const response of [first, followed]) {
      expect(response.headers()['x-robots-tag']).toBe('noindex');
      expect(response.headers()['cache-control']).toBe('no-store');
    }
    expect(await emailVerifiedAt(email)).toBeNull();
  });

  test('B8-6: las páginas nuevas no tienen violaciones de CSP', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (message) => {
      const text = message.text();
      if (/Content Security Policy|Refused to/i.test(text)) violations.push(text);
    });
    page.on('pageerror', (error) => violations.push(error.message));

    const email = uniqueEmail();
    await fillRegister(page, { email });
    await expect(page).toHaveURL('/register/check-email');
    await page.goto('/verify-email?token=abc');
    await confirmEmail(page, email);
    await expect(page).toHaveURL('/account?notice=email-verified-signin');
    expect(violations).toEqual([]);
  });
});
