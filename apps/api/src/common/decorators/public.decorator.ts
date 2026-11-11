import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'cupidilla:isPublic';

/** La ruta no exige sesión. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
