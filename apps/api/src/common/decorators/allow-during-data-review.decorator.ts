import { SetMetadata } from '@nestjs/common';

export const ALLOW_DURING_DATA_REVIEW = 'cupidilla:allowDuringDataReview';

/**
 * La ruta se puede usar con la revisión de datos pendiente (correo §5.11). Es una lista blanca:
 * sin este decorador, una cuenta pendiente recibe 403 `DATA_REVIEW_REQUIRED`.
 */
export const AllowDuringDataReview = () => SetMetadata(ALLOW_DURING_DATA_REVIEW, true);
