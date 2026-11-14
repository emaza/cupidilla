import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ config: vi.fn() }));
vi.mock('#lib/server/api-client.ts', () => ({ api }));

const {
  currentMinAge,
  displayMailConfig,
  displayMinAge,
  MIN_AGE_RETRY_MS,
  MIN_AGE_TTL_MS,
  resetMinAgeCache,
} = await import('./min-age.ts');

const event = {} as RequestEvent;
const ok = (minAge: number) => ({ ok: true, status: 200, data: { minAge } });
const down = { ok: false, status: 503, error: { code: 'API_UNAVAILABLE' } };

describe('edad mínima de la web: caché y respaldo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-11T10:00:00Z'));
    api.config.mockReset();
    resetMinAgeCache();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pide el valor a la API y lo guarda 60 s', async () => {
    api.config.mockResolvedValue(ok(21));
    expect(await currentMinAge(event)).toBe(21);
    expect(await displayMinAge(event)).toBe(21);
    vi.advanceTimersByTime(MIN_AGE_TTL_MS - 1);
    expect(await currentMinAge(event)).toBe(21);
    expect(api.config).toHaveBeenCalledTimes(1);
  });

  it('pasado el TTL vuelve a preguntar y toma el valor nuevo', async () => {
    api.config.mockResolvedValueOnce(ok(21)).mockResolvedValueOnce(ok(23));
    expect(await currentMinAge(event)).toBe(21);
    vi.advanceTimersByTime(MIN_AGE_TTL_MS);
    expect(await currentMinAge(event)).toBe(23);
    expect(api.config).toHaveBeenCalledTimes(2);
  });

  it('peticiones simultáneas comparten una sola llamada a la API', async () => {
    api.config.mockResolvedValue(ok(21));
    const values = await Promise.all([currentMinAge(event), currentMinAge(event)]);
    expect(values).toEqual([21, 21]);
    expect(api.config).toHaveBeenCalledTimes(1);
  });

  it('si la API no responde y nunca hubo valor: validar da null y los textos, 18', async () => {
    api.config.mockResolvedValue(down);
    expect(await currentMinAge(event)).toBeNull();
    expect(await displayMinAge(event)).toBe(18);
  });

  it('si la API deja de responder, los textos usan el último valor conocido', async () => {
    api.config.mockResolvedValueOnce(ok(21));
    expect(await displayMinAge(event)).toBe(21);
    vi.advanceTimersByTime(MIN_AGE_TTL_MS);
    api.config.mockResolvedValue(down);
    expect(await currentMinAge(event)).toBeNull();
    expect(await displayMinAge(event)).toBe(21);
  });

  it('tras un fallo, los textos no insisten durante unos segundos y luego lo reintentan', async () => {
    api.config.mockResolvedValue(down);
    expect(await displayMinAge(event)).toBe(18);
    expect(await displayMinAge(event)).toBe(18);
    expect(api.config).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(MIN_AGE_RETRY_MS);
    api.config.mockResolvedValue(ok(22));
    expect(await displayMinAge(event)).toBe(22);
    expect(api.config).toHaveBeenCalledTimes(2);
  });

  it('validar siempre lo intenta aunque los textos estén esperando tras un fallo', async () => {
    api.config.mockResolvedValue(down);
    await displayMinAge(event);
    api.config.mockResolvedValue(ok(21));
    expect(await currentMinAge(event)).toBe(21);
    expect(api.config).toHaveBeenCalledTimes(2);
  });

  it('displayMinAge no lanza aunque la llamada falle con una excepción', async () => {
    api.config.mockRejectedValue(new Error('boom'));
    expect(await displayMinAge(event)).toBe(18);
  });
});

describe('correos opcionales: de la misma caché de GET /config (correo §5.8)', () => {
  beforeEach(() => {
    api.config.mockReset();
    resetMinAgeCache();
  });

  it('devuelve los interruptores de la API', async () => {
    const mail = { unverifiedReminder: false, passwordChangedNotice: true };
    api.config.mockResolvedValue({ ok: true, status: 200, data: { minAge: 18, mail } });
    expect(await displayMailConfig(event)).toEqual(mail);
    expect(await displayMinAge(event)).toBe(18);
    expect(api.config).toHaveBeenCalledOnce();
  });

  it('sin saberlo, los dos falsos: no se promete ningún correo', async () => {
    api.config.mockResolvedValue(down);
    expect(await displayMailConfig(event)).toEqual({
      unverifiedReminder: false,
      passwordChangedNotice: false,
    });
  });
});
