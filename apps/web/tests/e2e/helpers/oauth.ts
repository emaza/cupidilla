import { expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { FAKE_PROVIDER_URL } from './oauth-env.ts';

export interface FakeLogin {
  /** Identificador en el proveedor; por defecto, uno nuevo. */
  subject?: string;
  /** Vacío: el proveedor no devuelve correo. */
  email?: string;
  emailVerified?: boolean;
  scenario?: string;
  decision?: 'approve' | 'deny';
}

export function uniqueSubject(): string {
  return `sub-${randomUUID()}`;
}

/**
 * Pulsa «Continuar con {proveedor}» en la página actual y rellena el formulario del proveedor
 * falso como lo haría una persona. Devuelve el identificador usado.
 */
export async function continueWith(
  page: Page,
  provider: 'Google' | 'Facebook',
  login: FakeLogin = {},
): Promise<string> {
  const subject = login.subject ?? uniqueSubject();
  await page.getByRole('button', { name: `Continuar con ${provider}` }).click();
  await expect(page).toHaveURL(new RegExp(`^${FAKE_PROVIDER_URL}/`));
  await page.getByLabel('Identificador').fill(subject);
  await page.getByLabel('Correo', { exact: true }).fill(login.email ?? '');
  if (login.emailVerified === false) await page.getByLabel('Correo verificado').uncheck();
  if (login.scenario) await page.getByLabel('Escenario').selectOption(login.scenario);
  await page
    .getByRole('button', { name: login.decision === 'deny' ? 'Cancelar' : 'Autorizar' })
    .click();
  return subject;
}

/** Rellena /register/complete y pulsa «Crear mi cuenta». */
export async function completeSignup(
  page: Page,
  date: { day: string; month: string; year: string } = { day: '5', month: '5', year: '1990' },
): Promise<void> {
  // Sin JavaScript, tras un error la URL es la de la acción (`?/signup`).
  await expect(page).toHaveURL(/\/register\/complete(\?\/signup)?$/);
  await page.getByLabel('Día').fill(date.day);
  await page.getByLabel('Mes').fill(date.month);
  await page.getByLabel('Año').fill(date.year);
  await page.getByLabel(/Acepto las condiciones de uso/).check();
  await page.getByRole('button', { name: 'Crear mi cuenta' }).click();
}
