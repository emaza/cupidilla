import { isFieldIssue, type FieldError } from '@cupidilla/contracts';
import { ApiException } from './api.exception.js';

interface SchemaIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
}

/** Convierte los errores de Standard Schema en un 400 VALIDATION_FAILED con un campo por error. */
export function validationExceptionFactory(issues: readonly SchemaIssue[]): ApiException {
  const fields: FieldError[] = issues.map((issue) => ({
    path: (issue.path ?? [])
      .map((segment) => String(typeof segment === 'object' ? segment.key : segment))
      .join('.'),
    issue: isFieldIssue(issue.message) ? issue.message : 'invalid',
  }));
  return new ApiException('VALIDATION_FAILED', 400, fields, 'Request validation failed');
}
