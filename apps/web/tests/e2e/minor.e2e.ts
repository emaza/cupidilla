import { DEFAULT_MIN_AGE, latestAdultBirthDate, referenceToday } from '@cupidilla/contracts';
import { expect, test, type Page } from '@playwright/test';
import { closeDb, rowsForEmail } from './helpers/db.ts';
import { fillRegister, registerAdult, uniqueEmail } from './helpers/forms.ts';

test.afterAll(closeDb);

/** Quien cumple 18 años mañana (hora de Madrid). */
function minorBirthDate(): { day: string; month: string; year: string } {
  const latest = new Date(
    `${latestAdultBirthDate(referenceToday(new Date()), DEFAULT_MIN_AGE)}T00:00:00Z`,
  );
  latest.setUTCDate(latest.getUTCDate() + 1);
  return {
    day: String(latest.getUTCDate()),
    month: String(latest.getUTCMonth() + 1),
    year: String(latest.getUTCFullYear()),
  };
}

async function expectMinorScreen(page: Page, email: string): Promise<void> {
  await expect(page).toHaveURL('/register');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('No podemos crear tu cuenta');
  await expect(page).toHaveTitle('No podemos crear tu cuenta — Cupidilla');
  await expect(page.locator('main form')).toHaveCount(0);
  const html = await page.content();
  expect(html).not.toContain(email);
  expect(html).not.toContain('value="');
  expect(await rowsForEmail(email)).toEqual({ users: 0, sessions: 0, consents: 0 });
}

test(
  'E-5: un menor ve la pantalla de cierre y no se guarda nada',
  { tag: '@nojs' },
  async ({ page }) => {
    const email = uniqueEmail();
    await fillRegister(page, { email, ...minorBirthDate() });
    await expectMinorScreen(page, email);
  },
);

test('E-5: también cuando además hay otros campos mal', { tag: '@nojs' }, async ({ page }) => {
  const email = `MAL-${uniqueEmail()}`.replace('@', '');
  await fillRegister(page, { email, password: 'corta', acceptTerms: false, ...minorBirthDate() });
  await expectMinorScreen(page, email);
});

test(
  'E-5: con un correo ya registrado, la pantalla de menor y nunca la de correo existente',
  { tag: '@nojs' },
  async ({ page, browser }) => {
    const adult = await browser.newPage();
    const email = await registerAdult(adult);
    await adult.close();

    await fillRegister(page, { email, ...minorBirthDate() });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('No podemos crear tu cuenta');
    await expect(page.getByText('No hemos podido crear la cuenta con ese correo')).toHaveCount(0);
  },
);
