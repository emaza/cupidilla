import { describe, expect, it } from 'vitest';
import { parseRegisterForm } from './register.ts';

const TODAY = '2026-11-11';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  const defaults = {
    email: 'ana@example.com',
    password: 'una frase larga de prueba',
    day: '5',
    month: '5',
    year: '1990',
    acceptTerms: 'on',
    termsVersion: '2026-11-borrador',
  };
  for (const [name, value] of Object.entries({ ...defaults, ...fields })) data.set(name, value);
  return data;
}

describe('parseRegisterForm (acuerdos A2 a A5)', () => {
  it('un formulario válido compone la petición del contrato con el correo normalizado', () => {
    const parsed = parseRegisterForm(form({ email: '  Ana@Example.COM ' }), TODAY, 18);
    expect(parsed).toMatchObject({
      kind: 'valid',
      request: {
        email: 'ana@example.com',
        birthDate: '1990-05-05',
        acceptTerms: true,
        termsVersion: '2026-11-borrador',
      },
    });
  });

  it('mide la contraseña como la API, tras NFKC: «e» + acento ×128 cabe', () => {
    const decomposed = 'e\u0301'.repeat(128); // 256 puntos de código sin normalizar
    expect(parseRegisterForm(form({ password: decomposed }), TODAY, 18)).toMatchObject({
      kind: 'valid',
      request: { password: decomposed },
    });
  });

  it('quien cumple 18 hoy es válido y quien los cumple mañana es un menor', () => {
    expect(parseRegisterForm(form({ day: '11', month: '11', year: '2008' }), TODAY, 18).kind).toBe(
      'valid',
    );
    expect(parseRegisterForm(form({ day: '12', month: '11', year: '2008' }), TODAY, 18)).toEqual({
      kind: 'underage',
    });
  });

  it('el menor gana a cualquier otro error y no devuelve ningún valor', () => {
    const parsed = parseRegisterForm(
      form({ day: '12', month: '11', year: '2008', email: 'xx', password: '1', acceptTerms: '' }),
      TODAY,
      18,
    );
    expect(parsed).toEqual({ kind: 'underage' });
  });

  it('un menor con una fecha escrita con ceros y espacios también lo es', () => {
    expect(
      parseRegisterForm(form({ day: ' 012 ', month: '11', year: '2008' }), TODAY, 18).kind,
    ).toBe(
      'invalid', // «012» no es un día de una o dos cifras: error de día, no un menor
    );
    expect(
      parseRegisterForm(form({ day: ' 12 ', month: ' 11 ', year: ' 2008 ' }), TODAY, 18),
    ).toEqual({
      kind: 'underage',
    });
  });

  it('una fecha futura es un error de fecha, no un menor, aunque haya otros errores', () => {
    const parsed = parseRegisterForm(form({ year: '2027', email: 'xx' }), TODAY, 18);
    expect(parsed).toMatchObject({
      kind: 'invalid',
      errors: {
        fields: {
          birthDate: 'registro.error.fecha_futura',
          email: 'registro.error.correo_formato',
        },
        dateParts: ['day', 'month', 'year'],
      },
    });
  });

  it('los valores devueltos nunca incluyen la contraseña', () => {
    const parsed = parseRegisterForm(
      form({ email: 'xx', password: 'secreto-que-no-vuelve' }),
      TODAY,
      18,
    );
    expect(parsed.kind).toBe('invalid');
    expect(JSON.stringify(parsed)).not.toContain('secreto-que-no-vuelve');
    expect(parsed).toMatchObject({
      values: { email: 'xx', day: '5', month: '5', year: '1990', acceptTerms: true },
    });
  });

  it('la casilla solo vale con «on»; cualquier otro valor cuenta como desmarcada', () => {
    for (const value of ['', 'yes', 'true', '1', 'ON']) {
      const parsed = parseRegisterForm(form({ acceptTerms: value }), TODAY, 18);
      expect(parsed, value).toMatchObject({
        kind: 'invalid',
        errors: { fields: { acceptTerms: 'registro.error.condiciones' } },
      });
    }
  });

  it('con campos repetidos se usa el primero, tanto para la edad como para la petición', () => {
    const data = form({});
    data.set('day', '5');
    data.append('day', '12'); // si se usara este, sería la fecha del menor 12/05/…
    expect(parseRegisterForm(data, TODAY, 18)).toMatchObject({
      kind: 'valid',
      request: { birthDate: '1990-05-05' },
    });
  });

  it('un valor que no es texto (archivo) cuenta como vacío', () => {
    const data = form({});
    data.set('email', new File(['x'], 'correo.txt'));
    const parsed = parseRegisterForm(data, TODAY, 18);
    expect(parsed).toMatchObject({ kind: 'invalid', values: { email: '' } });
  });

  it('[BUG-QA-2] correo y contraseña vacíos dan registro.error.correo_vacio y registro.error.contrasena_vacia', () => {
    // UX §5.3 define estos dos textos para el campo vacío. Hoy se muestran «correo_formato» y
    // «contrasena_corta», porque el esquema solo da `required` cuando el campo falta del todo.
    const parsed = parseRegisterForm(form({ email: '', password: '' }), TODAY, 18);
    expect(parsed).toMatchObject({
      kind: 'invalid',
      errors: {
        fields: {
          email: 'registro.error.correo_vacio',
          password: 'registro.error.contrasena_vacia',
        },
      },
    });
  });

  it('segunda revisión: correo en blanco (espacios, tabuladores) da correo_vacio; contraseña de espacios no es «vacía»', () => {
    for (const email of ['', ' ', '   ', '\t', ' \t ']) {
      expect(parseRegisterForm(form({ email }), TODAY, 18), JSON.stringify(email)).toMatchObject({
        kind: 'invalid',
        errors: { fields: { email: 'registro.error.correo_vacio' } },
      });
    }
    // Una contraseña de espacios no se recorta: tiene longitud, pero es corta.
    expect(parseRegisterForm(form({ password: '   ' }), TODAY, 18)).toMatchObject({
      kind: 'invalid',
      errors: { fields: { password: 'registro.error.contrasena_corta' } },
    });
    // Lo que no está vacío conserva su motivo.
    expect(parseRegisterForm(form({ email: 'ana@' }), TODAY, 18)).toMatchObject({
      kind: 'invalid',
      errors: { fields: { email: 'registro.error.correo_formato' } },
    });
    expect(parseRegisterForm(form({ password: 'abc' }), TODAY, 18)).toMatchObject({
      kind: 'invalid',
      errors: { fields: { password: 'registro.error.contrasena_corta' } },
    });
  });

  it('los dígitos que no son ASCII no valen como día, mes ni año', () => {
    for (const day of ['５', '٥', '0x5', '1e1', '+5']) {
      expect(parseRegisterForm(form({ day: day }), TODAY, 18), day).toMatchObject({
        kind: 'invalid',
        errors: { fields: { birthDate: 'registro.error.dia' } },
      });
    }
  });
});

describe('parseRegisterForm con otra edad mínima', () => {
  it('con 21: quien cumple 21 hoy es válido y quien los cumple mañana es un menor', () => {
    expect(parseRegisterForm(form({ day: '11', month: '11', year: '2005' }), TODAY, 21).kind).toBe(
      'valid',
    );
    expect(parseRegisterForm(form({ day: '12', month: '11', year: '2005' }), TODAY, 21)).toEqual({
      kind: 'underage',
    });
  });

  it('con 21, un adulto de 18 años (válido con 18) es un menor', () => {
    expect(parseRegisterForm(form({ day: '11', month: '11', year: '2008' }), TODAY, 21)).toEqual({
      kind: 'underage',
    });
  });
});
