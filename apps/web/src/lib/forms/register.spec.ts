import { describe, expect, it } from 'vitest';
import { parseRegisterForm } from './register.ts';

const TODAY = '2026-11-11';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  const defaults = {
    correo: 'ana@example.com',
    contrasena: 'una frase larga de prueba',
    dia: '5',
    mes: '5',
    anio: '1990',
    condiciones: 'on',
    version_condiciones: '2026-11-borrador',
  };
  for (const [name, value] of Object.entries({ ...defaults, ...fields })) data.set(name, value);
  return data;
}

describe('parseRegisterForm (acuerdos A2 a A5)', () => {
  it('un formulario válido compone la petición del contrato con el correo normalizado', () => {
    const parsed = parseRegisterForm(form({ correo: '  Ana@Example.COM ' }), TODAY);
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
    expect(parseRegisterForm(form({ contrasena: decomposed }), TODAY)).toMatchObject({
      kind: 'valid',
      request: { password: decomposed },
    });
  });

  it('quien cumple 18 hoy es válido y quien los cumple mañana es un menor', () => {
    expect(parseRegisterForm(form({ dia: '11', mes: '11', anio: '2008' }), TODAY).kind).toBe(
      'valid',
    );
    expect(parseRegisterForm(form({ dia: '12', mes: '11', anio: '2008' }), TODAY)).toEqual({
      kind: 'underage',
    });
  });

  it('el menor gana a cualquier otro error y no devuelve ningún valor', () => {
    const parsed = parseRegisterForm(
      form({ dia: '12', mes: '11', anio: '2008', correo: 'xx', contrasena: '1', condiciones: '' }),
      TODAY,
    );
    expect(parsed).toEqual({ kind: 'underage' });
  });

  it('un menor con una fecha escrita con ceros y espacios también lo es', () => {
    expect(parseRegisterForm(form({ dia: ' 012 ', mes: '11', anio: '2008' }), TODAY).kind).toBe(
      'invalid', // «012» no es un día de una o dos cifras: error de día, no un menor
    );
    expect(parseRegisterForm(form({ dia: ' 12 ', mes: ' 11 ', anio: ' 2008 ' }), TODAY)).toEqual({
      kind: 'underage',
    });
  });

  it('una fecha futura es un error de fecha, no un menor, aunque haya otros errores', () => {
    const parsed = parseRegisterForm(form({ anio: '2027', correo: 'xx' }), TODAY);
    expect(parsed).toMatchObject({
      kind: 'invalid',
      errors: {
        fields: { fecha: 'registro.error.fecha_futura', correo: 'registro.error.correo_formato' },
        dateParts: ['dia', 'mes', 'anio'],
      },
    });
  });

  it('los valores devueltos nunca incluyen la contraseña', () => {
    const parsed = parseRegisterForm(
      form({ correo: 'xx', contrasena: 'secreto-que-no-vuelve' }),
      TODAY,
    );
    expect(parsed.kind).toBe('invalid');
    expect(JSON.stringify(parsed)).not.toContain('secreto-que-no-vuelve');
    expect(parsed).toMatchObject({
      values: { correo: 'xx', dia: '5', mes: '5', anio: '1990', condiciones: true },
    });
  });

  it('la casilla solo vale con «on»; cualquier otro valor cuenta como desmarcada', () => {
    for (const value of ['', 'yes', 'true', '1', 'ON']) {
      const parsed = parseRegisterForm(form({ condiciones: value }), TODAY);
      expect(parsed, value).toMatchObject({
        kind: 'invalid',
        errors: { fields: { condiciones: 'registro.error.condiciones' } },
      });
    }
  });

  it('con campos repetidos se usa el primero, tanto para la edad como para la petición', () => {
    const data = form({});
    data.set('dia', '5');
    data.append('dia', '12'); // si se usara este, sería la fecha del menor 12/05/…
    expect(parseRegisterForm(data, TODAY)).toMatchObject({
      kind: 'valid',
      request: { birthDate: '1990-05-05' },
    });
  });

  it('un valor que no es texto (archivo) cuenta como vacío', () => {
    const data = form({});
    data.set('correo', new File(['x'], 'correo.txt'));
    const parsed = parseRegisterForm(data, TODAY);
    expect(parsed).toMatchObject({ kind: 'invalid', values: { correo: '' } });
  });

  it('[BUG-QA-2] correo y contraseña vacíos dan registro.error.correo_vacio y registro.error.contrasena_vacia', () => {
    // UX §5.3 define estos dos textos para el campo vacío. Hoy se muestran «correo_formato» y
    // «contrasena_corta», porque el esquema solo da `required` cuando el campo falta del todo.
    const parsed = parseRegisterForm(form({ correo: '', contrasena: '' }), TODAY);
    expect(parsed).toMatchObject({
      kind: 'invalid',
      errors: {
        fields: {
          correo: 'registro.error.correo_vacio',
          contrasena: 'registro.error.contrasena_vacia',
        },
      },
    });
  });

  it('segunda revisión: correo en blanco (espacios, tabuladores) da correo_vacio; contraseña de espacios no es «vacía»', () => {
    for (const correo of ['', ' ', '   ', '\t', ' \t ']) {
      expect(parseRegisterForm(form({ correo }), TODAY), JSON.stringify(correo)).toMatchObject({
        kind: 'invalid',
        errors: { fields: { correo: 'registro.error.correo_vacio' } },
      });
    }
    // Una contraseña de espacios no se recorta: tiene longitud, pero es corta.
    expect(parseRegisterForm(form({ contrasena: '   ' }), TODAY)).toMatchObject({
      kind: 'invalid',
      errors: { fields: { contrasena: 'registro.error.contrasena_corta' } },
    });
    // Lo que no está vacío conserva su motivo.
    expect(parseRegisterForm(form({ correo: 'ana@' }), TODAY)).toMatchObject({
      kind: 'invalid',
      errors: { fields: { correo: 'registro.error.correo_formato' } },
    });
    expect(parseRegisterForm(form({ contrasena: 'abc' }), TODAY)).toMatchObject({
      kind: 'invalid',
      errors: { fields: { contrasena: 'registro.error.contrasena_corta' } },
    });
  });

  it('los dígitos que no son ASCII no valen como día, mes ni año', () => {
    for (const day of ['５', '٥', '0x5', '1e1', '+5']) {
      expect(parseRegisterForm(form({ dia: day }), TODAY), day).toMatchObject({
        kind: 'invalid',
        errors: { fields: { fecha: 'registro.error.dia' } },
      });
    }
  });
});
