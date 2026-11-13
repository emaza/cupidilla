# H0 — Diseño técnico de la base mínima

[← Índice](../README.md) · Hito: [H0 en el MVP](mvp.md#h0--base-mínima) · Fecha: 11 de noviembre de 2026

Documento para el programador. Con él y con los demás documentos de `docs/` se implementa H0 sin tomar decisiones de arquitectura. Donde algo se deja abierto, se dice quién lo decide.

## Resumen

Se construye un monorepo con **npm workspaces** y tres paquetes:

- `apps/web`: SvelteKit 3 sobre Svelte 5 estable, con runas. Es lo único que ve el navegador. Hace de *backend for frontend*: sus `load` y sus *form actions* llaman a la API desde el servidor.
- `apps/api`: NestJS 12, monolito modular con los módulos `auth`, `users` y `consents`, Drizzle ORM sobre PostgreSQL 18.
- `packages/contracts`: esquemas Zod 4, códigos de error y la regla de mayoría de edad. Lo usan la web y la API.

La sesión es un token opaco aleatorio. La base de datos guarda solo su hash SHA-256. El token vive en una cookie `httpOnly` del dominio de la web, y SvelteKit lo reenvía a la API como `Authorization: Bearer`. Salir o borrar la cuenta elimina la fila de la sesión y la revoca al instante. PostgreSQL corre en Docker; las aplicaciones corren con Node 24 en el anfitrión.

Por qué así: es la arquitectura mínima que cumple `docs/arquitectura.md`, con un solo despliegue de API y un solo punto que habla con el navegador, sin CORS ni JWT y sin servicios adicionales como Redis.

---

## 1. Objeciones

**No tengo objeciones de peso** a las trece decisiones del CTO. Diseño con todas ellas tal cual. Sí hay seis **matices** que encajan dentro de lo decidido y que conviene conocer:

| # | Decisión | Matiz |
|---|---|---|
| 4 | Navegador → SvelteKit → API | La API solo acepta peticiones con una **clave interna compartida** (`X-Internal-Api-Key`). Así no queda expuesta por accidente, y la web puede pasarle la IP del cliente (`X-Client-Ip`) para limitar intentos. Son unas 20 líneas y ninguna pieza nueva |
| 5 | Sin correo en H0 | Sin verificación de correo, el registro **tiene que decir** que un correo ya está en uso (`EMAIL_TAKEN`): si no lo dijera, la persona creería haberse registrado y no podría entrar. Es una enumeración de cuentas aceptada en H0 y contenida con el límite de intentos. Cuando haya correo (antes de la beta), el registro pasa a dar una respuesta uniforme. Otro efecto: alguien puede registrar un correo ajeno, y el dueño real no podrá recuperarlo hasta que exista la verificación |
| 6 | Edad mínima | La fecha de «hoy» se toma en **Europe/Madrid**. Ver [§9](#9-regla-de-mayoría-de-edad) |
| 7 | Contraseña de 10 a 128 caracteres | Se cuentan **puntos de código Unicode**, no unidades UTF-16 (un emoji cuenta como uno o más caracteres visibles, nunca como «medio»). La contraseña se normaliza a **NFKC** antes del hash y de la verificación, como recomienda NIST SP 800-63B. No se recortan espacios |
| 8 | Borrado real | En PostgreSQL no queda nada. Quedan dos zonas grises **por revisar jurídicamente**: los registros (logs, que en H0 no contienen identificadores; ver [§8.9](#89-qué-no-se-registra-en-los-logs)) y las copias de seguridad en producción, que todavía no existen |
| 9 | Versión del consentimiento | El formulario envía la versión que se mostró. La API la compara con la vigente y la rechaza si no coincide (`TERMS_VERSION_OUTDATED`). Así la versión guardada es la que la persona vio, aunque haya habido un despliegue entre medias |

---

## 1 bis. Acuerdos entre este diseño y el de UX

Resueltos por el CTO el 11 de noviembre de 2026, al cruzar este documento con [el diseño UX](h0-diseno-ux.md). **Reparto**: este documento manda en código, datos, API y seguridad; el de UX manda en pantallas, marcado HTML, textos y flujo visible. Las secciones afectadas de ambos ya están corregidas; esta tabla deja constancia del acuerdo y de su porqué.

| # | Tema | Acuerdo | Por qué |
|---|---|---|---|
| A1 | Nombres de los campos | Los `name` e `id` del HTML van en español, como en UX: `correo`, `contrasena`, `dia`, `mes`, `anio`, `condiciones`, `siguiente`. La acción de SvelteKit los convierte al contrato en inglés (`email`, `password`, `birthDate`, `acceptTerms`, `termsVersion`) | Son interfaz: aparecen en los enlaces del resumen de errores. El contrato sigue en inglés |
| A2 | Fecha de nacimiento | Tres campos de texto (UX §3.2). `apps/web/src/lib/forms/birth-date.ts` los valida por partes y compone `YYYY-MM-DD`: devuelve la fecha o el error de la parte que falla. Después se aplican `birthDateSchema` y `checkBirthDate` de `contracts` | El contrato no cambia; los errores por parte son de presentación |
| A3 | Orden de validación en la web | El de UX §1.2: si los tres campos componen una fecha real y es de un menor, se muestra la pantalla de menor aunque haya otros errores. La API mantiene su orden (esquema → edad) y sigue siendo quien garantiza que no se crea nada | Un menor no recibe de vuelta un formulario con sus datos |
| A4 | Menor de edad | La acción responde `fail(422, { underage: true })` **sin ningún valor** (ni correo ni fecha) y la página pinta la pantalla de cierre de UX §3.2.2 en la misma ruta. El código es 422, no 403 | 422 es el que ya devuelve la API |
| A5 | Valores tras un error | Se devuelven correo, día, mes, año y el estado de la casilla; nunca la contraseña | WCAG 3.3.7: no obligar a reescribir. La fecha solo vuelve a quien la acaba de escribir |
| A6 | Volver a la ruta pedida | Sí hay `siguiente`, con lista cerrada y comparación exacta: `/cuenta` y `/cuenta/eliminar`. Cualquier otro valor se ignora y se va a `/cuenta` | H1 añadirá rutas privadas y lo necesitará; con lista cerrada no hay redirección abierta |
| A7 | Avisos tras redirigir | `/?aviso=sesion-cerrada` y `/?aviso=cuenta-eliminada`, lista cerrada; un valor desconocido no muestra nada | Sin estado en el servidor ni cookie adicional |
| A8 | Cerrar sesión | `POST /cuenta?/salir`, y el botón está **solo** en `/cuenta`, no en la cabecera | Una única forma de salir, la que UX ha diseñado |
| A9 | Eliminar la cuenta | Solo se pide la contraseña; **sin casilla** de confirmación | Volver a escribir la contraseña ya es la confirmación |
| A10 | Correo mal escrito al entrar | La web muestra el mensaje genérico de credenciales y no llama a la API. Solo un campo vacío da error por campo | Un único mensaje para todo lo que no sea entrar |
| A11 | Versión de condiciones caducada | `TERMS_VERSION_OUTDATED` vuelve a pintar el formulario con la casilla desmarcada y el texto `registro.error.condiciones_version` | Faltaba ese texto en UX; ya está añadido |
| A12 | Textos | Salen de la tabla de UX §5, palabra por palabra. `messages.ts` solo relaciona códigos con esas claves | Una sola fuente de textos |
| A13 | Fecha de nacimiento guardada | Se guarda completa (`users.birth_date`): H2 la necesita para el filtro de edad. La ayuda del campo no promete un uso único | Coherencia entre lo que se dice y lo que se guarda |
| A14 | Fallo al cerrar sesión | Si la API responde 204 o 401, se borra la cookie y se sale. Si la API no responde o da 5xx, **no** se borra la cookie y se muestra `cuenta.error.servidor` | No decir «has salido» cuando la sesión no se ha podido revocar |

---

## 2. Versiones fijadas

Todas se han comprobado hoy, 11 de noviembre de 2026, con `npm view <paquete>@<versión> version engines peerDependencies dist-tags` y con la documentación oficial que se cita. Se fijan **exactas** (`save-exact=true`) y se instala con un único `package-lock.json` en la raíz.

### Entorno

| Pieza | Versión | Verificación |
|---|---|---|
| Node.js | **24.x LTS** (instalada 24.21.0; última 24.22.2, del 27 de octubre de 2026) | `nodejs.org/dist/index.json` y `github.com/nodejs/Release/schedule.json`. Node 24 está en *maintenance LTS* desde el 20 de octubre de 2026, con soporte hasta el 30 de abril de 2028 |
| `engines.node` | `>=24.15.0 <25` | El mínimo lo marca `@nestjs/schematics@12.0.13` (`^22.22.3 \|\| ^24.15.0 \|\| >=26`). SvelteKit 3 pide `>=22.17`; Vitest 5, `^22.12 \|\| ^24 \|\| >=26` |
| `.nvmrc` | `24` | — |
| npm | 11.19.0 (`packageManager: "npm@11.19.0"`, `engines.npm: ">=11.19"`) | Instalada |
| PostgreSQL | **`postgres:18.6-alpine`** | Docker Hub y `docker-library/postgres/versions.json`. La 19 está en `19rc1`, así que no se usa. Desde la 18 la imagen declara `VOLUME /var/lib/postgresql` y `PGDATA=/var/lib/postgresql/18/docker`: el volumen se monta en `/var/lib/postgresql` (comprobado en el Dockerfile oficial y en un contenedor de prueba) |

### Web (`apps/web`)

| Paquete | Versión | Notas verificadas |
|---|---|---|
| `svelte` | **5.57.3** | `dist-tags.latest`. No existe ninguna Svelte 6 publicada; `next` apunta a una 5.0 antigua |
| `@sveltejs/kit` | **3.2.0** | Pide como *peers* `svelte ^5.57.1`, `vite ^8.0.12`, `typescript ^6.0.0` y `@sveltejs/vite-plugin-svelte ^7.0.0`; `engines.node >=22.17` |
| `@sveltejs/vite-plugin-svelte` | 7.3.1 | Pide `svelte ^5.46.4` y `vite ^8` |
| `@sveltejs/adapter-node` | 6.0.2 | Pide `@sveltejs/kit ^3` |
| `vite` | 8.3.8 | — |
| `svelte-check` | 4.7.8 | Pide `typescript ^5 \|\| ^6` |
| `sv` (CLI, solo para crear la app) | 1.3.0 | — |

### API (`apps/api`)

| Paquete | Versión | Notas verificadas |
|---|---|---|
| `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/testing` | **12.4.2** | ESM (`"type": "module"`). `engines.node >= 20` |
| `@nestjs/cli` | 12.0.12 | Usa internamente `typescript ~6.0.2` |
| `@nestjs/schematics` | 12.0.13 | Pide `typescript >=6.0.0` |
| `@nestjs/config` | 12.1.1 | `validationSchema` acepta Standard Schema, como Zod ([documentación](https://docs.nestjs.com/application/configuration)) |
| `@nestjs/throttler` | 6.7.1 | Pide `@nestjs/core ^12` entre otras |
| `express` (dependencia de `platform-express`) | 5.3.0 | — |
| `reflect-metadata` | 0.2.2 | — |
| `rxjs` | 7.8.2 | — |
| `drizzle-orm` | **0.45.4** | `latest`. La 1.0 está en `rc` (1.0.0-rc.5) y **no se usa** |
| `drizzle-kit` | **0.31.11** | `latest` |
| `pg` / `@types/pg` | 8.23.1 / 8.23.1 | Driver `node-postgres` |
| `argon2` | **0.45.2** | Trae binarios precompilados para linux-x64; funciona sin ejecutar su script de instalación (comprobado) |
| `supertest` / `@types/supertest` | 7.3.2 / 7.2.1 | — |
| `@types/express` | 5.0.6 | — |

### Comunes

| Paquete | Versión | Notas verificadas |
|---|---|---|
| `typescript` | **6.0.3** | **No usar la 7.x** (la `latest` es 7.0.2, el compilador nativo, sin API JavaScript estable): `typescript-eslint` pide `<6.1.0`, SvelteKit pide `^6`, `svelte-check` pide `^5 \|\| ^6` |
| `zod` | **4.6.7** | Implementa Standard Schema (`schema['~standard']`, comprobado) |
| `vitest` / `@vitest/coverage-v8` | **5.1.0** | Pide `vite ^6.4 \|\| ^7 \|\| ^8`. Las plantillas de `sv` y `nest new` todavía generan la 4.x: **hay que subirla a mano** |
| `@playwright/test` | **1.65.0** | — |
| `@types/node` | 24.19.2 | La línea 24, alineada con el Node de ejecución |
| `eslint` | 10.14.0 | — |
| `@eslint/js` | 10.0.1 | — |
| `typescript-eslint` | 8.72.2 | Pide `typescript >=4.8.4 <6.1.0` |
| `eslint-plugin-svelte` | 3.24.1 | Declara `svelte ^5` |
| `eslint-config-prettier` | 10.1.8 | — |
| `globals` | 17.14.0 | — |
| `prettier` | 3.9.10 | — |
| `prettier-plugin-svelte` | 4.1.1 | Pide `svelte ^5.0.0` |
| `concurrently` | 10.0.7 | Solo en la raíz, para `npm run dev` |

### Descartados (con motivo)

| Paquete | Por qué no |
|---|---|
| `nestjs-zod` 5.6.0 | No declara compatibilidad con Nest 12 (pide `@nestjs/common ^10 \|\| ^11`). Además ya no hace falta: Nest 12 trae `StandardSchemaValidationPipe` |
| `@nestjs/drizzle` 0.0.2 | Es oficial, pero sigue en 0.0.x y tiene dos meses. Un `DatabaseModule` propio ocupa unas 30 líneas y no ata el proyecto a una API inestable |
| `@nestjs/authentication` 0.1.5 | Es oficial y completo (incluye verificación de correo y recuperación de contraseña), pero tiene seis semanas, está en 0.x e impone sus interfaces de almacenamiento. **Conviene reevaluarlo antes de la beta**, cuando se añada el correo |
| `@nestjs/platform-node` 12.4.2 | Es el adaptador más rápido, pero existe desde el 27 de octubre de 2026. Para 50–100 personas, Express 5 es suficiente y está más probado |
| `drizzle-orm@1.0.0-rc` | Es candidata. En H0 no se usan consultas relacionales, que es donde la 1.0 cambia más, así que migrar será barato cuando sea estable |
| `tsx` | Node 24 ejecuta TypeScript «borrable» de forma nativa. Los scripts de migración no necesitan nada más (comprobado) |
| *Remote functions* de SvelteKit | Siguen siendo experimentales en SvelteKit 3. Las *form actions* están completas y admiten mejora progresiva |
| Complemento `better-auth` de `sv` | Pondría la autenticación en SvelteKit, cuando aquí vive en la API |
| `oxlint` (lo trae `nest new`) | Se usa ESLint en todo el monorepo porque, con `eslint-plugin-svelte`, cubre también Svelte. Así hay una sola herramienta |

### Pruebas hechas para verificar (en el scratchpad, fuera del proyecto)

En `/tmp/claude-1000/-run-media-edu-Datos-Edu-Projects-taller-cupidilla/f905af32-0b79-44f6-8803-d08d0d72ed83/scratchpad/arquitecto/`:

- `nest new` con `@nestjs/cli@12.0.12` y `sv create` con `sv@1.3.0`, sin instalar, para ver qué generan. Nest genera ESM, Vitest (sin SWC), `oxlint` y TypeScript `^6.0.2`. `sv` genera `#lib`, `$app/tsconfig` y la configuración dentro de `vite.config.ts`.
- En el proyecto Nest de prueba, con Vitest 5.1.0 y TypeScript 6.0.3 instalados: la inyección de dependencias entre archivos funciona con el transformador Oxc de Vite 8, sin `unplugin-swc`. `StandardSchemaValidationPipe` existe y, con Zod, entrega al controlador la salida transformada (el correo ya normalizado). `exceptionFactory` permite el formato de error propio. `nest build` compila.
- `drizzle-kit generate` funciona en un proyecto ESM con importaciones `.js` entre archivos de esquema. La migración se aplicó con `migrate()` desde un script `.ts` ejecutado con `node` contra un `postgres:18.6-alpine` temporal (ya borrado). Comprobado: la `CHECK` de correo normalizado, el `UNIQUE`, y que borrar el usuario arrastra sesiones y consentimientos (0 filas).
- Zod 4: `z.iso.date()` rechaza `2007-02-29`, `1900-02-29` y `2026-02-30`, y acepta `2008-02-29` y `2000-02-29`. Para normalizar el correo, el `trim`/`toLowerCase` tiene que ir **antes** de `z.email()` (con `.pipe`). Los mensajes de error personalizados llegan intactos a través de Standard Schema.
- `argon2` funciona con el script de instalación bloqueado por npm 11 (un hash argon2id con los parámetros de §8.1 tarda unos 80 ms).
- La imagen `postgres:18.6-alpine` queda en la caché local de Docker.

---

## 3. Estructura del repositorio

```
cupidilla/
├─ .nvmrc                        # 24
├─ .npmrc                        # engine-strict=true, save-exact=true
├─ .gitignore
├─ .gitattributes                # * text=auto eol=lf (lo genera nest new; se sube a la raíz)
├─ .env.example                  # única plantilla de variables (ver §11)
├─ package.json                  # workspaces, scripts globales, allowScripts
├─ package-lock.json
├─ tsconfig.base.json            # opciones comunes de TypeScript
├─ eslint.config.js              # ESLint para todo el monorepo
├─ prettier.config.js
├─ .prettierignore
├─ docker-compose.yml
├─ docker/
│  └─ postgres/init/01-create-databases.sql   # crea cupidilla_test y cupidilla_e2e
├─ docs/
├─ packages/
│  └─ contracts/
│     ├─ package.json
│     ├─ tsconfig.json           # typecheck (src + tests)
│     ├─ tsconfig.build.json     # emite dist/ (sin tests)
│     └─ src/
│        ├─ index.ts             # reexporta todo
│        ├─ auth.ts              # email, contraseñas, registro, login, respuesta de sesión
│        ├─ users.ts             # usuario público, cuenta, eliminación
│        ├─ consents.ts          # finalidades, versión vigente, consentimiento
│        ├─ errors.ts            # códigos de error y forma del error
│        ├─ age.ts               # mayoría de edad y «hoy» en Europe/Madrid
│        ├─ age.spec.ts
│        └─ auth.spec.ts
├─ apps/
│  ├─ api/
│  │  ├─ package.json
│  │  ├─ nest-cli.json
│  │  ├─ tsconfig.json           # typecheck (src, test, scripts)
│  │  ├─ tsconfig.build.json     # nest build (solo src)
│  │  ├─ vitest.config.ts        # proyectos «unit» e «integration»
│  │  ├─ drizzle.config.ts
│  │  ├─ drizzle/                # migraciones SQL generadas (se versionan)
│  │  ├─ scripts/
│  │  │  ├─ migrate.ts           # aplica migraciones (node nativo)
│  │  │  └─ reset-db.ts          # vacía una BD *_test o *_e2e (se niega con cualquier otra)
│  │  ├─ src/
│  │  │  ├─ main.ts              # arranque: crea la app, configureApp(), listen
│  │  │  ├─ app.module.ts
│  │  │  ├─ configure-app.ts     # pipes, filtros, body parser: lo comparten main y tests
│  │  │  ├─ config/env.schema.ts
│  │  │  ├─ common/
│  │  │  │  ├─ clock.ts                      # Clock inyectable (now())
│  │  │  │  ├─ errors/api.exception.ts       # ApiException(code, status)
│  │  │  │  ├─ errors/api-exception.filter.ts
│  │  │  │  ├─ errors/validation-exception.factory.ts
│  │  │  │  ├─ guards/internal-key.guard.ts
│  │  │  │  ├─ guards/app-throttler.guard.ts
│  │  │  │  ├─ decorators/public.decorator.ts          # @Public(): sin sesión
│  │  │  │  ├─ decorators/skip-internal-key.decorator.ts  # solo /health
│  │  │  │  ├─ decorators/current-session.decorator.ts
│  │  │  │  └─ logging/request-logging.middleware.ts
│  │  │  ├─ database/
│  │  │  │  ├─ database.module.ts    # global; provee DB y cierra el pool
│  │  │  │  ├─ database.types.ts     # Database, Tx
│  │  │  │  ├─ pg-errors.ts          # isUniqueViolation(err, constraint)
│  │  │  │  └─ schema/{users,sessions,consents,index}.ts
│  │  │  ├─ auth/
│  │  │  │  ├─ auth.module.ts
│  │  │  │  ├─ auth.controller.ts    # /auth/*
│  │  │  │  ├─ auth.service.ts       # registro, login, logout
│  │  │  │  ├─ sessions.service.ts   # crear, validar/renovar, revocar
│  │  │  │  ├─ session.guard.ts      # guard global (APP_GUARD)
│  │  │  │  └─ *.spec.ts
│  │  │  ├─ users/
│  │  │  │  ├─ users.module.ts
│  │  │  │  ├─ users.controller.ts   # /users/me, /users/me/deletion
│  │  │  │  ├─ users.service.ts      # crear, buscar, cuenta, eliminar
│  │  │  │  ├─ password.service.ts   # argon2id: hash, verify, verifyDummy, needsRehash
│  │  │  │  └─ *.spec.ts
│  │  │  ├─ consents/
│  │  │  │  ├─ consents.module.ts
│  │  │  │  ├─ consents.service.ts   # grant, listForUser, revoke
│  │  │  │  └─ *.spec.ts
│  │  │  └─ health/health.controller.ts
│  │  └─ test/
│  │     ├─ global-setup.ts         # reset-db + migrate sobre TEST_DATABASE_URL
│  │     ├─ helpers/                # createTestApp(), FakeClock, truncateAll(), registerUser()
│  │     ├─ auth.int.spec.ts
│  │     ├─ session.int.spec.ts
│  │     ├─ account-deletion.int.spec.ts
│  │     ├─ consents.int.spec.ts
│  │     ├─ rate-limit.int.spec.ts
│  │     └─ logging.int.spec.ts
│  └─ web/
│     ├─ package.json             # incluye "imports": { "#lib": ..., "#lib/*": ... }
│     ├─ tsconfig.json            # extends "$app/tsconfig"
│     ├─ vite.config.ts           # sveltekit({ adapter, env, csp, compilerOptions }) + Vitest
│     ├─ playwright.config.ts
│     ├─ src/
│     │  ├─ app.html              # lang="es"
│     │  ├─ app.css
│     │  ├─ app.d.ts              # App.Locals
│     │  ├─ env.ts                # defineEnvVars: API_URL, INTERNAL_API_KEY
│     │  ├─ hooks.server.ts       # sesión, guardia de rutas, cabeceras, handleError
│     │  ├─ lib/
│     │  │  ├─ server/api-client.ts     # única puerta a la API
│     │  │  ├─ server/session-cookie.ts
│     │  │  ├─ errors/messages.ts       # código → texto en español
│     │  │  ├─ errors/messages.spec.ts
│     │  │  ├─ forms/                   # FormData → objeto de contrato
│     │  │  └─ legal/terms-2026-11-borrador.svelte
│     │  └─ routes/
│     │     ├─ +layout.svelte
│     │     ├─ +layout.server.ts
│     │     ├─ +error.svelte
│     │     ├─ +page.svelte                          # /
│     │     ├─ (invitado)/registro/+page.svelte|+page.server.ts
│     │     ├─ (invitado)/entrar/+page.svelte|+page.server.ts
│     │     ├─ (privado)/cuenta/+page.svelte|+page.server.ts        # acción «salir»
│     │     ├─ (privado)/cuenta/eliminar/+page.svelte|+page.server.ts
│     │     └─ legal/condiciones/+page.svelte
│     └─ tests/e2e/
│        ├─ helpers/db.ts         # consulta E2E_DATABASE_URL con pg
│        ├─ account-lifecycle.e2e.ts
│        ├─ minor.e2e.ts
│        ├─ no-js.e2e.ts
│        └─ csrf.e2e.ts
```

Los grupos de rutas `(invitado)` y `(privado)` no cambian las URL: siguen siendo `/registro`, `/entrar`, `/cuenta` y `/cuenta/eliminar`. Sirven para que la guardia de `hooks.server.ts` decida por el prefijo de `route.id` y siga funcionando cuando H1 añada rutas privadas.

### 3.1 Workspaces (`package.json` raíz)

```jsonc
{
  "name": "cupidilla",
  "private": true,
  "type": "module",
  "packageManager": "npm@11.19.0",
  "engines": { "node": ">=24.15.0 <25", "npm": ">=11.19" },
  "workspaces": ["packages/*", "apps/*"],
  "allowScripts": { "argon2": false, "esbuild": false },
  "scripts": { /* ver §11.3 */ },
  "devDependencies": {
    "concurrently": "10.0.7", "eslint": "10.14.0", "@eslint/js": "10.0.1",
    "typescript-eslint": "8.72.2", "eslint-plugin-svelte": "3.24.1",
    "eslint-config-prettier": "10.1.8", "globals": "17.14.0",
    "prettier": "3.9.10", "prettier-plugin-svelte": "4.1.1", "typescript": "6.0.3"
  }
}
```

- Nombres de paquete: `@cupidilla/contracts`, `@cupidilla/api`, `@cupidilla/web`. Se declaran como dependencia con `"@cupidilla/contracts": "*"`; npm no admite el protocolo `workspace:`.
- **Scripts de instalación**: npm 11.19 los bloquea por defecto y lleva la lista en `allowScripts`. Hoy solo aparecen `argon2` (`node-gyp rebuild`) y `esbuild` (lo arrastra `drizzle-kit`), y ninguno los necesita: argon2 trae binarios y esbuild usa el paquete opcional de su plataforma. Se **deniegan**. Tras cada `npm install`, `npm install-scripts ls` tiene que salir vacío. Solo se aprueba un paquete (`npm install-scripts approve <pkg>`) si falla sin su script.
- `.npmrc`: `engine-strict=true` y `save-exact=true`.

### 3.2 TypeScript

TypeScript 6 cambia valores por defecto: `types` pasa a `[]`, `rootDir` pasa a la carpeta del `tsconfig`, `strict` pasa a `true` y no se usa `baseUrl` ([anuncio de TS 6.0](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/)). Por eso se declaran siempre `types` y `rootDir`.

`tsconfig.base.json` (raíz):

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "sourceMap": true
  }
}
```

| Paquete | `tsconfig.json` |
|---|---|
| `packages/contracts` | `extends ../../tsconfig.base.json`; `module`/`moduleResolution: "nodenext"`, `verbatimModuleSyntax: true`, `types: ["node"]`, `rootDir: "src"`, `outDir: "dist"`, `declaration: true`, `declarationMap: true`. `tsconfig.build.json` excluye `**/*.spec.ts` |
| `apps/api` | `extends ../../tsconfig.base.json`; las opciones de la plantilla de Nest 12: `module`/`moduleResolution: "nodenext"`, `experimentalDecorators: true`, `emitDecoratorMetadata: true`, `strictPropertyInitialization: false`, `declaration: false`, `outDir: "dist"`, `rootDir: "."`, `types: ["node"]`. Incluye `src`, `test`, `scripts`, `*.config.ts`. `tsconfig.build.json`: `rootDir: "src"`, solo `src`, sin `*.spec.ts`. **Sin** `verbatimModuleSyntax` (ver riesgo R3) |
| `apps/web` | Lo que genera `sv`: `extends "$app/tsconfig"` (no se puede combinar con la base; se repiten `strict`, `noUncheckedIndexedAccess` y `noImplicitOverride`). `types: ["$app/types", "node"]`. `include` con `src`, `tests` y los archivos de configuración |

### 3.3 Formato de módulos y `packages/contracts`

Todo es **ESM** (`"type": "module"`). Los paquetes de Nest 12 solo existen en ESM. En la API y en `contracts` las importaciones relativas terminan en `.js`; en la web, `#lib/...` lleva también la extensión.

`contracts` **se compila con `tsc`** a `dist/` (JavaScript ESM y `.d.ts`), y los dos consumidores leen `dist/`:

```json
{
  "name": "@cupidilla/contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "dev": "tsc -p tsconfig.build.json --watch --preserveWatchOutput",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": { "zod": "4.6.7" },
  "devDependencies": { "typescript": "6.0.3", "vitest": "5.1.0", "vite": "8.3.8", "@types/node": "24.19.2" }
}
```

- **Por qué compilado y no fuente `.ts` directa**: `nest build` (tsc con `rootDir`) no compila archivos de fuera de la app, y Node no aplica *type stripping* a las dependencias. Compilar es lo único que funciona igual en Vite, en Nest, en Vitest y en Node.
- En desarrollo, `npm run dev` compila `contracts` primero y lo deja en `--watch`. Vite trata los paquetes enlazados como fuente, así que recarga al cambiar `dist/`. Nest en `--watch` vuelve a arrancar.
- `zod` va en `dependencies` de `contracts`, y también en las apps que importen `z` directamente, siempre en 4.6.7 exacta. npm deja una sola copia.
- En la web, `contracts` y `zod` van en `devDependencies`, porque `adapter-node` empaqueta las dependencias de desarrollo. En la API van en `dependencies`.
- `contracts` **no depende de Node** en tiempo de ejecución: solo de Zod y de `Intl`. Se puede importar desde el navegador.

### 3.4 Lint y formato

- **Un `eslint.config.js` en la raíz** (configuración plana), partiendo de lo que genera `sv` (§4.3): `@eslint/js` recomendado, `typescript-eslint` recomendado, `eslint-plugin-svelte` recomendado y `eslint-config-prettier`. Además:
  - Lint con tipos (`parserOptions.projectService: true`) y `@typescript-eslint/no-floating-promises: "error"` en todo `*.ts`.
  - `apps/api/src/**`: `no-console: "error"`. Se registra con el `Logger` de Nest, para que nada se escape a la consola sin pasar por las reglas de §8.9.
  - `apps/web/src/**`: `no-restricted-imports` de `pg`, `drizzle-orm` y `argon2`. La web no toca la base de datos.
  - **No** activar `@typescript-eslint/consistent-type-imports` en `apps/api` (riesgo R3).
  - Se ignoran `**/dist`, `**/build`, `**/.svelte-kit`, `apps/api/drizzle/meta`, `coverage`, `playwright-report` y `test-results`.
- **Prettier en la raíz** (`prettier.config.js`): `singleQuote: true`, `trailingComma: "all"`, `printWidth: 100`, `useTabs: false`, `tabWidth: 2` y `plugins: ["prettier-plugin-svelte"]`. La opción es arbitraria; lo que importa es que sea una sola. Se borran el `.prettierrc` de Nest y el `prettier.config.js` de `sv`.
- `npm run lint` = `eslint . && prettier --check .`; `npm run format` = `prettier --write .`.

---

## 4. Cómo se crea cada app

Se ejecuta desde la raíz del proyecto, **después** de crear los archivos de la raíz (§3.1–§3.4) y `packages/contracts` a mano. La carpeta no es un repositorio git (no se inicializa): por eso se pasa `--skip-git`.

### 4.1 Raíz y `packages/contracts`

No hay generador: se escriben los archivos de §3 a mano. Después, `npm install`.

### 4.2 `apps/api`

```sh
npx @nestjs/cli@12.0.12 new api --directory apps/api --skip-git --skip-install --package-manager npm --no-observe
```

- Si pregunta el sistema de módulos, se elige **ESM**. Sin terminal interactiva, ESM es el valor por defecto (comprobado). El ejecutor de tests sale de esa elección: con ESM, Vitest.
- `--no-observe`: sin telemetría de NestJS Observe.

Ajustes después de generar:

1. En `package.json`: `name: "@cupidilla/api"`. Fijar las versiones de §2. Cambiar `vitest` y `@vitest/coverage-v8` a 5.1.0. Quitar `@nestjs/mau`, `source-map-support`, `oxlint`, `oxlint-tsgolint` y el script `deploy`. Añadir las dependencias de §2 y los scripts de §11.3.
2. Borrar `.oxlintrc.json` y `.prettierrc`. Mover `.gitattributes` a la raíz.
3. En `AGENTS.md`, borrar la sección «Production data: NestJS Observe» y conservar el resto.
4. Borrar `app.controller*`, `app.service.ts` y `test/app.e2e-spec.ts`; en su lugar va `health.controller.ts`.
5. Sustituir `vitest.config.ts` y `vitest.config.e2e.ts` por un único `vitest.config.ts` con dos proyectos (§12.2). Los tests importan `describe`/`it`/`expect` desde `vitest` (sin `globals`), así que se quita `vitest/globals` de `types`.
6. Ajustar `tsconfig.json` y `tsconfig.build.json` según §3.2. `nest-cli.json` se queda como lo genera la plantilla (constructor `tsc`).

### 4.3 `apps/web`

```sh
npx sv@1.3.0 create apps/web --template minimal --types ts \
  --add "sveltekit-adapter=adapter:node" "vitest=usages:unit" "playwright=demo:no" \
  --no-install
```

- No se añaden `prettier` ni `eslint` con `sv`: van en la raíz. Su contenido de referencia es el que genera `sv` con esos complementos (verificado).
- No se añade `drizzle` ni `better-auth`: la web no accede a la base de datos ni gestiona la autenticación.

Ajustes después de generar:

1. En `package.json`: `name: "@cupidilla/web"`. Fijar versiones (`vitest` 5.1.0). Conservar el campo `imports` (`#lib`). Scripts de §11.3.
2. Borrar `.npmrc` (va en la raíz), `src/lib/vitest-examples/` y `src/routes/page.svelte.e2e.ts`.
3. En `vite.config.ts`, añadir las opciones de §8.6 y §11.2 dentro de `sveltekit({...})`. Conservar la opción `compilerOptions.runes` que fuerza el modo runas. En el proyecto de Vitest, **quitar `extends: './vite.config.ts'`**: en Vitest 5 los proyectos en línea heredan la configuración raíz por defecto, y referenciar una configuración que define `projects` crea proyectos anidados.
4. En `src/app.html`: `lang="es"`. Sustituir `style="display: contents"` por una clase en `app.css` (por la CSP; §8.6).
5. Al terminar, comprobar con `npm ls svelte @sveltejs/kit` que la versión instalada es `svelte@5.57.3` y `@sveltejs/kit@3.2.0`, sin sufijos `-next` ni `-rc`.

Svelte 5, en la práctica: `$props()`, `$state()`, `$derived()`, `onclick={...}` y `{@render children()}`. Para el estado de página se usa `$app/state` (`$app/stores` ya no existe en SvelteKit 3). Y nunca `export let`, `$:`, `on:click` ni `<slot>`.

---

## 5. Modelo de datos

Tres tablas. Los nombres SQL van en `snake_case` y se escriben **explícitamente** en cada columna, sin la opción `casing` de Drizzle: así no hay dos configuraciones que mantener sincronizadas.

### 5.1 `users`

| Columna | Tipo | Restricciones |
|---|---|---|
| `id` | `uuid` | PK, `DEFAULT gen_random_uuid()` |
| `email` | `text` | `NOT NULL`, `UNIQUE` (`users_email_unique`), `CHECK (email = lower(btrim(email)))` (`users_email_normalized`), `CHECK (char_length(email) BETWEEN 3 AND 254)` |
| `password_hash` | `text` | `NOT NULL` (cadena PHC de argon2id) |
| `birth_date` | `date` | `NOT NULL`, `CHECK (birth_date >= DATE '1900-01-01')` |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` |
| `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()`; lo actualiza la aplicación (al rehacer el hash) |

No hay columna `status`: aparecerá cuando exista algo que cambie el estado (moderación, en H3–H4). Tampoco se guardan nombre, IP ni agente de usuario (minimización).

### 5.2 `sessions`

| Columna | Tipo | Restricciones |
|---|---|---|
| `token_hash` | `text` | PK, `CHECK (token_hash ~ '^[0-9a-f]{64}$')` (SHA-256 en hexadecimal) |
| `user_id` | `uuid` | `NOT NULL`, FK → `users(id)` `ON DELETE CASCADE` |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` |
| `expires_at` | `timestamptz` | `NOT NULL` |

Índices: `sessions_user_id_idx (user_id)`, que usa el borrado en cascada, y `sessions_expires_at_idx (expires_at)`, para limpiar las caducadas. Drizzle 0.45 no tiene tipo `bytea` en `pg-core`, y por eso el hash se guarda en hexadecimal.

### 5.3 `consents`

| Columna | Tipo | Restricciones |
|---|---|---|
| `id` | `uuid` | PK, `DEFAULT gen_random_uuid()` |
| `user_id` | `uuid` | `NOT NULL`, FK → `users(id)` `ON DELETE CASCADE` |
| `purpose` | `text` | `NOT NULL`, `CHECK (purpose IN ('service_use'))` (`consents_purpose_known`) |
| `policy_version` | `text` | `NOT NULL`, `CHECK (char_length(policy_version) BETWEEN 1 AND 64)` |
| `granted_at` | `timestamptz` | `NOT NULL DEFAULT now()`. La aplicación lo escribe con el `Clock` |
| `revoked_at` | `timestamptz` | `NULL`; `CHECK (revoked_at IS NULL OR revoked_at >= granted_at)` |

Índices: `consents_user_id_idx (user_id)` y `consents_one_active_per_purpose`, un `UNIQUE (user_id, purpose) WHERE revoked_at IS NULL` que impide tener dos consentimientos activos de la misma finalidad.

**Otras finalidades y la revocación están cubiertas desde ya**:

- Añadir una finalidad (por ejemplo `sensitive_data` en H1) es una migración que amplía la `CHECK` y una línea en `CONSENT_PURPOSES` de `contracts`.
- Revocar es `UPDATE ... SET revoked_at = now()`. Conceder una versión nueva es revocar la activa e insertar otra fila, en la misma transacción, así que el histórico se conserva.

Se eligió `text` + `CHECK` en lugar de un `enum` de PostgreSQL porque es más sencillo de migrar.

### 5.4 Fragmento Drizzle de referencia

```ts
// apps/api/src/database/schema/consents.ts
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const consents = pgTable(
  'consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose', { enum: ['service_use'] }).notNull(),
    policyVersion: text('policy_version').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    index('consents_user_id_idx').on(t.userId),
    uniqueIndex('consents_one_active_per_purpose').on(t.userId, t.purpose).where(sql`${t.revokedAt} is null`),
    check('consents_purpose_known', sql`${t.purpose} in ('service_use')`),
    check('consents_revoked_after_granted', sql`${t.revokedAt} is null or ${t.revokedAt} >= ${t.grantedAt}`),
  ],
);
```

`birth_date` se declara con `date('birth_date', { mode: 'string' })`. Así viaja siempre como `'YYYY-MM-DD'` y nunca pasa por `Date`, lo que evita errores de zona horaria.

### 5.5 Normalización y unicidad del correo

1. **Normalización, en `contracts`**: `trim()` y después `toLowerCase()`, y sobre el resultado se valida `z.email()` y una longitud máxima de 254. El orden importa: `z.email()` valida antes de transformar, así que se usa `z.string().trim().toLowerCase().max(254).pipe(z.email())` (comprobado). Se baja a minúsculas también la parte local: en la práctica ningún proveedor distingue mayúsculas, y así se evitan cuentas duplicadas.
2. **Unicidad, en PostgreSQL**: `UNIQUE (email)` sobre el valor ya normalizado. La `CHECK users_email_normalized` es la red de seguridad si algún código se salta la normalización. El validador de correo de Zod 4 solo acepta ASCII, así que `toLowerCase()` de JavaScript y `lower()` de PostgreSQL coinciden.
3. **Sin consulta previa**: el registro inserta directamente. Si salta la violación `23505` sobre `users_email_unique`, se responde `EMAIL_TAKEN`. Es seguro frente a carreras.
4. Drizzle 0.45 envuelve los errores del driver en `DrizzleQueryError`, con el original en `.cause`. `isUniqueViolation(err, 'users_email_unique')` mira `err.cause?.code === '23505'` y `err.cause?.constraint`. **El `message` de `DrizzleQueryError` incluye los parámetros de la consulta** (correo, hash, fecha de nacimiento): nunca se registra (§8.9).

### 5.6 Migraciones con drizzle-kit

- `apps/api/drizzle.config.ts`: `dialect: 'postgresql'`, `schema: './src/database/schema/index.ts'`, `out: './drizzle'`, `strict: true`, `verbose: true`.
- **Generar**: `npm run db:generate -- --name <nombre_en_snake_case>` (llama a `drizzle-kit generate`). Se revisa el SQL a mano y se versiona `apps/api/drizzle/` completo, con `meta/`. La primera se llama `init`.
- **Aplicar**: `npm run db:migrate` ejecuta `node --env-file-if-exists=../../.env scripts/migrate.ts`. El script es autónomo: importa `drizzle-orm/node-postgres`, `drizzle-orm/node-postgres/migrator` y `pg`, sin importaciones relativas, para que Node 24 lo ejecute sin compilar (comprobado). Usa `DATABASE_URL`.
- **Tests**: el `globalSetup` de Vitest y el arranque de la API en e2e ejecutan el **mismo** `scripts/migrate.ts` con otra `DATABASE_URL`, precedido de `scripts/reset-db.ts`.
- Reglas: nunca `drizzle-kit push`. Una migración aplicada no se edita: se crea otra. La API **no** migra al arrancar.

---

## 6. Contratos (`packages/contracts`)

### 6.1 Constantes

```ts
export const MIN_AGE = 18;
export const REFERENCE_TIME_ZONE = 'Europe/Madrid';
export const MIN_BIRTH_DATE = '1900-01-01';
export const PASSWORD_MIN = 10;          // puntos de código
export const PASSWORD_MAX = 128;         // puntos de código
export const EMAIL_MAX = 254;
export const CONSENT_PURPOSES = ['service_use'] as const;
export const SERVICE_TERMS_VERSION = '2026-11-borrador';   // texto vigente de /legal/condiciones
```

### 6.2 Esquemas

Los mensajes de error de los esquemas **son códigos estables** (`FieldIssue`), no textos: la web los traduce. La API los recibe tal cual a través de Standard Schema (comprobado). Así la web, que valida con `safeParse`, y la API obtienen los mismos códigos.

| Esquema | Campos y reglas |
|---|---|
| `emailSchema` | `z.string({ error: 'required' }).trim().toLowerCase().max(254, { error: 'too_long' }).pipe(z.email({ error: 'invalid_format' }))` |
| `newPasswordSchema` | `string`. Puntos de código tras NFKC (`[...s.normalize('NFKC')].length`, la misma normalización que §8.1; el valor no cambia) ≥ 10 → si no, `too_short`; ≤ 128 → si no, `too_long`. Sin `trim` ni reglas de composición |
| `passwordInputSchema` (login, borrado) | `string`, de 1 a 128 puntos de código tras NFKC (`required` / `too_long`). No exige 10: si la política cambia, las cuentas antiguas siguen pudiendo entrar |
| `birthDateSchema` | `z.iso.date()`: formato `YYYY-MM-DD` y fecha real de calendario, bisiestos incluidos. Error `required` si falta e `invalid_format` si no vale; `.refine(d => d >= MIN_BIRTH_DATE, 'too_old')`. **Ni el futuro ni la edad** se comprueban aquí, porque dependen de «hoy» (§9) |
| `registerRequestSchema` | `z.strictObject({ email, password: newPasswordSchema, birthDate, acceptTerms: z.literal(true, { error: 'required' }), termsVersion: z.string().min(1).max(64) })` |
| `loginRequestSchema` | `z.strictObject({ email, password: passwordInputSchema })` |
| `deleteAccountRequestSchema` | `z.strictObject({ password: passwordInputSchema })` |
| `publicUserSchema` | `{ id: z.uuid(), email: z.string(), createdAt: z.iso.datetime() }` |
| `authResponseSchema` (registro y login) | `{ user: publicUserSchema, session: { token: z.string(), expiresAt: z.iso.datetime() } }` |
| `sessionResponseSchema` (GET /auth/session) | `{ user: publicUserSchema, session: { expiresAt: z.iso.datetime(), renewed: z.boolean() } }` |
| `consentSchema` | `{ purpose: z.enum(CONSENT_PURPOSES), policyVersion: z.string(), grantedAt: z.iso.datetime(), revokedAt: z.iso.datetime().nullable() }` |
| `accountResponseSchema` (GET /users/me) | `{ user: publicUserSchema.extend({ birthDate: z.iso.date() }), consents: z.array(consentSchema) }` |
| `apiErrorSchema` | Ver §6.3 |

`z.strictObject` rechaza campos desconocidos (`unrecognized`). Para que `required` y `invalid_format` se distingan en `birthDateSchema`, el error se define como función: `{ error: (iss) => iss.input === undefined ? 'required' : 'invalid_format' }`.

Se exportan también los tipos inferidos: `RegisterRequest`, `LoginRequest`, `AuthResponse`, etc.

### 6.3 Formato único de error

Todas las respuestas de error de la API tienen esta forma:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Request validation failed",
    "fields": [{ "path": "password", "issue": "too_short" }]
  }
}
```

- `code`: obligatorio, uno de `ERROR_CODES`. Es lo **único** que la web usa para elegir el texto.
- `message`: opcional, en inglés, para desarrolladores. Nunca se muestra al usuario ni contiene datos personales.
- `fields`: solo con `VALIDATION_FAILED`. `path` son las claves unidas por `.`; `issue` es uno de `FIELD_ISSUES`.

```ts
export const ERROR_CODES = [
  'VALIDATION_FAILED',      // 400
  'MALFORMED_REQUEST',      // 400  JSON ilegible, cuerpo demasiado grande
  'UNAUTHENTICATED',        // 401  sin sesión, sesión inválida o caducada
  'INVALID_CREDENTIALS',    // 401  login: correo o contraseña incorrectos (indistinguibles)
  'PASSWORD_INCORRECT',     // 403  borrado de cuenta con contraseña errónea (la sesión sigue válida)
  'FORBIDDEN',              // 403  falta la clave interna o no es válida
  'NOT_FOUND',              // 404
  'EMAIL_TAKEN',            // 409
  'TERMS_VERSION_OUTDATED', // 409
  'UNDERAGE',               // 422
  'RATE_LIMITED',           // 429  con cabecera Retry-After
  'INTERNAL_ERROR',         // 500
  'OUTCOME_UNKNOWN',        // 503  se perdió la conexión con la BD durante una escritura: pudo hacerse o no
] as const;

export const FIELD_ISSUES = [
  'required', 'invalid_format', 'too_short', 'too_long', 'too_old', 'in_future', 'unrecognized', 'invalid',
] as const;
```

**`OUTCOME_UNKNOWN` en la API** (503): en una petición que no es GET, la API perdió la conexión con PostgreSQL (o dejó de responder) con una sentencia ya enviada, así que no sabe si se hizo. Es el caso de un COMMIT del registro, o del DELETE con autocommit del borrado, cuya respuesta no llega. Lo decide `isConnectionLost` (`database/pg-errors.ts`) en `ApiExceptionFilter`:

- Sí es incierto: `query_timeout` del cliente («Query read timeout»), «Connection terminated…», `ECONNRESET`, `EPIPE`, `ETIMEDOUT`, los códigos `57P01` y `57P02` y la clase `08` (`08xxx`). También dentro de un `DrizzleQueryError`.
- No es incierto, y sigue en 500 `INTERNAL_ERROR`:
  - los errores normales de la base de datos (unicidad, sintaxis…);
  - un `statement_timeout` (`57014`), porque lo cancela el servidor y deshace la transacción;
  - **cualquier error de la adquisición del cliente**, porque no se llegó a enviar nada: no conseguir conexión a tiempo, un rechazo al conectar (`ECONNREFUSED`, DNS), o un `57P01`, `57P03` o `08xxx` en el saludo. El pool de `createPool` envuelve su `connect` y marca esos errores (`markNotSent`), tanto en `Transactions.run` como en la conexión que abre el pool para un `query` suelto, así que la fase sí se distingue;
  - `57P03` (cannot_connect_now) en cualquier caso, porque solo ocurre al conectar;
  - `25P03` (idle in transaction) y un cliente que ya no admite consultas («is not queryable»): el servidor ya cerró la sesión y deshizo, y la sentencia no salió.
- En un GET se responde siempre 500: una lectura no cambia nada.
- Un `57P01` con el cliente ya conectado (PostgreSQL apagándose a mitad de una sentencia) sigue siendo incierto: no se puede saber si un COMMIT en marcha llegó a confirmarse. Es lo prudente.

La web añade un código propio que la API nunca emite (`WEB_ERROR_CODES` en `messages.ts`), y usa además `OUTCOME_UNKNOWN` en un segundo caso:

- `API_UNAVAILABLE`: la petición no llegó a la API (conexión rechazada), o la API respondió un 5xx sin cuerpo válido. Sabemos que no se hizo nada. Es también lo que dan las lecturas, `login` y `logout` ante cualquier fallo de red o tiempo agotado.
- `OUTCOME_UNKNOWN` (HTTP 503 en la acción): lo emite la API (arriba), o lo genera la web cuando una escritura no idempotente (registro, borrado de la cuenta) se envió y no llegó respuesta. No sabemos si se hizo. En `/entrar` y al cerrar sesión, `messages.ts` lo traduce a su texto de servidor (UX, criterio 65). La web muestra `registro.error.resultado_incierto` o `eliminar.error.resultado_incierto` con su enlace de comprobación (UX §3.2, §3.5 y criterios 60 a 65), y nunca un texto que afirme que no se hizo nada.

`apps/web/src/lib/errors/messages.ts` es un `Record<ErrorCode | WebErrorCode, string>` y un mapa `(campo, issue) → texto`, en español. Un test comprueba que cubre **todos** los códigos. Los textos son los de la tabla de [UX §5](h0-diseno-ux.md#5-textos-de-interfaz), palabra por palabra (acuerdo A12).

---

## 7. API

### 7.1 Endpoints

Todos devuelven y reciben JSON. Los marcados con **S** exigen sesión (`Authorization: Bearer <token>`). Todos excepto `/health` exigen `X-Internal-Api-Key`.

| Método y ruta | S | Entrada | Éxito | Errores |
|---|---|---|---|---|
| `POST /auth/register` | — | `RegisterRequest` | `201 AuthResponse` | 400 `VALIDATION_FAILED` (incluido `birthDate: in_future`), 409 `EMAIL_TAKEN`, 409 `TERMS_VERSION_OUTDATED`, 422 `UNDERAGE`, 429 `RATE_LIMITED` |
| `POST /auth/login` | — | `LoginRequest` | `200 AuthResponse` | 400, 401 `INVALID_CREDENTIALS`, 429 |
| `POST /auth/logout` | S | — | `204` | 401 `UNAUTHENTICATED` |
| `GET /auth/session` | S | — | `200 SessionResponse` (renueva si toca) | 401 |
| `GET /users/me` | S | — | `200 AccountResponse` | 401 |
| `POST /users/me/deletion` | S | `DeleteAccountRequest` | `204` | 400, 401, 403 `PASSWORD_INCORRECT`, 429 |
| `GET /health` | — | — | `200 { "status": "ok" }` tras un `SELECT 1` | 503 si la base de datos no responde |

Comunes a todos: 403 `FORBIDDEN` sin clave interna, 404 `NOT_FOUND`, 400 `MALFORMED_REQUEST` y 500 `INTERNAL_ERROR`.

El borrado es `POST .../deletion`, y no `DELETE` con cuerpo, porque la semántica de un cuerpo en `DELETE` no está definida.

### 7.2 Módulos y responsabilidades

| Módulo | Contiene | Depende de |
|---|---|---|
| `DatabaseModule` (global) | Proveedor `DB` (`NodePgDatabase<typeof schema>`) creado con un `pg.Pool` desde `DATABASE_URL` (ver «Límites de tiempo de la base de datos», abajo), y `Transactions` («Transacciones», abajo). Cierra el pool en `onApplicationShutdown`. Exporta los tipos `Database` y `Tx` | `ConfigService` |
| `UsersModule` | `UsersService`: `create(tx, data)`, `findCredentialsByEmail`, `getAccount(userId)`, `deleteAccount(userId, password)`, `updatePasswordHash`. `PasswordService`: argon2id. Las credenciales son columnas de `users`, y por eso el hash vive aquí. `UsersController` | `DatabaseModule`, `ConsentsModule` (para `getAccount`) |
| `ConsentsModule` | `ConsentsService`: `grant(tx, userId, purpose, version)`, `listForUser(userId)`, `revoke(tx, userId, purpose)` (sin endpoint en H0, pero con test) | `DatabaseModule` |
| `AuthModule` | `AuthService` (registro, login, logout), `SessionsService` (crear, validar/renovar, revocar), `SessionGuard` registrado como `APP_GUARD`, `AuthController` | `UsersModule`, `ConsentsModule` |
| `HealthModule` | `HealthController` | `DatabaseModule` |
| `AppModule` | Importa todos, `ConfigModule.forRoot`, `ThrottlerModule.forRoot`. Registra los guards globales en este orden: `InternalKeyGuard` → `AppThrottlerGuard` → `SessionGuard`. El log de peticiones no está aquí: es un middleware que registra `configureApp` (§7.4) | — |

**Límites de tiempo de la base de datos.** Ninguna espera es infinita: si PostgreSQL se cuelga o una consulta se alarga, la API responde con un error antes de que la web agote sus 5 s (§8.4). Por eso los dos primeros límites no pueden pasar de 4000 ms: con el margen de `query_timeout`, la espera más larga de una consulta es de 4,5 s.

| Límite | Opción de `pg` | Variable (valor por defecto) | Qué pasa al superarlo |
|---|---|---|---|
| Conseguir una conexión (conectar o esperar un hueco en el pool) | `connectionTimeoutMillis` | `DB_CONNECTION_TIMEOUT_MS` (3000; máximo 4000) | La consulta falla en la API: 500, o 503 en `/health` |
| Duración de una sentencia | `statement_timeout` (se envía al servidor al conectar) | `DB_STATEMENT_TIMEOUT_MS` (4000; máximo 4000) | PostgreSQL la cancela (`57014`) y deshace la transacción |
| Respuesta del servidor a una consulta sobre una conexión ya abierta | `query_timeout` (en el cliente) | Derivado, sin variable propia: `DB_STATEMENT_TIMEOUT_MS` + 500 (4500 como mucho) | pg rechaza la consulta: 500, o 503 en `/health`. Cubre un PostgreSQL congelado o una red que descarta paquetes sin cerrar la conexión, que el servidor no puede avisar (BUG-QA-8). PostgreSQL podría seguir ejecutándola hasta su `statement_timeout` |
| Transacción abierta sin actividad | `idle_in_transaction_session_timeout` (ídem) | `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS` (10000) | PostgreSQL cierra la sesión y deshace la transacción |

El pool escucha su evento `error`: si un cliente inactivo pierde la conexión (por ejemplo, porque PostgreSQL se reinicia), el proceso no cae, y el `Logger` de Nest registra solo `{ event: 'pg_pool_error', code }`. El mensaje no se registra porque puede llevar la cadena de conexión (§8.9).

**Los límites son por operación, no por petición.** Una petición que hace varias consultas, o que espera conexión y después consulta, puede tardar en el peor caso más que los 5 s de la web. Entonces la web aborta y muestra «resultado incierto» en el registro y el borrado, o su error de servidor en lo demás. Es intencionado: cada límite corta una espera concreta y ninguna es infinita, y la web no afirma un resultado que no conoce. `idle_in_transaction_session_timeout` se queda en 10 s porque argon2 se calcula fuera de la transacción del registro: dentro solo hay tres INSERT.

**Transacciones.** Las orquesta el servicio que coordina; los demás reciben el `tx`. Los métodos de escritura aceptan `db: Database | Tx` como primer argumento.
- La transacción se abre con `Transactions.run(async (tx) => ...)` (`database/transactions.ts`, inyectable), **nunca** con `db.transaction` de Drizzle. En Drizzle 0.45.4, `transaction()` ejecuta BEGIN fuera del `try`: si falla, no libera el cliente y el pool se agota. Además devuelve al pool clientes rotos y deja que un fallo del ROLLBACK tape el error original.
- Una regla de ESLint (`no-restricted-syntax` en `apps/api`) impide volver a usar `.transaction(`.
- `Transactions.run`:
  - obtiene un cliente con `pool.connect()` y crea `drizzle(client, { schema })` como `tx`; `Tx` es `Database`;
  - ejecuta BEGIN, `fn` y COMMIT dentro de un `try`;
  - con un error normal (por ejemplo, de unicidad) hace ROLLBACK y devuelve el cliente con `release()`;
  - si `isConnectionLost(error)`, no intenta el ROLLBACK, que esperaría en vano a un servidor mudo, y descarta el cliente con `release(error)`; PostgreSQL deshace la transacción al ver la conexión cerrada;
  - si el ROLLBACK falla, también descarta el cliente;
  - el error que sale es siempre el original.
- **Clientes prestados** (`withPoolClient`, en el mismo archivo; es el único sitio de `src` que llama a `pool.connect()`). El listener `error` del pool solo cubre los clientes libres. Mientras un cliente está prestado, `withPoolClient` le pone su propio listener: si PostgreSQL cierra la sesión entre dos sentencias (reinicio, `pg_terminate_backend`, 25P03), `pg` emite `error` en el cliente y sin listener la API moriría con una excepción no capturada (BUG-QA-9). El listener registra solo `{ event: 'pg_client_error', code }`, marca el cliente como roto (sin ROLLBACK) y se quita con `client.off` antes del `release(error)`, que lo descarta.

`Clock` es un proveedor (`now(): Date`) que se sustituye en los tests. Toda comparación con «ahora» (edad, caducidad, `granted_at`) usa `Clock`, nunca `new Date()` directamente.

### 7.3 Guard de sesión

`SessionGuard` es global: **todo exige sesión salvo lo marcado con `@Public()`**, que son `register`, `login` y `health`.

1. Lee `Authorization`. Si no es `Bearer <43 caracteres base64url>`, responde 401 `UNAUTHENTICATED`.
2. Calcula `tokenHash = sha256hex(token)` y llama a `SessionsService.validate(tokenHash)` (§8.2).
3. Si es válida, guarda `{ userId, tokenHash, expiresAt, renewed }` en `request.session`; el decorador `@CurrentSession()` lo lee.

### 7.4 Validación con Zod

- En `configureApp(app)` se registra un pipe global: `app.useGlobalPipes(new StandardSchemaValidationPipe({ exceptionFactory }))`. Solo valida los parámetros que declaran esquema, así que registrarlo de forma global es seguro ([documentación](https://docs.nestjs.com/techniques/validation)).
- En el controlador: `@Body({ schema: registerRequestSchema }) body: RegisterRequest`. Con `transform: true` (el valor por defecto) el controlador recibe la **salida** del esquema, con el correo ya normalizado (comprobado).
- `exceptionFactory(issues)` construye un `ApiException('VALIDATION_FAILED', 400, fields)`. `path` sale de unir `issue.path` (cada elemento puede ser una clave o `{ key }`) e `issue` del `message`, que es un `FieldIssue`, o `'invalid'` si no lo es.
- `ApiExceptionFilter` (`@Catch()` global) traduce a la forma de §6.3:
  - `ApiException` → tal cual.
  - `ThrottlerException` → 429 `RATE_LIMITED`, conservando `Retry-After`.
  - `NotFoundException` → 404 `NOT_FOUND`.
  - Errores del *body parser* (JSON ilegible o demasiado grande) → 400 `MALFORMED_REQUEST`.
  - Todo lo demás → 500 `INTERNAL_ERROR`. Se registra con las reglas de §8.9.
- `configureApp` registra **lo primero** el middleware de log de peticiones (§8.9), antes de los *parsers* del cuerpo y de los guards, para que también queden registradas las respuestas que estos cortan (400, 401, 403, 429).
- `configureApp` fija además: un cuerpo JSON de 16 kB como máximo (`app.useBodyParser('json', { limit: '16kb' })`), `x-powered-by` desactivado y `app.enableShutdownHooks()`. **`main.ts` y los tests llaman a la misma `configureApp`**, para que lo probado sea lo que se ejecuta.

### 7.5 Configuración por variables de entorno

`ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validationSchema: envSchema })`. El `.env` lo carga Node (`--env-file`) o Vitest, nunca `@nestjs/config`, para que los tests no hereden el `.env` de desarrollo. Si una variable no es válida, la API **no arranca**, y el error dice qué variable falla sin mostrar su valor.

```ts
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  // Límites de PostgreSQL en ms (§7.2). Máximo 4000: la API responde antes de los 5 s de la web
  // (el query_timeout del cliente es DB_STATEMENT_TIMEOUT_MS + 500).
  DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1).max(4000).default(3000),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1).max(4000).default(4000),
  DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: z.coerce.number().int().min(1).max(600_000).default(10_000),
  INTERNAL_API_KEY: z.string().min(32),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  RATE_LIMIT_FACTOR: z.coerce.number().int().min(1).max(1000).default(1),
  LOG_FORMAT: z.enum(['pretty', 'json']).default('pretty'),
});
```

Se llaman `API_HOST`/`API_PORT`, y no `HOST`/`PORT`, porque `adapter-node` lee `HOST` y `PORT` para la web, y comparten `.env`.

---

## 8. Sesión y seguridad

### 8.1 Contraseñas

- Biblioteca `argon2` 0.45.2. Frente a `@node-rs/argon2`, es la de referencia en Node y trae binarios precompilados.
- Parámetros explícitos: `type: argon2id`, `memoryCost: 65536` (64 MiB), `timeCost: 3`, `parallelism: 4`. Son los valores por defecto de la biblioteca y superan el mínimo de OWASP. Se escriben en el código para que no cambien sin que nadie se entere.
- Antes de hashear y de verificar: `password.normalize('NFKC')`.
- Al hacer login con éxito, si `argon2.needsRehash(hash, params)` es verdadero, se rehace el hash y se actualiza `updated_at`.
- `PasswordService.verifyDummy(password)` verifica contra un hash ficticio calculado al arrancar. Se usa cuando el correo no existe, para igualar el tiempo de respuesta.

### 8.2 Token de sesión

- Generación: `crypto.randomBytes(32).toString('base64url')`, 256 bits y 43 caracteres.
- Almacenamiento: `token_hash = sha256(token)` en hexadecimal. El token en claro solo existe en la respuesta de `register`/`login` (de la API al servidor de SvelteKit) y en la cookie del navegador.
- Duración: `SESSION_TTL_DAYS` (30) **deslizante**. `SessionsService.validate`:
  - Si no existe → 401.
  - Si `expires_at <= now` → borra la fila y responde 401.
  - Si falta menos de la mitad de `SESSION_TTL_DAYS` (15 días con el valor por defecto) → `expires_at = now + SESSION_TTL_DAYS` y `renewed = true`.
  - Como mucho, una escritura por sesión cada medio TTL, también si el TTL se configura más corto.
- Al hacer login se borran también las sesiones caducadas de ese usuario. No hay tarea programada en H0.
- Salir: `DELETE FROM sessions WHERE token_hash = $1`. La revocación es inmediata porque cada petición consulta la tabla.
- Cada login crea un token nuevo, así que no hay fijación de sesión.

### 8.3 Cookie (la pone y la quita solo SvelteKit)

```ts
cookies.set('cupidilla_session', token, {
  path: '/', httpOnly: true, secure: !dev, sameSite: 'lax', expires: new Date(expiresAt),
});
```

- `dev` viene de `$app/env`. En `vite dev` la cookie no es `Secure`; en `vite preview` y en producción, sí. Los navegadores aceptan cookies `Secure` en `http://localhost`, y por eso **los e2e usan `localhost`, no `127.0.0.1`**.
- `sameSite: 'lax'` y no `strict`: con `strict`, quien llegue desde un enlace externo aparecería sin sesión.
- El prefijo `__Host-` queda como endurecimiento antes de la beta (R8).
- La API nunca pone cookies.

### 8.4 Cómo viaja la sesión de SvelteKit a la API

```mermaid
sequenceDiagram
  participant B as Navegador
  participant W as SvelteKit (servidor)
  participant A as API NestJS
  participant D as PostgreSQL
  B->>W: GET /cuenta (cookie cupidilla_session)
  W->>A: GET /auth/session<br/>Authorization: Bearer token<br/>X-Internal-Api-Key, X-Client-Ip
  A->>D: SELECT sesión + usuario por sha256(token)
  D-->>A: fila (o nada)
  A-->>W: 200 {user, session:{expiresAt, renewed}} | 401
  W->>W: locals.user; si renewed, reescribe la cookie; si 401, borra la cookie
  W->>A: GET /users/me (Bearer)
  A-->>W: 200 AccountResponse
  W-->>B: HTML de /cuenta (Cache-Control: private, no-store)
```

`hooks.server.ts` encadena tres pasos con `sequence`:

1. **`authenticate`**: si hay cookie, llama a `GET /auth/session` y rellena `event.locals.user` (`{ id, email }`) y `event.locals.sessionToken`. Con 401, borra la cookie y deja `user = null`. Con `API_UNAVAILABLE`, deja `user = null` sin borrar la cookie, y las páginas privadas muestran el error.
2. **`guardRoutes`**:
   - Si `route.id` empieza por `/(privado)` y no hay usuario → `redirect(303, '/entrar?siguiente=' + safeReturnPath(url.pathname))`. Lo mismo cuando una acción de una ruta privada recibe 401 de la API (sesión caducada): `redirect(303, '/entrar?siguiente=/cuenta')`.
   - Si empieza por `/(invitado)` y hay usuario → `redirect(303, '/cuenta')`.
   - Se decide por `route.id` y nunca por `url.pathname` (recomendación de la [documentación de auth](https://svelte.dev/docs/kit/auth)).
   - `siguiente` (acuerdo A6): `#lib/server/return-path.ts` exporta la lista cerrada `RETURN_PATHS` (`/cuenta`, `/cuenta/eliminar`) y `safeReturnPath(valor)`, que devuelve el valor solo si coincide exactamente con una entrada y `/cuenta` en cualquier otro caso (`https://…`, `//…`, rutas desconocidas). `/entrar` lo lleva en un campo oculto y la acción lo vuelve a pasar por `safeReturnPath`. Así no hay redirecciones abiertas.
3. **`securityHeaders`** (§8.7).

Todas las llamadas pasan por `#lib/server/api-client.ts`:

- Usa `fetch` global, con `AbortSignal.timeout(5000)`. Los límites de la base de datos (§7.2) son menores, para que la API conteste antes de que la web aborte: `DB_CONNECTION_TIMEOUT_MS` y `DB_STATEMENT_TIMEOUT_MS` valen como mucho 4000 ms, y el `query_timeout` del cliente de pg, que cubre un PostgreSQL que deja de responder sin cerrar la conexión, es 500 ms más (4500 como mucho).
- Añade `X-Internal-Api-Key`, `X-Client-Ip: event.getClientAddress()` y, si procede, `Authorization`.
- Valida la respuesta con el esquema de `contracts`.
- Devuelve `{ ok: true, data } | { ok: false, status, error: ApiError }`.
- Un 503 `OUTCOME_UNKNOWN` de la API (§6.3) se devuelve tal cual, en cualquier petición. En el registro y el borrado se muestra «resultado incierto»; en `login` y `logout`, el texto de servidor.
- **Nunca reintenta.** Si `fetch` falla, distingue por la causa (§6.3):
  - Antes de enviar (`error.cause.code` en `ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `EHOSTUNREACH`, `ENETUNREACH`, `EADDRNOTAVAIL` o `UND_ERR_CONNECT_TIMEOUT`, también dentro de un `AggregateError`) → `API_UNAVAILABLE`.
  - Cualquier otro fallo (tiempo agotado `TimeoutError`, conexión cortada tras enviar: `ECONNRESET`, `UND_ERR_SOCKET` «other side closed»…) → `OUTCOME_UNKNOWN`, **solo** si la petición lleva la opción `nonIdempotent`, que activan `register` y `deleteAccount`. En las demás (`login`, `logout`, los GET) sigue siendo `API_UNAVAILABLE`.
  - Un 2xx cuyo cuerpo no se puede leer (cortado a mitad) o no cumple el esquema → `OUTCOME_UNKNOWN` en las peticiones `nonIdempotent`: la API ha confirmado la operación, pero sin el cuerpo no hay token y no se puede iniciar la sesión, así que lo correcto es pedir que se compruebe. En las demás, `API_UNAVAILABLE` (502).
  - Limitaciones aceptadas: un tiempo agotado se trata como incierto aunque la conexión no llegara a establecerse (la API colgada en el `connect`), y una conexión *keep-alive* que el servidor cerró justo antes de reutilizarla también. En los dos casos el texto pide comprobar, lo que es prudente, aunque nada se hiciera.
- Las páginas de registro y de eliminación muestran el enlace de comprobación dentro del bloque de error general (`ErrorSummary`, prop `generalLink`). El de `/cuenta` lleva `data-sveltekit-reload`: así no se usan datos de `/cuenta` precargados (`data-sveltekit-preload-data="hover"`) antes de que terminara el borrado.

El token **nunca** se devuelve en `data` de un `load`, ni en `form` de una acción.

### 8.5 Flujo de registro

```mermaid
sequenceDiagram
  participant B as Navegador
  participant W as SvelteKit /registro (acción)
  participant A as API /auth/register
  participant D as PostgreSQL
  B->>W: POST formulario (correo, contrasena, dia, mes, anio, condiciones, version_condiciones)
  W->>W: fecha por partes → checkBirthDate(hoy Madrid) → registerRequestSchema.safeParse
  alt menor
    W-->>B: fail(422, {underage: true}) sin valores y sin llamar a la API
  else inválido
    W-->>B: fail(400, {values, errors}) sin llamar a la API
  else válido
    W->>A: POST JSON
    A->>A: valida esquema → checkBirthDate → versión vigente
    alt menor o fecha futura
      A-->>W: 422 UNDERAGE / 400 (sin tocar la BD)
    else
      A->>A: hash argon2id (fuera de la transacción)
      A->>D: BEGIN; INSERT users; INSERT consents; INSERT sessions; COMMIT
      A-->>W: 201 {user, session:{token, expiresAt}} (o 409 EMAIL_TAKEN)
      W->>W: cookies.set(...)
      W-->>B: 303 → /cuenta
    end
  end
```

- Orden en la acción (acuerdos A2 a A5):
  1. `parseBirthDateParts(dia, mes, anio)` valida las tres partes y compone la fecha.
  2. Si componen una fecha real y `checkBirthDate` dice `UNDERAGE` → `fail(422, { underage: true })`, **sin ningún valor**, y la página pinta la pantalla de menor de edad, aunque haya otros campos mal.
  3. El resto de errores, incluidos los de la fecha y `IN_FUTURE`, se devuelven juntos con `fail(400, { values, errors })`.
- `values` lleva el correo, el día, el mes, el año y el estado de la casilla tal como se escribieron. **Nunca la contraseña.**
- Si la API responde 422 `UNDERAGE` (por ejemplo, relojes distintos entre web y API), se trata igual que el paso 2. Con `TERMS_VERSION_OUTDATED`, el formulario vuelve con la casilla desmarcada (acuerdo A11).
- Los `name` del formulario van en español (acuerdo A1): `correo`, `contrasena`, `dia`, `mes`, `anio`, `condiciones` (casilla; `value="on"` → `acceptTerms: true`) y `version_condiciones` (campo oculto con `SERVICE_TERMS_VERSION` → `termsVersion`). `#lib/forms/` hace la conversión al contrato.

Login: la acción de `/entrar` valida con `loginRequestSchema`, llama a `POST /auth/login`, pone la cookie y redirige con 303 a `safeReturnPath(siguiente)`, que por defecto es `/cuenta`. Un campo vacío da error por campo; un correo con formato inválido **no** llama a la API y se muestra como `INVALID_CREDENTIALS` (acuerdo A10). La API busca por correo:

- Si no existe → `verifyDummy` y 401 `INVALID_CREDENTIALS`.
- Si existe y la contraseña no coincide → 401 `INVALID_CREDENTIALS`.
- Si es correcta → rehash si toca, crea sesión, 200.

Salir: `<form method="POST" action="/cuenta?/salir">`, solo en `/cuenta` (acuerdo A8). La acción `salir` llama a `POST /auth/logout`. Con 204 o 401 borra la cookie, pone `locals.user = null` y redirige con 303 a `/?aviso=sesion-cerrada` (acuerdo A7). Si la API no responde o da 5xx, **no** borra la cookie y devuelve `fail(503)` con `cuenta.error.servidor` (acuerdo A14).

### 8.6 CSRF y CSP

- **CSRF**: la protección de SvelteKit 3 está **siempre activa**. Comprueba el `Origin` de los envíos de formulario en producción y en `preview`, no en `vite dev`. A esto se suma `SameSite=Lax`. `csrf.trustedOrigins` se deja vacío. En producción hará falta `ORIGIN`, o `paths.origin`, si hay un proxy delante. Un e2e lo demuestra (§12).
- **CSP**, en `vite.config.ts`, dentro de `sveltekit({ csp })`, con `mode: 'auto'` (nonces en páginas dinámicas):

```ts
csp: {
  mode: 'auto',
  directives: {
    'default-src': ['self'], 'script-src': ['self'], 'style-src': ['self', 'unsafe-inline'],
    'img-src': ['self', 'data:'], 'font-src': ['self'], 'connect-src': ['self'],
    'form-action': ['self'], 'frame-ancestors': ['none'], 'base-uri': ['self'], 'object-src': ['none'],
  },
},
```

`'unsafe-inline'` solo en `style-src`, por los atributos `style` que pueda usar el diseño. El riesgo es bajo, y `script-src` sigue estricto. Comprobación pendiente: R6.

### 8.7 Cabeceras de seguridad

En `securityHeaders` (`hooks.server.ts`), en todas las respuestas:

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Frame-Options: DENY`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Cross-Origin-Opener-Policy: same-origin`

Si hay `locals.user`, además `Cache-Control: private, no-store`, para que «atrás» no muestre la cuenta después de salir.

HSTS se pone en el proxy de producción. La API no necesita `helmet`: no la visita ningún navegador.

### 8.8 Límite de intentos y enumeración

Se usa `@nestjs/throttler` con almacenamiento **en memoria**: sirve para una sola instancia y se reinicia al reiniciar la API (R5). Redis llegará cuando se necesite.

`AppThrottlerGuard` extiende `ThrottlerGuard` y usa dos conjuntos con nombre:

- `ip`: el *tracker* es `X-Client-Ip`, que solo se acepta porque la petición ya pasó la clave interna. Si falta, `req.ip`.
- `account`: el *tracker* es el correo normalizado del cuerpo, si viene. Si no, `sha256(Bearer)`.

| Ruta | Límite (multiplicado por `RATE_LIMIT_FACTOR`) |
|---|---|
| `POST /auth/register` | 5 por IP y hora |
| `POST /auth/login` | 10 por IP cada 15 min **y** 5 por correo cada 15 min (bloqueo de 15 min) |
| `POST /users/me/deletion` | 5 por sesión cada 15 min |
| Resto | 120 por IP y minuto |

Con el límite superado: 429 `RATE_LIMITED` con `Retry-After`. Se cuentan todos los intentos, salgan bien o mal; para H0 es aceptable. El throttler va antes del `SessionGuard`, y por eso el *tracker* del borrado es el hash del token y no el `userId`.

Enumeración de cuentas:

- **Login**: misma respuesta (401 `INVALID_CREDENTIALS`, mismo cuerpo) para un correo inexistente y para una contraseña errónea, con un tiempo parecido gracias a `verifyDummy`.
- **Registro**: responde 409 `EMAIL_TAKEN` (matiz de §1). Se hace el hash antes de la transacción, así que el tiempo es similar exista o no el correo; la diferencia la da el código, que es aceptado.
- **Borrado**: 403 `PASSWORD_INCORRECT`. Solo puede intentarlo quien ya tiene la sesión.

### 8.9 Qué NO se registra en los logs

- Nunca: contraseñas, hashes, tokens o sus hashes, cabeceras `Authorization`/`Cookie`/`X-Internal-Api-Key`, cuerpos de petición o de respuesta, fechas de nacimiento, correos, IP ni identificadores de usuario.
- **Log de peticiones** de la API (middleware `requestLoggingMiddleware`, registrado el primero en `configureApp`, que escribe al terminar la respuesta): `{ method, route, status, ms }`, donde `route` es el patrón de la ruta que coincidió (`request.route.path`) y no la URL con su *query*. Si no coincidió ninguna (404, o cuerpo ilegible que corta el *parser* antes del enrutado), `route` es `'(sin ruta)'`. Al ser un middleware, y no un interceptor, registra también las respuestas de los guards (401, 403, 429).
- **Errores**:
  - `DrizzleQueryError` → solo `{ name, code: cause.code, constraint: cause.constraint }`. Su `message` y su `stack` contienen los parámetros.
  - Errores del *body parser* → solo `{ name, type }`. Su mensaje puede incluir un trozo del cuerpo.
  - Los demás → `name`, `message` y `stack`, escritos por nuestro propio código sin datos personales.
- Formato: `ConsoleLogger` de Nest con `json: true` si `LOG_FORMAT=json`.
- **Web**: `handleError` registra solo `{ status, routeId, name, message }`. Nunca `event.request`, `FormData` ni `locals`.
- Hay un test que lo comprueba (§12, I-21).

---

## 9. Regla de mayoría de edad

Vive en `packages/contracts/src/age.ts`. La web la usa para avisar sin llamar a la API; la API la aplica con autoridad.

```ts
/** Fecha civil 'YYYY-MM-DD' de un instante en una zona horaria (Intl.DateTimeFormat#formatToParts). */
export function calendarDateIn(timeZone: string, instant: Date): string;

/** «Hoy» de referencia para la regla de edad. */
export function referenceToday(instant: Date): string; // = calendarDateIn(REFERENCE_TIME_ZONE, instant)

/** Años cumplidos en `today`. Ambas fechas 'YYYY-MM-DD' ya validadas. */
export function ageOn(birthDate: string, today: string): number;

export function isAdultOn(birthDate: string, today: string): boolean; // ageOn(...) >= MIN_AGE

export type BirthDateCheck = { ok: true } | { ok: false; reason: 'IN_FUTURE' | 'UNDERAGE' };
export function checkBirthDate(birthDate: string, today: string): BirthDateCheck;

/** Fecha de nacimiento más reciente que es mayor de edad en `today` (útil para la interfaz y los tests). */
export function latestAdultBirthDate(today: string): string;
```

**Cálculo exacto.** `ageOn` trabaja con los enteros año, mes y día, sin `Date` ni milisegundos:

```
díaEfectivo = (mesNac = 2 y díaNac = 29 y no esBisiesto(añoHoy)) ? 28 : díaNac
edad = añoHoy − añoNac − ((mesHoy, díaHoy) < (mesNac, díaEfectivo) ? 1 : 0)
```

**Zona de referencia.** «Hoy» es la fecha civil en **Europe/Madrid** del instante que da `Clock.now()`, calculada con `Intl` (Node 24 trae ICU completo; comprobado: `2026-11-10T23:30Z` → `2026-11-11`). El servidor corre en UTC, y quien se registra está en España.

**Casos límite.**

| Caso | Resultado |
|---|---|
| Cumple 18 hoy (hora de Madrid) | Mayor de edad. El artículo 315 del Código Civil incluye completo el día del nacimiento |
| Cumple 18 mañana | `UNDERAGE` |
| Nacido el 29 de febrero, año no bisiesto | Cumple el **28 de febrero**: si no hay día equivalente, el plazo vence el último día del mes (artículo 5.1 del Código Civil). Con nacimiento el 2008-02-29: el 2026-02-28 es mayor de edad; el 2026-02-27, no. **Por confirmar jurídicamente** |
| Entre las 00:00 y las 01:00/02:00 de Madrid (todavía es «ayer» en UTC) | Cuenta la fecha de Madrid |
| Canarias (una hora menos) | Entre las 23:00 y las 24:00 de Canarias del día anterior al cumpleaños se admite el registro una hora antes. Se acepta |
| Fecha imposible (`2007-02-29`, `2026-02-30`, `2026-13-01`) o en otro formato | 400 `VALIDATION_FAILED`, `invalid_format` (`z.iso.date`) |
| Anterior a 1900-01-01 | 400, `too_old` |
| Futura (`> hoy`) | 400, `in_future`. Se comprueba antes que la edad |

**Qué hace la API con un menor.** Comprueba la fecha **antes de cualquier consulta** a la base de datos. Responde 422 `UNDERAGE` sin escribir nada y sin registrar la fecha. En la web, la acción no devuelve **ningún** valor en `fail()` (acuerdo A4).

---

## 10. Eliminación de la cuenta

Secuencia exacta:

1. `/cuenta/eliminar` muestra un formulario con la contraseña y nada más: no hay casilla de confirmación (acuerdo A9).
2. La acción valida `deleteAccountRequestSchema` y llama a `POST /users/me/deletion` con `Bearer`.
3. La API pasa la clave interna, el throttler (`account` = hash del token) y el `SessionGuard`.
4. `UsersService.deleteAccount(userId, password)`:
   1. `SELECT password_hash FROM users WHERE id = $1`. Si no hay fila, 401.
   2. Verifica con argon2id (con NFKC). Si falla, 403 `PASSWORD_INCORRECT`; la sesión sigue válida y no se borra nada.
   3. `DELETE FROM users WHERE id = $1`. Es **una sola sentencia y atómica**: `ON DELETE CASCADE` borra en la misma operación **todas** las sesiones del usuario (también las de otros dispositivos) y todos sus consentimientos.
   4. Registra el evento `account_deleted`, **sin** ningún identificador.
5. La API responde 204.
6. La web borra la cookie, pone `locals.user = null` y hace `redirect(303, '/?aviso=cuenta-eliminada')`. La portada muestra el aviso de cuenta eliminada.

**Qué queda en la base de datos: nada.** No quedan filas en `users`, `sessions` ni `consents` con ese `user_id`, ni el correo en ninguna tabla. El correo queda libre para un registro nuevo. Un test lo demuestra recorriendo **todas** las tablas que tienen una FK hacia `users`, consultadas en `information_schema`, para que la comprobación siga valiendo cuando H1 añada tablas.

**Por revisar jurídicamente**: si conviene conservar una prueba del consentimiento después del borrado (por ejemplo una fila anonimizada con versión y fecha), y cómo afectan las copias de seguridad de producción. Se decidirá en la revisión jurídica; H0 no guarda nada.

---

## 11. Entorno local

### 11.1 `docker-compose.yml`

```yaml
name: cupidilla
services:
  db:
    image: postgres:18.6-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-cupidilla}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Define POSTGRES_PASSWORD en .env}
      POSTGRES_DB: ${POSTGRES_DB:-cupidilla}
      TZ: UTC
    ports:
      - "127.0.0.1:${POSTGRES_PORT:-5432}:5432"
    volumes:
      - pgdata:/var/lib/postgresql
      - ./docker/postgres/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 2s
      timeout: 3s
      retries: 30
      start_period: 5s
volumes:
  pgdata:
```

- Los **datos van en un volumen con nombre** (`pgdata`), dentro del almacenamiento de Docker y no en el disco NTFS. Se monta en `/var/lib/postgresql`, la ruta de la imagen 18 (comprobado).
- La carpeta `init` del proyecto se monta **en solo lectura**. Sus `.sql` solo tienen que ser legibles, y en el disco NTFS lo son.
- El puerto queda enlazado solo a `127.0.0.1`.
- El *healthcheck* usa `-h 127.0.0.1`. Durante la inicialización, PostgreSQL arranca un servidor temporal que solo escucha por el socket; si se comprobara por el socket, el contenedor parecería sano antes de terminar los scripts de `init`.
- `docker/postgres/init/01-create-databases.sql`: `CREATE DATABASE cupidilla_test; CREATE DATABASE cupidilla_e2e;`. Se ejecuta como `POSTGRES_USER`, que queda como propietario. **Solo corre con el volumen vacío**: si se cambia, `npm run db:reset`.
- Las aplicaciones no van en contenedores en H0. Corren en el anfitrión con Node 24 (`.nvmrc`), que arranca más rápido y recarga mejor. Los `Dockerfile` llegarán con la decisión de despliegue.

### 11.2 `.env.example` (raíz; se copia a `.env`)

```sh
# PostgreSQL (docker compose)
POSTGRES_USER=cupidilla
POSTGRES_PASSWORD=cupidilla_dev
POSTGRES_DB=cupidilla
POSTGRES_PORT=5432

# API (127.0.0.1 y no localhost: Node puede resolver localhost a ::1 y Docker solo escucha en IPv4)
DATABASE_URL=postgres://cupidilla:cupidilla_dev@127.0.0.1:5432/cupidilla
# Límites de PostgreSQL en ms (§7.2); se muestran sus valores por defecto.
# Los dos primeros, 4000 como mucho (query_timeout = DB_STATEMENT_TIMEOUT_MS + 500 < 5 s de la web)
# DB_CONNECTION_TIMEOUT_MS=3000
# DB_STATEMENT_TIMEOUT_MS=4000
# DB_IDLE_IN_TRANSACTION_TIMEOUT_MS=10000
TEST_DATABASE_URL=postgres://cupidilla:cupidilla_dev@127.0.0.1:5432/cupidilla_test
E2E_DATABASE_URL=postgres://cupidilla:cupidilla_dev@127.0.0.1:5432/cupidilla_e2e
API_HOST=127.0.0.1
API_PORT=3001
# Generar con: node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
INTERNAL_API_KEY=sustituye-por-una-clave-aleatoria-de-32-o-mas-caracteres
SESSION_TTL_DAYS=30
RATE_LIMIT_FACTOR=1
LOG_FORMAT=pretty

# Web (SvelteKit)
API_URL=http://127.0.0.1:3001
```

Cómo lee cada pieza el **único `.env` de la raíz**:

| Pieza | Cómo |
|---|---|
| Compose | Lo lee solo |
| API | `node --env-file-if-exists=../../.env` y `nest start --env-file ../../.env` |
| Web | `sveltekit({ env: { dir: '../..' } })` (opción `env.dir` de SvelteKit 3). Las variables se declaran en `src/env.ts` con `defineEnvVars` (`@sveltejs/kit/env`), las dos privadas y validadas con Zod: `API_URL` (`z.url()`) e `INTERNAL_API_KEY` (`min(32)`). Se importan desde `$app/env/private` |
| Playwright | `process.loadEnvFile('../../.env')` |

### 11.3 Scripts de npm

Raíz:

| Script | Comando |
|---|---|
| `db:up` | `docker compose up -d --wait db` |
| `db:down` | `docker compose down` |
| `db:reset` | `docker compose down -v && docker compose up -d --wait db && npm run db:migrate` |
| `db:generate` | `npm run db:generate -w @cupidilla/api --` |
| `db:migrate` | `npm run db:migrate -w @cupidilla/api` |
| `build:contracts` | `npm run build -w @cupidilla/contracts` |
| `dev` | `npm run build:contracts && concurrently -k -n contracts,api,web -c blue,magenta,green "npm run dev -w @cupidilla/contracts" "npm run dev -w @cupidilla/api" "npm run dev -w @cupidilla/web"` |
| `build` | `npm run build:contracts && npm run build -w @cupidilla/api && npm run build -w @cupidilla/web` |
| `typecheck` | `npm run build:contracts && npm run typecheck --workspaces --if-present` |
| `lint` | `eslint . && prettier --check .` |
| `format` | `prettier --write .` |
| `test` | `npm run build:contracts && npm run test --workspaces --if-present` (necesita la base de datos levantada) |
| `test:e2e` | `npm run build:contracts && npm run test:e2e -w @cupidilla/web` |
| `e2e:install` | `npx playwright install chromium` (los navegadores se guardan en `~/.cache/ms-playwright`, fuera del proyecto) |

`apps/api`:

| Script | Comando |
|---|---|
| `dev` | `nest start --watch --env-file ../../.env` |
| `build` | `nest build` |
| `start` | `node --env-file-if-exists=../../.env dist/main.js` |
| `start:e2e` | `node scripts/reset-db.ts && node scripts/migrate.ts && node dist/main.js` (las variables las pone Playwright) |
| `typecheck` | `tsc -p tsconfig.json --noEmit` |
| `test` | `vitest run` (ambos proyectos) |
| `test:unit` | `vitest run --project unit` |
| `test:int` | `vitest run --project integration` |
| `db:generate` | `drizzle-kit generate` |
| `db:migrate` | `node --env-file-if-exists=../../.env scripts/migrate.ts` |

`apps/web`:

| Script | Comando |
|---|---|
| `dev` | `vite dev --port 5173 --strictPort` |
| `build` | `vite build` |
| `preview` | `vite preview --port 4173 --strictPort` |
| `prepare` | `svelte-kit sync \|\| echo ''` |
| `typecheck` | `svelte-kit sync && svelte-check --tsconfig ./tsconfig.json` |
| `test` | `vitest run` |
| `test:e2e` | `playwright test` |

Puertos: web 5173 (dev) y 4173 (preview/e2e); API 3001 (dev) y 3101 (e2e); PostgreSQL 5432.

### 11.4 «Clonar y arrancar» (para el README)

```sh
nvm use                       # Node 24 (.nvmrc)
cp .env.example .env          # y cambia INTERNAL_API_KEY por una aleatoria
npm ci
npm install-scripts ls        # debe salir vacío (todo denegado en allowScripts)
npm run db:up                 # PostgreSQL 18 en Docker, espera a que esté sano
npm run db:migrate
npm run dev                   # web en http://localhost:5173 · API en http://127.0.0.1:3001
```

Tests: con `npm run db:up` hecho, `npm test`. La primera vez, `npm run e2e:install`; después, `npm run test:e2e`.

---

## 12. Estrategia de pruebas

### 12.1 Qué se prueba en cada nivel

| Nivel | Herramienta | Qué |
|---|---|---|
| Unitario `contracts` | Vitest | Regla de edad, esquemas, normalización |
| Unitario API (`src/**/*.spec.ts`) | Vitest, sin base de datos | `PasswordService`, generación y hash del token, `exceptionFactory`, `ApiExceptionFilter` (mapeos y saneado del log), *trackers* del throttler |
| Integración API (`test/**/*.int.spec.ts`) | Vitest + Supertest + PostgreSQL real (`cupidilla_test`) | Endpoints completos con `configureApp`, base de datos real y `Clock` falso |
| Unitario web | Vitest | Cobertura de `messages.ts`; paso de `FormData` al contrato |
| Extremo a extremo | Playwright (Chromium) con la web en `preview` y la API compilada (`cupidilla_e2e`) | Los flujos del criterio de hecho, con JavaScript y sin él |

### 12.2 Aislamiento de la base de datos

- **Integración**: `apps/api/vitest.config.ts` define el proyecto `integration` con:
  - `globalSetup: ['test/global-setup.ts']`, que ejecuta `scripts/reset-db.ts` y `scripts/migrate.ts` contra `TEST_DATABASE_URL`.
  - `fileParallelism: false`.
  - `env` con `DATABASE_URL = TEST_DATABASE_URL`, `NODE_ENV=test`, una `INTERNAL_API_KEY` fija de test y `LOG_FORMAT=json`. Se leen con `loadEnv('test', '../..', '')` de Vite.
- `reset-db.ts` **se niega a ejecutarse** si el nombre de la base de datos no termina en `_test` o `_e2e`. Hace `DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;`.
- `beforeEach`: `truncateAll()` vacía, con `TRUNCATE ... RESTART IDENTITY CASCADE`, todas las tablas del esquema `public` consultadas dinámicamente. Cada archivo crea su app con `createTestApp({ now })`, que sustituye `Clock` y llama a `configureApp`. Cada test usa una `X-Client-Ip` distinta para no compartir límites, salvo en los tests de límites.
- **E2E**: base de datos propia (`cupidilla_e2e`), que se resetea y migra al arrancar la API de e2e. Los tests usan correos únicos (`e2e+<uuid>@example.com`) y pueden ir en paralelo. `RATE_LIMIT_FACTOR=100` en la API de e2e, porque todo llega desde la misma IP.
- `playwright.config.ts`:
  - `webServer` es una lista de dos servidores, ambos con `cwd: '../..'`:
    - API: `npm run build -w @cupidilla/api && npm run start:e2e -w @cupidilla/api`, con `DATABASE_URL=E2E_DATABASE_URL`, `API_PORT=3101` y `RATE_LIMIT_FACTOR=100`, y `url: http://127.0.0.1:3101/health`.
    - Web: `npm run build -w @cupidilla/web && npm run preview -w @cupidilla/web`, con `API_URL=http://127.0.0.1:3101`, y `url: http://localhost:4173`.
  - `reuseExistingServer: false`.
  - `use.baseURL: 'http://localhost:4173'`.
  - Dos proyectos: `chromium` y `chromium-sin-js` (`javaScriptEnabled: false`).
- La web lleva `pg` como `devDependency` solo para `tests/e2e/helpers/db.ts`.

### 12.3 Casos mínimos que demuestran el criterio de hecho

**Contratos (unitarios)**

- C-1. `ageOn`/`isAdultOn`: cumple 18 hoy → adulto; cumple mañana → no. Nacimiento el 2008-02-29: el 2026-02-28 → adulto, el 2026-02-27 → no; el 2028-02-28 → 19 años y el 2028-02-29 → 20.
- C-2. Propiedad: para cada día de 2024 a 2030, `isAdultOn(latestAdultBirthDate(d), d)` y `!isAdultOn(díaSiguiente(latestAdultBirthDate(d)), d)`.
- C-3. `referenceToday`: `2026-11-10T23:30Z` → `2026-11-11`; los dos cambios de hora de 2026 en Madrid; `2026-12-31T23:30Z` → `2027-01-01`.
- C-4. `checkBirthDate`: futura → `IN_FUTURE` (antes que `UNDERAGE`).
- C-5. `emailSchema` normaliza `'  Ana.Lopez@Example.COM '` → `'ana.lopez@example.com'` y rechaza `'no-es-correo'`. `newPasswordSchema`: 9 → `too_short`, 10 y 128 → bien, 129 → `too_long`. Un emoji compuesto cuenta por sus puntos de código.
- C-6. `birthDateSchema`: rechaza `2007-02-29`, `2026-02-30` y `1899-12-31` (`too_old`); acepta `2000-02-29`. Si falta, `required`.

**API (integración)**

- I-1. Registro de una persona adulta → 201. En la base de datos: un `users` con el correo normalizado, `password_hash` que empieza por `$argon2id$` y `birth_date` correcta; un `consents` con `purpose='service_use'`, `policy_version='2026-11-borrador'` y `granted_at` igual al `Clock`; un `sessions` con `token_hash = sha256(token)` y `expires_at = now + 30 días`.
- I-2. Cumple 18 hoy en Madrid (con el `Clock` fijado a las 23:30 UTC del día anterior) → 201.
- I-3. **Menor**: cumple 18 mañana → 422 `UNDERAGE`, y las tres tablas siguen con **0 filas**.
- I-4. 29 de febrero (los dos lados del límite) → 201 y 422.
- I-5. Fecha futura → 400 `birthDate: in_future`; fecha imposible → 400 `invalid_format`. 0 filas.
- I-6. Correo repetido con otras mayúsculas y espacios → 409 `EMAIL_TAKEN`; sigue habiendo un solo usuario.
- I-7. Sin `acceptTerms`, o con `false` → 400. Con `termsVersion` antigua → 409 `TERMS_VERSION_OUTDATED`. 0 filas.
- I-8. Contraseña de 9 caracteres → 400; de 10 → 201; de 128 → 201; de 129 → 400. Campo desconocido → 400 `unrecognized`.
- I-9. Login correcto → 200 con un token nuevo distinto del de registro (dos filas en `sessions`).
- I-10. Login con contraseña errónea y con correo inexistente → 401 con cuerpos **idénticos**.
- I-11. Límite: con el mismo correo, el 6.º intento en 15 minutos → 429 `RATE_LIMITED` con `Retry-After`. Con la misma IP, el 6.º registro en una hora → 429.
- I-12. `GET /auth/session`: token válido → 200; token inventado → 401; con el `Clock` 31 días después → 401 y la fila borrada; con el `Clock` 16 días después → 200, `renewed: true` y `expires_at` ampliado.
- I-13. Sin `X-Internal-Api-Key`, o con una errónea → 403 `FORBIDDEN`. `/health` responde sin clave.
- I-14. **Salir**: `POST /auth/logout` → 204; el mismo token → 401 al instante; la fila ya no existe.
- I-15. Borrado con contraseña errónea → 403 `PASSWORD_INCORRECT`; el usuario y la sesión siguen.
- I-16. **Borrado**: correcto → 204. Después: 0 filas con ese `user_id` en **todas** las tablas con FK hacia `users` (consultadas en `information_schema`); todos los tokens del usuario, también los de otro login, → 401; login con ese correo → 401; registro de nuevo con el mismo correo → 201.
- I-17. Borrar al usuario A no toca las filas del usuario B.
- I-18. `ConsentsService`: un segundo `grant` activo de la misma finalidad viola `consents_one_active_per_purpose`; `revoke` y después `grant` → bien, con histórico de 2 filas. La base de datos rechaza `purpose='otra'` (`CHECK`).
- I-19. Cuerpo JSON ilegible → 400 `MALFORMED_REQUEST`; cuerpo de más de 16 kB → 400.
- I-20. Ruta inexistente → 404 `NOT_FOUND` con la forma de §6.3.
- I-21. **Logs**: se captura la salida del logger durante el registro (adulto y menor), el login fallido, la violación de unicidad y el borrado. Se comprueba que no aparecen la contraseña, el token, su hash, la fecha de nacimiento, el correo ni la clave interna. Además, las respuestas que cortan los guards y el *parser* (403 sin clave interna, 401 sin sesión, 429, 400 de JSON ilegible) y el 404 dejan su entrada de log, con la ruta declarada o `'(sin ruta)'` y nunca la URL real con su *query*.
- I-22. **Límites de la base de datos** (§7.2): `select pg_sleep(2)` con un `statement_timeout` de 200 ms falla con `57014` y el pool sigue sirviendo; una transacción inactiva más que `idle_in_transaction_session_timeout` se aborta; `/health` con la base colgada responde 503 dentro del plazo de adquisición. El unitario del módulo comprueba que `query_timeout` es `statement_timeout` + 500, y `qa-db-hang.int.spec.ts` (BUG-QA-8), que una consulta sobre una conexión abierta cuya red deja de pasar datos falla en pocos segundos.
- I-23. **Transacciones** (`transactions.int.spec.ts`, con el relé TCP de `test/helpers/tcp-relay.ts`): un BEGIN sin respuesta falla en el plazo de `query_timeout`; tras más BEGIN colgados que el máximo del pool, el pool sigue sirviendo, sin clientes prestados; un COMMIT cuya respuesta se pierde descarta el cliente (y la fila existe); un error normal y una violación de unicidad hacen ROLLBACK, no dejan nada y el cliente vuelve al pool.
- I-24. **`OUTCOME_UNKNOWN`** (`outcome-unknown.int.spec.ts`, la app entera a través del relé): si se pierde la respuesta del COMMIT del registro, o la del DELETE del borrado, se responde 503 `OUTCOME_UNKNOWN` y la operación sí se hizo; después la API sigue funcionando; un `statement_timeout` (`57014`, tabla bloqueada por otra conexión) da 500 `INTERNAL_ERROR` y no deja nada. El clasificador `isConnectionLost` tiene su unitario (`pg-errors.spec.ts`).

**Web (unitarios)**

- W-1. `messages.ts` tiene texto para cada `ErrorCode`, para `API_UNAVAILABLE` y `OUTCOME_UNKNOWN` y para cada `FieldIssue` de los campos de los formularios. `OUTCOME_UNKNOWN` solo tiene texto propio en registro y eliminación.
- W-2. `parseBirthDateParts`: `5`, `05` y `5 ` valen como día y como mes; `31/2/2000` → fecha inexistente; `0/5/1990` → error de día; `12/13/1990` → error de mes; un año de tres cifras → error de año; los tres vacíos → fecha vacía.
- W-3. `safeReturnPath`: devuelve `/cuenta` y `/cuenta/eliminar` tal cual; `https://otro.sitio`, `//otro.sitio`, `/otra` y vacío → `/cuenta`.
- W-4. `api-client` contra un servidor TCP falso (`api-client.spec.ts`): conexión rechazada → `API_UNAVAILABLE` en todas las peticiones; tiempo agotado y conexión cortada tras enviar (cierre y RST) → `OUTCOME_UNKNOWN` en `register` y `deleteAccount`, con una sola petición recibida; `login` en los mismos casos → `API_UNAVAILABLE`. Un 201 con el cuerpo truncado o fuera del esquema → `OUTCOME_UNKNOWN` en `register` y `API_UNAVAILABLE` (502) en `login`.
- W-5. Acciones (`routes/actions.spec.ts`): con `OUTCOME_UNKNOWN`, el registro da 503 con `registro.error.resultado_incierto`, los valores sin la contraseña y sin cookie; el borrado da 503 con `eliminar.error.resultado_incierto` y no borra la cookie.

**E2E (Playwright)**

- E-1. Registro de una persona adulta → aterriza en `/cuenta` y ve su correo y las condiciones aceptadas con su versión y su fecha (textos de UX §5.5). La cookie `cupidilla_session` es `httpOnly`, `SameSite=Lax` y `Secure`.
- E-2. Salir → `/` con el aviso de sesión cerrada. Visitar `/cuenta` → redirige a `/entrar?siguiente=/cuenta`, y tras entrar se vuelve a `/cuenta`. Con `?siguiente=https://otro.sitio` o `//otro.sitio` → `/cuenta`.
- E-3. Entrar → `/cuenta`. Entrar con una contraseña errónea → mensaje en español, sin decir cuál de los dos datos falla.
- E-4. Eliminar con una contraseña errónea → mensaje de error y la cuenta sigue. Con la contraseña correcta → `/` con el aviso de cuenta eliminada; entrar de nuevo falla; en `cupidilla_e2e` no hay ninguna fila con ese correo.
- E-5. **Menor** (fecha = `latestAdultBirthDate(hoy)` + 1 día) → se queda en `/registro` con la pantalla de menor de edad (sin formulario y sin valores), también cuando además hay otros campos mal, y en la base de datos no hay ningún usuario con ese correo.
- E-6. El proyecto `chromium-sin-js` repite E-1 a E-4: los formularios funcionan sin JavaScript.
- E-7. **CSRF**: un `POST` a `/entrar` con `Origin: https://evil.example` y `Content-Type: application/x-www-form-urlencoded` → 403.
- E-8. La consola del navegador no muestra violaciones de CSP en `/`, `/registro` ni `/cuenta`.
- E-9. **Resultado incierto** (`outcome-unknown.e2e.ts`, criterios de UX 60 a 65, con y sin JavaScript). La web habla con su propia API (`helpers/stack.ts`, opción `webApiUrl`) a través de un proxy (`helpers/api-proxy.ts`) que, en la ruta elegida, no responde nunca (`hang`) o pasa la petición a la API y corta sin devolver la respuesta (`cut`). Se comprueba: estado 503, bloque `role="alert"` primero de `<main>` con el texto y el enlace, `<title>` con «Error:», foco con JavaScript, botón operable, valores conservados sin contraseña, cookie (ausente en el registro, intacta en el borrado), una sola petición en el proxy y que el enlace de comprobación lleva a donde toca según la API hiciera o no la operación. `/entrar` y «Cerrar sesión» siguen mostrando su error de servidor. Con la API parada (conexión rechazada), C31 y el borrado con la API caída de `resilience.e2e.ts` siguen mostrando `*.error.servidor`.

**El criterio de hecho del hito se cumple cuando** `npm run lint`, `npm run typecheck`, `npm test` y `npm run test:e2e` pasan en verde partiendo de `npm run db:reset`.

---

## 13. Riesgos, puntos por comprobar y cómo encaja H1

### 13.1 Riesgos y comprobaciones al implementar

| # | Riesgo | Qué hacer |
|---|---|---|
| R1 | **Versiones muy recientes**: SvelteKit 3.2, Nest 12.4, Vitest 5.1 y Vite 8 salieron en los últimos meses, y la documentación de terceros suele estar escrita para versiones anteriores | Consultar solo la documentación oficial (`svelte.dev/docs/kit/llms.txt`, `docs.nestjs.com/llms.txt`, `vitest.dev/guide/migration`). La plantilla de Nest trae un `AGENTS.md` con esta advertencia |
| R2 | TypeScript 7 aparece como `latest` y un `npm i -D typescript` lo instalaría | Fijar 6.0.3 exacta en todos los `package.json`. `npm ls typescript` debe mostrar una sola versión |
| R3 | **Metadatos de decoradores**: Vitest compila con Oxc, que emite `design:paramtypes` solo en parte. Si una clase inyectada se importa con `import type`, Nest recibe `Object` y la inyección falla | Comprobado que funciona con importaciones normales. No activar `consistent-type-imports` en la API. Los tokens que no son clases (`DB`) se inyectan con `@Inject(DB)`. Si apareciera un fallo, se añade `unplugin-swc` 2.0.0 en `vitest.config.ts` como indica la [receta de SWC](https://docs.nestjs.com/recipes/swc) |
| R4 | `drizzle-kit` y ESM: hoy funciona (comprobado), pero es una herramienta 0.x | Si una versión futura falla con las importaciones `.js`, se junta el esquema en un archivo. Se revisa siempre el SQL generado |
| R5 | El límite de intentos en memoria se reinicia con la API y no sirve con varias instancias | Aceptado en H0. Antes de la beta, Redis (ya previsto en `arquitectura.md`) como almacenamiento de `@nestjs/throttler` |
| R6 | CSP: los estilos en línea de Vite en `dev`, o los atributos `style` en Svelte, podrían chocar | E-8 lo vigila en `preview`. Si en `dev` molesta, se aplica la CSP solo fuera de `dev` (no se relaja `script-src`) |
| R7 | Cookie `Secure` en `preview` sobre HTTP | Funciona en `localhost` en Chromium; por eso los e2e usan `localhost`. Si no fuera así, `secure` pasaría a una variable `COOKIE_SECURE` |
| R8 | Endurecimientos que quedan fuera de H0 | Antes de la beta: verificación de correo y recuperación de contraseña (reevaluar `@nestjs/authentication`); respuesta uniforme en el registro; prefijo `__Host-`; lista de contraseñas comprometidas; HSTS; Redis; verificación real de la edad (ver `decisiones.md`) |
| R9 | Node 24 está en *maintenance LTS* desde el 20 de octubre de 2026; la LTS activa es Node 26 (desde el 28 de octubre) | H0 se queda en 24, que es la instalada y tiene soporte hasta abril de 2028. Conviene pasar a 26 antes del primer despliegue (pregunta 3) |
| R10 | npm 11 bloquea los scripts de instalación; un paquete nuevo podría necesitar el suyo | `npm install-scripts ls` tras cada instalación. Solo se aprueba (con versión fijada) si falla sin él |
| R11 | La primera instalación en NTFS es más lenta (muchos archivos pequeños) | Es solo rendimiento. Los datos de PostgreSQL no van ahí, y los navegadores de Playwright tampoco |
| R12 | `init` de PostgreSQL solo corre con el volumen vacío | Documentado: `npm run db:reset` |
| R13 | Los mensajes de `DrizzleQueryError` y del *body parser* contienen datos de la petición | Saneado en el filtro (§8.9) y comprobado por I-21 |

### 13.2 Cómo encaja H1 sin rehacer nada

- **Módulos nuevos en la API**: `interview`, `profiles` y `ai`, con `LlmProvider` y `@anthropic-ai/sdk` solo dentro de `ai`. Se apoyan en `SessionGuard` (global), `Clock`, `DatabaseModule`, `ApiException` y el formato de error, que ya existen.
- **Tablas nuevas**: `interview_sessions`, `interview_messages`, `profile_observations` y `usage_events`.
  - Toda tabla con datos de una persona lleva `user_id` con FK hacia `users` `ON DELETE CASCADE`. El test I-16 recorre todas las FK, así que cubre las tablas nuevas sin cambiar nada.
  - `usage_events` puede preferir `ON DELETE SET NULL` para conservar costes anonimizados; se decide en H1.
- **Consentimiento de datos sensibles**: una migración que añade `sensitive_data` a la `CHECK` de `consents.purpose`, la constante en `CONSENT_PURPOSES`, un texto versionado y los endpoints de conceder y revocar (`ConsentsService.revoke` ya existe y tiene test).
- **Contratos**: `packages/contracts` suma los esquemas de la entrevista (`ProfileObservation`, `TurnOutput`, `InterviewPhase`). Desde ahí los usan la web y la validación de la salida del modelo, como pide `arquitectura.md`.
- **Web**: las rutas `/entrevista` y `/perfil` entran en el grupo `(privado)` y quedan protegidas sin tocar la guardia. Si la respuesta de Cupidilla se transmite en *streaming*, un `+server.ts` de SvelteKit reenvía el *stream* de la API: el principio de que el navegador solo habla con SvelteKit se mantiene.
- **Configuración**: `ANTHROPIC_API_KEY` y el modelo se añaden a `envSchema`, que validará en el arranque. El límite de intentos de la entrevista usa el mismo `AppThrottlerGuard`.

---

## Plan de implementación

Tareas en orden. Cada una se da por hecha solo cuando cumple su criterio.

| # | Tarea | Hecho cuando |
|---|---|---|
| T1 | Raíz del monorepo: `package.json` con workspaces y `allowScripts`, `.nvmrc`, `.npmrc`, `tsconfig.base.json`, `eslint.config.js`, `prettier.config.js`, `.gitignore`, `.env.example`, `docker-compose.yml` e `init` | `npm install` sin errores; `npm install-scripts ls` vacío; `npm run db:up` deja `db` en *healthy*; `psql` muestra `cupidilla`, `cupidilla_test` y `cupidilla_e2e` |
| T2 | `packages/contracts`: constantes, esquemas, errores, `age.ts` y sus tests | Pasan C-1 a C-6; `npm run build:contracts` genera `dist/` con `.d.ts`; un `node -e "import('@cupidilla/contracts')"` desde la raíz lo importa |
| T3 | `apps/api` generada (§4.2) con `envSchema`, `DatabaseModule`, esquema Drizzle, migración `init`, `migrate.ts`, `reset-db.ts` y `/health` | `npm run db:migrate` crea las tres tablas con sus restricciones; `GET /health` → 200; con `INTERNAL_API_KEY` corta, la API no arranca y nombra la variable |
| T4 | Infraestructura común: `configureApp`, `ApiException` y su filtro, `exceptionFactory`, `InternalKeyGuard`, `AppThrottlerGuard`, `Clock`, middleware de log de peticiones | Pasan los unitarios y la integración I-13, I-19 e I-20 |
| T5 | `users`, `consents` y `auth`: registro, login, logout, `GET /auth/session` y `GET /users/me` | Pasan I-1 a I-12, I-14, I-18 e I-21 (parcial) |
| T6 | Eliminación de la cuenta | Pasan I-15 a I-17 e I-21 completo |
| T7 | `apps/web` generada (§4.3) con `env.ts`, `hooks.server.ts`, `api-client.ts`, `session-cookie.ts`, `messages.ts`, CSP y cabeceras | `npm run typecheck` en verde; `npm ls svelte @sveltejs/kit` muestra 5.57.3 y 3.2.0; `/cuenta` sin sesión redirige a `/entrar`; pasa W-1 |
| T8 | Páginas y acciones: `/`, `/registro`, `/entrar`, `/cuenta` (con `salir`), `/cuenta/eliminar` y `/legal/condiciones` (texto borrador con la versión visible), según [el diseño UX](h0-diseno-ux.md) y los acuerdos de §1 bis | Los flujos funcionan a mano en `npm run dev`, también con JavaScript desactivado |
| T9 | Playwright: configuración con los dos servidores y los tests E-1 a E-8 | `npm run test:e2e` en verde en los dos proyectos |
| T10 | README con «clonar y arrancar» (§11.4) y verificación completa | Desde `npm run db:reset`: `lint`, `typecheck`, `test` y `test:e2e` en verde |

---

## Preguntas para el CTO

Ninguna bloquea el arranque; cada una tiene la opción por defecto con la que está diseñado H0.

1. **Enumeración en el registro**: ¿aceptamos en H0 que el registro responda «este correo ya está en uso»? Por defecto sí, hasta que exista la verificación de correo (§1, matiz 5).
2. **Zona horaria de referencia**: ¿la beta será solo en España? Por defecto Europe/Madrid, aceptando el desfase de una hora en Canarias (§9).
3. **Node 26**: ¿se pasa a Node 26 (LTS activa desde el 28 de octubre) antes del primer despliegue? Por defecto H0 se queda en Node 24 (R9).
4. **Sesión de 30 días deslizante**: ¿encaja con el producto? Por defecto sí; es una variable de entorno.
5. **Para el usuario y la asesoría jurídica**: si se conserva prueba del consentimiento tras el borrado y cómo tratar las copias de seguridad (§10), y confirmar el criterio del 29 de febrero (§9).
6. **Para el diseñador UX**: resuelto en [§1 bis](#1-bis-acuerdos-entre-este-diseño-y-el-de-ux).

**Respuestas del CTO (11 de noviembre de 2026)**: 1, sí en H0; 2, Europe/Madrid; 3, Node 24 en H0 y Node 26 antes del primer despliegue; 4, sí; 5, trasladada al usuario y anotada en [decisiones](decisiones.md#antes-de-la-beta); 6, resuelta en §1 bis.
