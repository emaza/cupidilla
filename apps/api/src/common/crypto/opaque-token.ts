import { createHash, randomBytes } from 'node:crypto';

/** Token opaco de 256 bits en base64url: 43 caracteres. Lo usan la sesión y el flujo de OAuth. */
export const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 en hexadecimal: es lo único que se guarda de un token. */
export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
