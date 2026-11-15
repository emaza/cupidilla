import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// El límite por correo (3 registros cada 24 h) se multiplica para poder medir 7 registros con el
// mismo correo. La variable se lee al cargar el módulo de la aplicación: va antes de los import.
vi.hoisted(() => {
  process.env.RATE_LIMIT_FACTOR = '100';
});

const { ANA, mailRegisterBody, seedAna } = await import('./helpers/mail.js');
const { api, createTestApp, truncateAll } = await import('./helpers/test-app.js');
type TestApp = Awaited<ReturnType<typeof createTestApp>>;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/** B2-4 (correo §5.2): el tiempo del registro no depende de que el correo exista. */
describe('B2-4: igualdad de tiempo en el registro', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
    await truncateAll(t.db);
    await seedAna(t.db);
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('la mediana de 7 registros nuevos y 7 con el correo de Ana difiere menos de 50 ms', async () => {
    const time = async (email: string): Promise<number> => {
      const start = performance.now();
      const response = await api(t.app).post('/auth/register').send(mailRegisterBody(email));
      const elapsed = performance.now() - start;
      expect(response.status).toBe(202);
      return elapsed;
    };
    // Calentamiento: la primera petición paga la conexión y la carga de argon2.
    await time('calentamiento@example.com');
    const fresh: number[] = [];
    const existing: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      fresh.push(await time(`nuevo${i}@example.com`));
      existing.push(await time(ANA));
    }
    expect(Math.abs(median(fresh) - median(existing))).toBeLessThan(50);
  });
});
