import { UNVERIFIED_ACCOUNT_TTL_DAYS } from '@cupidilla/contracts';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `created_at + 7 días`: cuándo se borra una cuenta sin verificar (correo §6.3). Lo usan los
 * correos, `GET /users/me` y el barrido, así que la fecha siempre coincide.
 */
export const unverifiedDeletionAt = (createdAt: Date): Date =>
  new Date(createdAt.getTime() + UNVERIFIED_ACCOUNT_TTL_DAYS * DAY_MS);
