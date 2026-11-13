import { DrizzleQueryError, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashSessionToken } from '../src/auth/sessions.service.js';
import { UsersService } from '../src/users/users.service.js';
import {
  api,
  countRows,
  createTestApp,
  registerBody,
  registerUser,
  TEST_NOW,
  truncateAll,
  type TestApp,
} from './helpers/test-app.js';

/**
 * Casos límite añadidos por QA tras la verificación de H0. Cubren lo que la lista I-1 a I-21 deja
 * fuera: la regla de edad en los límites de zona horaria, carreras, normalización de la
 * contraseña, el límite por IP del login y que no quede rastro de nadie en ninguna tabla.
 */
describe('QA: casos límite de la API', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await truncateAll(t.db);
    t.clock.set(TEST_NOW);
  });

  /** Tablas de `public` que contienen `needle` en alguna columna (búsqueda sobre la fila entera). */
  async function tablesContaining(needle: string): Promise<string[]> {
    const names = await t.db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    const found: string[] = [];
    for (const { table_name } of names.rows) {
      const result = await t.db.execute<{ count: string }>(
        sql`select count(*)::text as count from ${sql.identifier(table_name)} as r where to_jsonb(r)::text ilike ${`%${needle}%`}`,
      );
      if (Number(result.rows[0]?.count) > 0) found.push(table_name);
    }
    return found;
  }

  describe('mayoría de edad en los límites de zona horaria', () => {
    it('verano (UTC+2): cumple 18 el 2 de julio y a las 22:00 UTC del 1 ya es 2 de julio en Madrid', async () => {
      t.clock.set('2026-07-01T21:59:59Z'); // 23:59:59 del 1 de julio en Madrid
      const before = await api(t.app)
        .post('/auth/register')
        .send(registerBody({ birthDate: '2008-07-02' }));
      expect(before.status).toBe(422);
      expect(before.body.error.code).toBe('UNDERAGE');
      expect(await countRows(t.db, 'users')).toBe(0);

      t.clock.set('2026-07-01T22:00:00Z'); // 00:00:00 del 2 de julio en Madrid
      const after = await api(t.app)
        .post('/auth/register')
        .send(registerBody({ birthDate: '2008-07-02' }));
      expect(after.status).toBe(201);
    });

    it('«hoy» es la fecha de Madrid: a las 23:30 UTC la fecha de Madrid ya es la de mañana en UTC', async () => {
      t.clock.set('2026-11-10T23:30:00Z'); // 11 de noviembre en Madrid
      // Nacido «hoy» en Madrid: no es futura, es un menor.
      const today = await api(t.app)
        .post('/auth/register')
        .send(registerBody({ birthDate: '2026-11-11' }));
      expect(today.status).toBe(422);
      expect(today.body.error.code).toBe('UNDERAGE');
      // Nacido «mañana» en Madrid: futura.
      const tomorrow = await api(t.app)
        .post('/auth/register')
        .send(registerBody({ birthDate: '2026-11-12' }));
      expect(tomorrow.status).toBe(400);
      expect(tomorrow.body.error.fields).toEqual([{ path: 'birthDate', issue: 'in_future' }]);
      expect(await countRows(t.db, 'users')).toBe(0);
    });

    it('nacido un 29 de febrero bisiesto, en un año no bisiesto: el 28 de febrero ya es mayor de edad', async () => {
      t.clock.set('2018-02-28T10:00:00Z');
      const adult = await api(t.app)
        .post('/auth/register')
        .send(registerBody({ birthDate: '2000-02-29' }));
      expect(adult.status).toBe(201);

      t.clock.set('2018-02-27T10:00:00Z');
      const minor = await api(t.app)
        .post('/auth/register')
        .send(registerBody({ birthDate: '2000-02-29' }));
      expect(minor.status).toBe(422);
    });
  });

  describe('un menor no deja rastro', () => {
    it('ninguna tabla contiene su correo, su contraseña ni su fecha, tampoco con otros campos mal', async () => {
      const minor = registerBody({
        email: 'rastro.menor@example.com',
        password: 'clave-del-menor-9876',
        birthDate: '2010-06-21',
      });
      const response = await api(t.app).post('/auth/register').send(minor);
      expect(response.status).toBe(422);
      // Con otros campos mal la API valida el esquema primero (400), pero tampoco escribe nada.
      const broken = await api(t.app)
        .post('/auth/register')
        .send({ ...minor, acceptTerms: false, password: 'x' });
      expect(broken.status).toBe(400);

      for (const needle of ['rastro.menor', 'clave-del-menor', '2010-06-21', '$argon2id$']) {
        expect(await tablesContaining(needle), `«${needle}» está en alguna tabla`).toEqual([]);
      }
      expect(await countRows(t.db, 'users')).toBe(0);
      expect(await countRows(t.db, 'consents')).toBe(0);
      expect(await countRows(t.db, 'sessions')).toBe(0);
    });
  });

  describe('borrado', () => {
    it('no queda ni el correo, ni el id, ni el hash del token en ninguna tabla', async () => {
      const user = await registerUser(t.app, { email: 'rastro.adulto@example.com' });
      const other = await registerUser(t.app); // otra persona, para comprobar que sigue ahí
      expect(await tablesContaining('rastro.adulto')).toContain('users');

      const deleted = await api(t.app)
        .post('/users/me/deletion')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ password: user.password });
      expect(deleted.status).toBe(204);

      for (const needle of ['rastro.adulto', user.userId, hashSessionToken(user.token)]) {
        expect(await tablesContaining(needle), `«${needle}» sigue en alguna tabla`).toEqual([]);
      }
      expect(await tablesContaining(other.userId)).toContain('users');
    });
  });

  describe('registro concurrente', () => {
    it('cuatro registros simultáneos con el mismo correo: uno gana y los demás reciben 409, nunca 5xx', async () => {
      const email = 'carrera@example.com';
      const responses = await Promise.all(
        [' Carrera@Example.com', 'CARRERA@example.com', email, 'carrera@example.com '].map(
          (value) =>
            api(t.app)
              .post('/auth/register')
              .send(registerBody({ email: value })),
        ),
      );
      const statuses = responses.map((response) => response.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409]);
      expect(await countRows(t.db, 'users')).toBe(1);
      expect(await countRows(t.db, 'consents')).toBe(1);
      expect(await countRows(t.db, 'sessions')).toBe(1);
    });
  });

  describe('contraseñas', () => {
    it('se normaliza a NFKC: la forma de ancho completo y la normal son la misma contraseña', async () => {
      const email = 'nfkc@example.com';
      const fullWidth = 'ｐａｓｓｗｏｒｄ１２３４５'; // «password12345» en ancho completo
      await registerUser(t.app, { email, password: fullWidth });
      const login = await api(t.app).post('/auth/login').send({ email, password: 'password12345' });
      expect(login.status).toBe(200);
    });

    it('la forma compuesta y la descompuesta de una misma contraseña con tilde coinciden', async () => {
      const email = 'tildes@example.com';
      const composed = 'contraseña-canción-é'.normalize('NFC');
      const decomposed = composed.normalize('NFD');
      expect(decomposed).not.toBe(composed);
      await registerUser(t.app, { email, password: composed });
      const login = await api(t.app).post('/auth/login').send({ email, password: decomposed });
      expect(login.status).toBe(200);
    });
  });

  describe('correo', () => {
    it('254 caracteres se aceptan y 255 no', async () => {
      const local = 'a'.repeat(64);
      const domain = `${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}.com`;
      const ok = `${local}@${domain}`;
      expect(ok.length).toBe(254);
      expect(
        (
          await api(t.app)
            .post('/auth/register')
            .send(registerBody({ email: ok }))
        ).status,
      ).toBe(201);

      const tooLong = await api(t.app)
        .post('/auth/register')
        .send(registerBody({ email: `a${ok}` }));
      expect(tooLong.status).toBe(400);
      expect(tooLong.body.error.fields).toEqual([{ path: 'email', issue: 'too_long' }]);
    });
  });

  describe('límite de intentos', () => {
    it('login: el 11.º intento desde la misma IP en 15 minutos → 429 aunque cambie el correo', async () => {
      const sameIp = api(t.app, '198.51.100.77');
      for (let attempt = 1; attempt <= 10; attempt++) {
        const response = await sameIp
          .post('/auth/login')
          .send({ email: `nadie${attempt}@example.com`, password: 'contraseña-errónea' });
        expect(response.status, `intento ${attempt}`).toBe(401);
      }
      const blocked = await sameIp
        .post('/auth/login')
        .send({ email: 'otro-distinto@example.com', password: 'contraseña-errónea' });
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('RATE_LIMITED');
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('el bloqueo de un correo no afecta a otro correo desde otra IP', async () => {
      const victim = await registerUser(t.app);
      for (let attempt = 1; attempt <= 5; attempt++) {
        await api(t.app)
          .post('/auth/login')
          .send({ email: victim.email, password: 'contraseña-errónea' });
      }
      const blocked = await api(t.app)
        .post('/auth/login')
        .send({ email: victim.email, password: victim.password });
      expect(blocked.status).toBe(429);

      const bystander = await registerUser(t.app);
      const fine = await api(t.app)
        .post('/auth/login')
        .send({ email: bystander.email, password: bystander.password });
      expect(fine.status).toBe(200);
    });
  });

  describe('sesión: renovación en el límite exacto', () => {
    it('con exactamente la mitad de la duración restante no se renueva; un milisegundo menos, sí', async () => {
      const user = await registerUser(t.app);
      const get = () =>
        api(t.app).get('/auth/session').set('Authorization', `Bearer ${user.token}`);

      t.clock.set(new Date(new Date(TEST_NOW).getTime() + 15 * 24 * 60 * 60 * 1000));
      const exactly = await get();
      expect(exactly.status).toBe(200);
      expect(exactly.body.session.renewed).toBe(false);

      t.clock.set(new Date(new Date(TEST_NOW).getTime() + 15 * 24 * 60 * 60 * 1000 + 1));
      const justAfter = await get();
      expect(justAfter.status).toBe(200);
      expect(justAfter.body.session.renewed).toBe(true);
    });

    it('con exactamente expires_at la sesión ya está caducada', async () => {
      const user = await registerUser(t.app);
      t.clock.set(new Date(new Date(TEST_NOW).getTime() + 30 * 24 * 60 * 60 * 1000));
      const response = await api(t.app)
        .get('/auth/session')
        .set('Authorization', `Bearer ${user.token}`);
      expect(response.status).toBe(401);
    });
  });

  describe('cuerpos mal formados', () => {
    it('[BUG-QA-3] un cuerpo con Content-Encoding inválido o no soportado es 400 MALFORMED_REQUEST, no 500', async () => {
      const invalidGzip = await api(t.app)
        .post('/auth/login')
        .set('Content-Type', 'application/json')
        .set('Content-Encoding', 'gzip')
        .send('{}');
      expect(invalidGzip.status).toBe(400);
      expect(invalidGzip.body.error.code).toBe('MALFORMED_REQUEST');

      const unsupported = await api(t.app)
        .post('/auth/login')
        .set('Content-Type', 'application/json')
        .set('Content-Encoding', 'br')
        .send('{}');
      expect(unsupported.status).toBe(400);
      expect(unsupported.body.error.code).toBe('MALFORMED_REQUEST');
    });

    it('segunda revisión: otros cuerpos y cabeceras rotos dan 400 MALFORMED_REQUEST y nunca 5xx', async () => {
      const cases: { name: string; headers: Record<string, string>; body: string | Buffer }[] = [
        { name: 'deflate inválido', headers: { 'Content-Encoding': 'deflate' }, body: '{}' },
        { name: 'zstd', headers: { 'Content-Encoding': 'zstd' }, body: '{}' },
        { name: 'codificación inventada', headers: { 'Content-Encoding': 'foo' }, body: '{}' },
        {
          name: 'gzip truncado',
          headers: { 'Content-Encoding': 'gzip' },
          body: Buffer.from([0x1f, 0x8b, 0x08, 0x00]),
        },
        {
          name: 'charset desconocido',
          headers: { 'Content-Type': 'application/json; charset=foo' },
          body: '{}',
        },
        { name: 'JSON cortado', headers: {}, body: '{"email":' },
        {
          name: 'cuerpo de 17 kB',
          headers: {},
          body: JSON.stringify({ email: 'a'.repeat(17_000) }),
        },
      ];
      for (const [index, { name, headers, body }] of cases.entries()) {
        const response = await api(t.app, `203.0.113.${10 + index}`)
          .post('/auth/login')
          .set({ 'Content-Type': 'application/json', ...headers })
          .send(body);
        expect(response.status, name).toBe(400);
        expect(response.body, name).toEqual({
          error: { code: 'MALFORMED_REQUEST', message: 'Malformed request body' },
        });
      }
    });

    it('segunda revisión: los cuerpos mal formados no se registran como error del servidor ni vuelcan el cuerpo', async () => {
      const output: string[] = [];
      const capture = (chunk: unknown): boolean => {
        output.push(String(chunk));
        return true;
      };
      vi.spyOn(process.stdout, 'write').mockImplementation(capture);
      vi.spyOn(process.stderr, 'write').mockImplementation(capture);
      try {
        await api(t.app, '203.0.113.90')
          .post('/auth/login')
          .set('Content-Type', 'application/json')
          .set('Content-Encoding', 'gzip')
          .send('{"email":"secreto@example.com","password":"claveSecretaDeQA"}');
        await api(t.app, '203.0.113.91')
          .post('/auth/login')
          .set('Content-Type', 'application/json')
          .send('{"email":"secreto@example.com","password":"claveSecretaDeQA"');
      } finally {
        vi.restoreAllMocks();
      }
      const log = output.join('');
      expect(log, 'un 400 del cliente no es un error del servidor').not.toMatch(
        /"level":"error"|\bERROR\b|"status":5\d\d/,
      );
      expect(log).not.toContain('secreto@example.com');
      expect(log).not.toContain('claveSecretaDeQA');
    });
  });

  describe('segunda revisión: correo y contraseña vacíos, con la API llamada directamente', () => {
    const issuesOf = (body: { error: { fields: { path: string; issue: string }[] } }) =>
      Object.fromEntries(body.error.fields.map((field) => [field.path, field.issue]));

    it('registro: correo vacío, solo espacios o solo tabuladores y contraseña vacía dan required', async () => {
      for (const [index, email] of ['', '   ', '\t\n '].entries()) {
        const response = await api(t.app, `203.0.113.${100 + index}`)
          .post('/auth/register')
          .send(registerBody({ email, password: '' }));
        expect(response.status, JSON.stringify(email)).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
        expect(issuesOf(response.body), JSON.stringify(email)).toEqual({
          email: 'required',
          password: 'required',
        });
      }
    });

    it('registro: lo que no está vacío conserva su motivo (contraseña de un espacio corta, correo sin arroba con formato)', async () => {
      const short = await api(t.app, '203.0.113.110')
        .post('/auth/register')
        .send(registerBody({ email: 'ana@example.com', password: ' ' }));
      expect(issuesOf(short.body)).toEqual({ password: 'too_short' });
      const format = await api(t.app, '203.0.113.111')
        .post('/auth/register')
        .send(registerBody({ email: 'sin-arroba', password: 'una frase larga de prueba' }));
      expect(issuesOf(format.body)).toEqual({ email: 'invalid_format' });
      expect(await countRows(t.db, 'users')).toBe(0);
    });

    it('login: correo vacío o en blanco y contraseña vacía dan required; correo mal escrito, invalid_format', async () => {
      const empty = await api(t.app, '203.0.113.120')
        .post('/auth/login')
        .send({ email: '  ', password: '' });
      expect(empty.status).toBe(400);
      expect(issuesOf(empty.body)).toEqual({ email: 'required', password: 'required' });
      const malformed = await api(t.app, '203.0.113.121')
        .post('/auth/login')
        .send({ email: 'malcorreo', password: 'x' });
      expect(issuesOf(malformed.body)).toEqual({ email: 'invalid_format' });
    });

    it('borrado de cuenta: contraseña vacía da required y no borra nada', async () => {
      const user = await registerUser(t.app);
      const response = await api(t.app, '203.0.113.130')
        .post('/users/me/deletion')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ password: '' });
      expect(response.status).toBe(400);
      expect(issuesOf(response.body)).toEqual({ password: 'required' });
      expect(await countRows(t.db, 'users')).toBe(1);
    });
  });
});

describe('QA: los logs, en los caminos de error', () => {
  let t: TestApp;
  let output: string[];

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await truncateAll(t.db);
    t.clock.set(TEST_NOW);
    output = [];
    const capture = (chunk: unknown): boolean => {
      output.push(String(chunk));
      return true;
    };
    vi.spyOn(process.stdout, 'write').mockImplementation(capture);
    vi.spyOn(process.stderr, 'write').mockImplementation(capture);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('un error interno de base de datos (500) no vuelca ni el correo, ni la contraseña, ni el hash, ni la fecha', async () => {
    const body = registerBody({
      email: 'fallo.interno@example.com',
      password: 'contraseña-del-fallo-interno',
      birthDate: '1984-02-17',
    });
    const users = t.app.get(UsersService);
    vi.spyOn(users, 'create').mockRejectedValue(
      new DrizzleQueryError(
        'insert into "users" ("email", "password_hash", "birth_date") values ($1, $2, $3)',
        [body.email, '$argon2id$v=19$m=65536,t=3,p=4$salsalsal$hashhashhash', body.birthDate],
        // XX000 (internal_error) y no 57P01: una conexión perdida en un POST ya es 503
        // OUTCOME_UNKNOWN (§6.3), y este test es del 500.
        Object.assign(new Error('connection terminated'), { code: 'XX000' }),
      ),
    );

    const response = await api(t.app, '203.0.113.200').post('/auth/register').send(body);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal error' } });

    vi.restoreAllMocks();
    const log = output.join('');
    expect(log, 'el 500 no se ha registrado').toContain('DrizzleQueryError');
    for (const secret of [
      body.email,
      body.password,
      body.birthDate,
      '$argon2id$',
      'hashhashhash',
      'insert into',
    ]) {
      expect(log, `el log contiene «${secret}»`).not.toContain(secret);
    }
  });

  it('el log tampoco contiene la IP del cliente ni la cabecera Authorization', async () => {
    const ip = '203.0.113.201';
    const user = await registerUser(t.app);
    const session = await api(t.app, ip)
      .get('/auth/session')
      .set('Authorization', `Bearer ${user.token}`);
    expect(session.status).toBe(200);
    await api(t.app, ip)
      .post('/auth/login')
      .send({ email: user.email, password: 'mal-mal-mal-mal' });

    vi.restoreAllMocks();
    const log = output.join('');
    expect(log).toContain('"route":"/auth/session"');
    for (const secret of [ip, user.token, hashSessionToken(user.token), 'Bearer', user.email]) {
      expect(log, `el log contiene «${secret}»`).not.toContain(secret);
    }
  });
});
