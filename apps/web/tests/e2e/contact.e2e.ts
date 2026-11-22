import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { contactMessagesWithSubject } from './helpers/db.ts';
import { uniqueEmail } from './helpers/forms.ts';
import { textOf, waitForMail } from './helpers/mailpit.ts';

/** Buzón del formulario en los e2e: el valor por defecto de CONTACT_TO_ADDRESS. */
const CONTACT_INBOX = 'contacto@example.com';
const SENT_ACK = 'Te enviaremos un correo breve para confirmar la recepción.';

/** Rellena el formulario válido; el asunto es único para encontrar el correo en Mailpit. */
async function fillContact(page: Page, { email, subject }: { email: string; subject: string }) {
  await page.getByLabel('Nombre', { exact: true }).fill('Lucía Pérez');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Asunto').fill(subject);
  await page.getByLabel('Mensaje').fill('Hola,\nno me llega el correo.');
  await page.getByLabel('He leído y acepto la política de privacidad.').check();
}

/** Formulario de contacto (técnico de contacto T10, UX de contacto §9). */
test.describe('T10: /contact', () => {
  test(
    'C1: el formulario válido lleva a «Mensaje enviado» y el buzón recibe el correo',
    { tag: '@nojs' },
    async ({ page }) => {
      const email = uniqueEmail();
      const subject = `Duda ${randomUUID()}`;
      await page.goto('/contact');
      await expect(page).toHaveTitle('Contacto — Cupidilla');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Escríbenos');
      await fillContact(page, { email, subject });
      await page.getByRole('button', { name: 'Enviar mensaje' }).click();

      await expect(page).toHaveURL('/contact/sent');
      await expect(page).toHaveTitle('Mensaje enviado — Cupidilla');
      await expect(page.getByText('Hemos recibido tu mensaje.')).toBeVisible();
      await expect(page.getByText(`Lo leeremos y te responderemos a ${email}.`)).toBeVisible();
      await expect(page.getByText(SENT_ACK)).toHaveCount(0);
      expect(page.url()).not.toContain(email);

      const mail = await waitForMail(CONTACT_INBOX, { subject: `[Contacto Cupidilla] ${subject}` });
      const text = await textOf(mail);
      expect(text).toContain('Nombre: Lucía Pérez');
      expect(text).toContain('Teléfono: No indicado');
      expect(text).toContain('no me llega el correo.');

      // La cookie es de un solo uso: al recargar se vuelve al formulario vacío.
      await page.reload();
      await expect(page).toHaveURL('/contact');
      await expect(page.getByLabel('Asunto')).toHaveValue('');
    },
  );

  test(
    'C5: vacío da el resumen con cinco errores; los valores, el mensaje y la casilla se conservan',
    { tag: '@nojs' },
    async ({ page, javaScriptEnabled }) => {
      await page.goto('/contact');
      await page.getByRole('button', { name: 'Enviar mensaje' }).click();
      await expect(page).toHaveTitle('Error: Contacto — Cupidilla');
      const summary = page.locator('.error-summary');
      await expect(summary.getByRole('link')).toHaveText([
        'Escribe tu nombre.',
        'Escribe tu correo electrónico.',
        'Escribe un asunto.',
        'Escribe tu mensaje.',
        'Para enviar el mensaje tienes que aceptar la política de privacidad.',
      ]);
      if (javaScriptEnabled) await expect(summary).toBeFocused();

      await page.getByLabel('Asunto').fill('ab');
      await page.getByLabel('Mensaje').fill('Un mensaje largo de verdad.');
      await page.getByLabel('He leído y acepto la política de privacidad.').check();
      await page.getByRole('button', { name: 'Enviar mensaje' }).click();
      await expect(
        page.getByText('El asunto es demasiado corto. Escribe al menos 3 caracteres.').first(),
      ).toBeVisible();
      await expect(page.getByLabel('Mensaje')).toHaveValue('Un mensaje largo de verdad.');
      await expect(page.getByLabel('He leído y acepto la política de privacidad.')).toBeChecked();
      await expect(page.getByLabel('Asunto')).toHaveAttribute('aria-invalid', 'true');
    },
  );

  test('C9: con el campo trampa relleno parece un éxito, pero no se guarda nada', async ({
    page,
  }) => {
    const subject = `Trampa ${randomUUID()}`;
    await page.goto('/contact');
    await fillContact(page, { email: uniqueEmail(), subject });
    // Una persona no lo ve ni lo alcanza con el tabulador; un bot lo rellena.
    const trap = page.locator('input[name="hp_contact"]');
    await expect(trap).toHaveAttribute('tabindex', '-1');
    await trap.fill('http://spam.example', { force: true });
    await page.getByRole('button', { name: 'Enviar mensaje' }).click();

    await expect(page).toHaveURL('/contact/sent');
    await expect(page.getByText('Hemos recibido tu mensaje.')).toBeVisible();
    expect(await contactMessagesWithSubject(subject)).toBe(0);
  });

  test('el contador del mensaje existe con JavaScript y avisa al pasarse', async ({ page }) => {
    await page.goto('/contact');
    await expect(page.getByText('0 de 3000 caracteres')).toBeVisible();
    await page.getByLabel('Mensaje').fill('😀'.repeat(3002));
    await expect(page.getByText('3002 de 3000 caracteres: te sobran 2')).toBeVisible();
    await expect(page.getByLabel('Mensaje')).not.toHaveAttribute('maxlength');
  });

  test('el pie enlaza condiciones, privacidad y contacto; /legal/privacy es el borrador', async ({
    page,
  }) => {
    await page.goto('/');
    const footer = page.getByRole('navigation', { name: 'Información y contacto' });
    await expect(footer.getByRole('link')).toHaveText([
      'Condiciones de uso',
      'Política de privacidad',
      'Contacto',
    ]);
    await footer.getByRole('link', { name: 'Contacto' }).click();
    await expect(page).toHaveURL('/contact');
    await expect(footer.getByRole('link', { name: 'Contacto' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await page.goto('/legal/privacy');
    await expect(page).toHaveTitle('Política de privacidad (borrador) — Cupidilla');
    await expect(page.getByText('Versión 2026-11-borrador')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2 })).toHaveCount(11);
  });
});
