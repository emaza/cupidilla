import { SetMetadata } from '@nestjs/common';

export const REQUIRES_CAPTCHA = 'cupidilla:requiresCaptcha';

/**
 * La ruta exige la comprobación antibots en `X-Captcha` (técnico de captcha §4.7), si
 * `CAPTCHA_ENABLED=true`. Sin ella, 400 `CAPTCHA_REQUIRED`; si no vale, 400 `CAPTCHA_INVALID`.
 */
export const RequiresCaptcha = () => SetMetadata(REQUIRES_CAPTCHA, true);
