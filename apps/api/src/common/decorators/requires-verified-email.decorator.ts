import { SetMetadata } from '@nestjs/common';

export const REQUIRES_VERIFIED_EMAIL = 'cupidilla:requiresVerifiedEmail';

/**
 * La ruta exige el correo de la cuenta verificado (correo §5.9): sin él, 403
 * `EMAIL_NOT_VERIFIED`. Solo tiene sentido en rutas con sesión.
 */
export const RequiresVerifiedEmail = () => SetMetadata(REQUIRES_VERIFIED_EMAIL, true);
