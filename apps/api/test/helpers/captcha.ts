import type { NestExpressApplication } from '@nestjs/platform-express';
import { captchaChallengeSchema } from '@cupidilla/contracts';
import { solveChallenge } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import { CaptchaReplayStore } from '../../src/captcha/captcha-replay.store.js';
import { api } from './test-app.js';

/**
 * Comprobación antibots en la integración (técnico de captcha §5.4): con `CAPTCHA_DIFFICULTY=minimal`,
 * el reto se resuelve en Node en milisegundos.
 */
export const CAPTCHA_TEST_ENV = {
  CAPTCHA_ENABLED: 'true',
  CAPTCHA_HMAC_KEY: 'test-captcha-hmac-key-0123456789abcdef',
  CAPTCHA_DIFFICULTY: 'minimal',
} as const;

/** Pide un reto a la API (con una IP propia), lo resuelve y devuelve el valor de `X-Captcha`. */
export async function solveCaptcha(app: NestExpressApplication): Promise<string> {
  const response = await api(app).get('/captcha/challenge');
  if (response.status !== 200) throw new Error(`Reto de prueba fallido: ${response.status}`);
  const challenge = captchaChallengeSchema.parse(response.body);
  const solution = await solveChallenge({ challenge, deriveKey });
  if (!solution) throw new Error('Reto de prueba sin solución');
  return Buffer.from(JSON.stringify({ challenge, solution })).toString('base64');
}

/** Base64 del JSON, para cargas hechas a mano. */
export const encodeCaptcha = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString('base64');

/** Vacía los retos usados (en memoria), como `resetRateLimits`. */
export function resetCaptcha(app: NestExpressApplication): void {
  app.get(CaptchaReplayStore).clear();
}
