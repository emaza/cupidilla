import { expect, test } from '@playwright/test';
import { fillRegister, PASSWORD, uniqueEmail } from './helpers/forms.ts';

test('«Mostrar contraseña» solo existe con JavaScript y la contraseña nunca vuelve en el HTML', async ({
  page,
  javaScriptEnabled,
}) => {
  await page.goto('/register');
  const toggle = page.getByRole('button', { name: 'Mostrar contraseña' });
  const password = page.getByLabel('Contraseña', { exact: true });

  if (javaScriptEnabled) {
    await password.fill(PASSWORD);
    await toggle.click();
    await expect(password).toHaveAttribute('type', 'text');
    await expect(page.getByRole('button', { name: 'Ocultar contraseña' })).toBeVisible();
  } else {
    await expect(toggle).toHaveCount(0);
  }

  // Un error de validación devuelve el formulario: se conservan los valores, nunca la contraseña.
  const email = uniqueEmail();
  await fillRegister(page, { email, acceptTerms: false });
  await expect(page).toHaveTitle('Error: Crear cuenta — Cupidilla');
  await expect(
    page.getByText('Para crear la cuenta tienes que aceptar las condiciones de uso.').first(),
  ).toBeVisible();
  await expect(page.getByLabel('Correo electrónico')).toHaveValue(email);
  await expect(page.getByLabel('Día')).toHaveValue('5');
  await expect(password).toHaveValue('');
  expect(await page.content()).not.toContain(PASSWORD);
  if (javaScriptEnabled) await expect(page.locator('.error-summary')).toBeFocused();
});
