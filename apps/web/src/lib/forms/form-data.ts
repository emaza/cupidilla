import { isFieldIssue, type FieldError, type FieldIssue } from '@cupidilla/contracts';
import type { TextKey } from '#lib/texts.ts';

/** Errores que una acción devuelve a su página: por campo (`name` del HTML) y uno general. */
export interface FormErrors<Field extends string> {
  fields: Partial<Record<Field, TextKey>>;
  general?: TextKey;
}

/** Valor de texto de un campo; cualquier otra cosa (ausente, archivo) cuenta como vacío. */
export function textField(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === 'string' ? value : '';
}

interface IssueLike {
  path: readonly PropertyKey[];
  message: string;
}

/** Primer motivo de error de cada campo del contrato, a partir de los issues de Zod. */
export function firstIssueByField(issues: readonly IssueLike[]): Map<string, FieldIssue> {
  const result = new Map<string, FieldIssue>();
  for (const issue of issues) {
    const field = String(issue.path[0] ?? '');
    if (!result.has(field))
      result.set(field, isFieldIssue(issue.message) ? issue.message : 'invalid');
  }
  return result;
}

/** Igual que `firstIssueByField`, para los `fields` de un error VALIDATION_FAILED de la API. */
export function firstApiIssueByField(fields: readonly FieldError[] = []): Map<string, FieldIssue> {
  const result = new Map<string, FieldIssue>();
  for (const { path, issue } of fields) {
    const field = path.split('.')[0] ?? '';
    if (!result.has(field)) result.set(field, issue);
  }
  return result;
}
