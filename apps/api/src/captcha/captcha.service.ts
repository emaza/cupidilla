import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CAPTCHA_PAYLOAD_MAX,
  captchaChallengeSchema,
  captchaPayloadSchema,
  type CaptchaChallenge,
} from '@cupidilla/contracts';
import { createChallenge, randomInt, verifySolution } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import { createHmac, randomBytes } from 'node:crypto';
import type { Env } from '../config/env.schema.js';
import {
  CAPTCHA_ALGORITHM,
  CAPTCHA_DIFFICULTIES,
  CAPTCHA_TTL_SECONDS,
  type CaptchaDifficulty,
} from './captcha-difficulty.js';
import { CaptchaReplayStore } from './captcha-replay.store.js';

export type CaptchaRejection =
  'missing' | 'malformed' | 'signature' | 'expired' | 'solution' | 'replayed';
export type CaptchaVerdict = { ok: true } | { ok: false; reason: CaptchaRejection };

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Secreto derivado de `CAPTCHA_HMAC_KEY` para un uso (§4.4): una variable, dos secretos. */
export const deriveCaptchaSecret = (key: string, purpose: 'challenge' | 'key'): string =>
  createHmac('sha256', key).update(`cupidilla:altcha:${purpose}`).digest('hex');

/**
 * Retos ALTCHA firmados y su verificación (técnico de captcha §4.4). No decide qué rutas la
 * exigen (eso es `CaptchaGuard`) ni escribe en la base de datos.
 *
 * Reloj: aquí se usa `Date.now()` y no `Clock`, a propósito. `verifySolution` compara `expiresAt`
 * con `Date.now()` por dentro, y con el reloj falso de los tests (ya en el pasado) todos los retos
 * estarían caducados. Las pruebas de caducidad usan `vi.setSystemTime`.
 */
@Injectable()
export class CaptchaService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CaptchaService.name);
  private readonly isEnabled: boolean;
  private readonly production: boolean;
  private readonly difficulty: CaptchaDifficulty;
  private readonly hmacSignatureSecret: string;
  private readonly hmacKeySignatureSecret: string;
  private readonly ephemeralKey: boolean;

  constructor(
    private readonly replayStore: CaptchaReplayStore,
    config: ConfigService<Env, true>,
  ) {
    this.isEnabled = config.get('CAPTCHA_ENABLED', { infer: true });
    this.production = config.get('NODE_ENV', { infer: true }) === 'production';
    this.difficulty = config.get('CAPTCHA_DIFFICULTY', { infer: true });
    // Sin clave solo se llega con la comprobación desactivada o en desarrollo (checkCaptcha). En
    // desarrollo se usa una clave aleatoria de esta ejecución: al reiniciar, los retos pendientes
    // dan CAPTCHA_INVALID una vez, como al rotar la clave (§5.1).
    const configured = config.get('CAPTCHA_HMAC_KEY', { infer: true });
    this.ephemeralKey = configured === undefined && this.isEnabled;
    const key = configured ?? randomBytes(32).toString('base64url');
    this.hmacSignatureSecret = deriveCaptchaSecret(key, 'challenge');
    this.hmacKeySignatureSecret = deriveCaptchaSecret(key, 'key');
  }

  get enabled(): boolean {
    return this.isEnabled;
  }

  onApplicationBootstrap(): void {
    // Es una decisión válida (p. ej. durante un incidente), pero tiene que verse (§5.1).
    if (this.production && !this.isEnabled) this.logger.warn({ event: 'captcha_disabled' });
    if (this.ephemeralKey) this.logger.warn({ event: 'captcha_ephemeral_key' });
  }

  /** Reto nuevo firmado. Solo con CAPTCHA_ENABLED=true. */
  async createChallenge(): Promise<CaptchaChallenge> {
    const { cost, counterMin, counterMax } = CAPTCHA_DIFFICULTIES[this.difficulty];
    const challenge = await createChallenge({
      algorithm: CAPTCHA_ALGORITHM,
      cost,
      // El máximo va primero: randomInt(max, min) (técnico de captcha §2).
      counter: randomInt(counterMax, counterMin),
      deriveKey,
      expiresAt: Math.floor(Date.now() / 1000) + CAPTCHA_TTL_SECONDS,
      hmacSignatureSecret: this.hmacSignatureSecret,
      hmacKeySignatureSecret: this.hmacKeySignatureSecret,
    });
    // Ida y vuelta por JSON: la librería deja claves con `undefined` (memoryCost, data…).
    const { parameters, signature } = JSON.parse(JSON.stringify(challenge)) as Record<
      string,
      unknown
    >;
    return captchaChallengeSchema.parse({ parameters, signature });
  }

  /** No lanza nunca: cualquier excepción de altcha-lib cuenta como `malformed`. */
  async verify(header: string | undefined): Promise<CaptchaVerdict> {
    if (header === undefined || header === '') return { ok: false, reason: 'missing' };
    const payload = this.parse(header);
    if (!payload) return { ok: false, reason: 'malformed' };

    let result;
    try {
      result = await verifySolution({
        challenge: payload.challenge,
        solution: payload.solution,
        deriveKey,
        hmacSignatureSecret: this.hmacSignatureSecret,
        hmacKeySignatureSecret: this.hmacKeySignatureSecret,
      });
    } catch {
      return { ok: false, reason: 'malformed' };
    }
    if (result.expired) return { ok: false, reason: 'expired' };
    if (result.invalidSignature) return { ok: false, reason: 'signature' };
    if (result.invalidSolution || !result.verified) return { ok: false, reason: 'solution' };

    // Después de verificar: una solución falsa no ocupa sitio en el almacén.
    const { nonce, expiresAt } = payload.challenge.parameters;
    if (!this.replayStore.markUsed(nonce, expiresAt * 1000)) {
      return { ok: false, reason: 'replayed' };
    }
    return { ok: true };
  }

  private parse(header: string) {
    if (header.length > CAPTCHA_PAYLOAD_MAX || !BASE64.test(header)) return null;
    let json: unknown;
    try {
      json = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    } catch {
      return null;
    }
    const parsed = captchaPayloadSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  }
}
