import { ERROR_CODES, FIELD_ISSUES } from '@cupidilla/contracts';
import { describe, expect, it } from 'vitest';
import { texts } from '#lib/texts.ts';
import { errorMessages, fieldMessages, WEB_ERROR_CODES } from './messages.ts';

const codes = [...ERROR_CODES, ...WEB_ERROR_CODES] as const;

describe('W-1: messages.ts', () => {
  it.each(Object.entries(errorMessages))(
    'el formulario %s tiene texto para cada código',
    (_, map) => {
      for (const code of codes) {
        const key = map[code];
        expect(key, code).toBeDefined();
        expect(texts[key], code).toMatch(/\S/);
      }
    },
  );

  it('cada campo de cada formulario tiene texto para cada FieldIssue', () => {
    for (const [form, fields] of Object.entries(fieldMessages)) {
      for (const [field, issues] of Object.entries(fields)) {
        for (const issue of FIELD_ISSUES) {
          const key = (issues as Record<string, keyof typeof texts>)[issue];
          expect(key, `${form}.${field}.${issue}`).toBeDefined();
          expect(texts[key!], `${form}.${field}.${issue}`).toMatch(/\S/);
        }
      }
    }
  });

  it('usa los textos de UX §5 para los casos principales', () => {
    expect(texts[errorMessages.entrar.INVALID_CREDENTIALS]).toBe(
      'Correo o contraseña incorrectos.',
    );
    expect(texts[errorMessages.registro.RATE_LIMITED]).toBe(
      'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
    );
    expect(errorMessages.registro.API_UNAVAILABLE).toBe('registro.error.servidor');
    expect(errorMessages.salir.API_UNAVAILABLE).toBe('cuenta.error.servidor');
    // Resultado incierto: solo registro y eliminación tienen texto propio (criterio 65).
    expect(errorMessages.registro.OUTCOME_UNKNOWN).toBe('registro.error.resultado_incierto');
    expect(errorMessages.eliminar.OUTCOME_UNKNOWN).toBe('eliminar.error.resultado_incierto');
    expect(errorMessages.entrar.OUTCOME_UNKNOWN).toBe('entrar.error.servidor');
    expect(errorMessages.salir.OUTCOME_UNKNOWN).toBe('cuenta.error.servidor');
    expect(fieldMessages.registro.birthDate.in_future).toBe('registro.error.fecha_futura');
    expect(fieldMessages.registro.password.too_short).toBe('registro.error.contrasena_corta');
  });
});
