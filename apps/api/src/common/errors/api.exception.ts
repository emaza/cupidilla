import { HttpException } from '@nestjs/common';
import type { ApiErrorBody, ErrorCode, FieldError } from '@cupidilla/contracts';

/** Error de la API con la forma única de §6.3. `devMessage` es para desarrolladores y nunca lleva datos personales. */
export class ApiException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    status: number,
    readonly fields?: FieldError[],
    private readonly devMessage?: string,
  ) {
    super(code, status);
    this.name = 'ApiException';
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        ...(this.devMessage ? { message: this.devMessage } : {}),
        ...(this.fields ? { fields: this.fields } : {}),
      },
    };
  }
}
