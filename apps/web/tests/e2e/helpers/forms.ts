import { expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { pathIn, waitForMail } from './mailpit.ts';

export const PASSWORD = 'una frase larga de prueba';

export function uniqueEmail(): string {
  return `e2e+${randomUUID()}@example.com`;
}

export interface RegisterInput {
  email: string;
  password?: string;
  day?: string;
  month?: string;
  year?: string;
  acceptTerms?: boolean;
}

export async function fillRegister(page: Page, input: RegisterInput): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Correo electrónico').fill(input.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(input.password ?? PASSWORD);
  await page.getByLabel('Día').fill(input.day ?? '5');
  await page.getByLabel('Mes').fill(input.month ?? '5');
  await page.getByLabel('Año').fill(input.year ?? '1990');
  if (input.acceptTerms ?? true) await page.getByLabel(/Acepto las condiciones de uso/).check();
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
}

/**
 * Registra a una persona adulta y espera a estar en /account (correo §11.2). Con `verified` (por
 * defecto): abre el enlace de «Confirma tu correo» de Mailpit y confirma con la contraseña. Si no,
 * entra con correo y contraseña, y la cuenta queda sin confirmar.
 */
export async function registerAdult(
  page: Page,
  email = uniqueEmail(),
  { verified = true }: { verified?: boolean } = {},
): Promise<string> {
  await fillRegister(page, { email });
  await expect(page).toHaveURL('/register/check-email');
  if (verified) {
    await confirmEmail(page, email);
    await expect(page).toHaveURL('/account?notice=email-verified-signin');
  } else {
    await page.goto('/login');
    await login(page, email);
    await expect(page).toHaveURL('/account');
  }
  return email;
}

/** Abre el último enlace de «Confirma tu correo» y confirma, con la contraseña si la pide. */
export async function confirmEmail(page: Page, email: string, password = PASSWORD): Promise<void> {
  const message = await waitForMail(email, { subject: 'Confirma tu correo' });
  await page.goto(await pathIn(message, '/verify-email'));
  await expect(page).toHaveURL('/verify-email');
  const field = page.getByLabel('Contraseña', { exact: true });
  if (await field.isVisible()) await field.fill(password);
  await page.getByRole('button', { name: 'Confirmar mi correo' }).click();
}

export async function login(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

export async function logout(page: Page): Promise<void> {
  await page.goto('/account');
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL('/?notice=signed-out');
}
