/** Caducidad de cada reto (técnico de captcha §4.4, A8). */
export const CAPTCHA_TTL_SECONDS = 10 * 60;
/** El algoritmo por defecto de ALTCHA, con WebCrypto en el navegador y `node:crypto` aquí (A6). */
export const CAPTCHA_ALGORITHM = 'PBKDF2/SHA-256';

/**
 * Dificultades (técnico de captcha §4.6). Reto determinista: el contador se elige al azar entre
 * `counterMin` y `counterMax`, y el cliente tiene que encontrarlo. No es una variable de entorno a
 * propósito: así no se puede bajar por error en producción.
 */
export const CAPTCHA_DIFFICULTIES = {
  // ~2 000 intentos de PBKDF2 con 5 000 iteraciones (§4.6).
  normal: { cost: 5_000, counterMin: 1_000, counterMax: 3_000 },
  // Solo desarrollo y pruebas: se resuelve en milisegundos.
  minimal: { cost: 1, counterMin: 1, counterMax: 10 },
} as const;

export type CaptchaDifficulty = keyof typeof CAPTCHA_DIFFICULTIES;
