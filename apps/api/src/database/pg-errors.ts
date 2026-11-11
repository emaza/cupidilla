/**
 * ¿Es una violación de unicidad (23505) de esa restricción? Drizzle envuelve el error del
 * driver en `DrizzleQueryError` y deja el original en `cause`.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const cause = error instanceof Error ? error.cause : undefined;
  if (!cause || typeof cause !== 'object') return false;
  const { code, constraint: name } = cause as { code?: unknown; constraint?: unknown };
  return code === '23505' && name === constraint;
}
