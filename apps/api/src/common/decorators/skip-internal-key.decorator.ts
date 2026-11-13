import { SetMetadata } from '@nestjs/common';

export const SKIP_INTERNAL_KEY = 'cupidilla:skipInternalKey';

/** La ruta no exige la clave interna. Solo para /health. */
export const SkipInternalKey = () => SetMetadata(SKIP_INTERNAL_KEY, true);
