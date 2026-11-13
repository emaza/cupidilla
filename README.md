# Cupidilla

Web de contactos con una celestina de IA. Cupidilla conversa con cada persona para entender qué busca, le propone pocas personas compatibles explicando por qué, y media en la presentación **solo cuando ambas partes consienten**.

> «Menos deslizar. Más conectar.»

## Estado

Hito **H0 — base mínima** implementado (11 de noviembre de 2026): registro, entrar, salir y borrar la cuenta, comprobación de mayoría de edad y consentimiento de uso guardado con fecha y versión. Todavía no hay entrevista ni llamadas a modelos de lenguaje. El diseño está en [H0 — Diseño técnico](docs/h0-diseno-tecnico.md) y [H0 — Diseño UX](docs/h0-diseno-ux.md).

**Entrada con Google y Facebook** (decisión 19, 13 de noviembre de 2026): entrar y darse de alta con un proveedor, unirlo a una cuenta con contraseña y, desde «Tu cuenta», añadir o quitar proveedores, crear una contraseña y borrar la cuenta sin contraseña. Probada contra un proveedor falso; falta comprobarla con Google y Facebook reales (ver abajo). El diseño está en [Diseño técnico](docs/login-terceros-diseno-tecnico.md) y [Diseño UX](docs/login-terceros-diseno-ux.md).

El código es un monorepo con npm workspaces:

| Paquete | Qué es |
|---|---|
| `apps/web` | SvelteKit 3 sobre Svelte 5 (runas). Lo único que ve el navegador; habla con la API desde el servidor |
| `apps/api` | NestJS 12 con Drizzle ORM sobre PostgreSQL 18 (módulos `auth`, `users` y `consents`) |
| `packages/contracts` | Esquemas Zod, códigos de error y la regla de mayoría de edad, compartidos por la web y la API |
| `packages/fake-oauth-provider` | Proveedor OAuth falso (Google y Facebook) para las pruebas y para `npm run dev` sin cuentas reales |

## Clonar y arrancar

Necesitas Node 24 (`.nvmrc`), npm 11.19 o posterior y Docker.

```sh
nvm use                       # Node 24 (.nvmrc)
cp .env.example .env          # y rellena INTERNAL_API_KEY (ver abajo): sin ella no arranca
npm ci
npm install-scripts ls        # debe salir vacío (todo denegado en allowScripts)
npm run db:up                 # PostgreSQL 18 en Docker, espera a que esté sano
npm run db:migrate
npm run dev                   # web en http://localhost:5173 · API en http://127.0.0.1:3001
```

`INTERNAL_API_KEY` viene vacía en `.env.example` a propósito: la API y la web se niegan a arrancar hasta que pongas una clave aleatoria propia de 32 caracteres o más. Genérala con `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` y pégala en `.env`.

**Tests**: con `npm run db:up` hecho, `npm test` (unitarios e integración). La primera vez, `npm run e2e:install` (descarga Chromium en `~/.cache/ms-playwright`); después, `npm run test:e2e`, que levanta la API (puerto 3101, base de datos `cupidilla_e2e`) y la web compilada (puerto 4173) y prueba los flujos con JavaScript y sin él. `npm run lint` y `npm run typecheck` comprueban el estilo y los tipos de todo el monorepo.

**Despliegue detrás de un proxy inverso**: la web (`adapter-node`) pasa a la API la IP de cada persona para el límite de intentos. Detrás de un proxy hay que configurar `ADDRESS_HEADER` (por ejemplo, `X-Forwarded-For`, con `XFF_DEPTH` según el número de proxies) y `ORIGIN` (la URL pública, para la comprobación de CSRF) de `adapter-node`. Sin `ADDRESS_HEADER`, todas las peticiones llegarían con la IP del proxy y todas las personas compartirían el mismo límite de intentos. Dos avisos:

- Configura `ADDRESS_HEADER` solo si el proxy sobrescribe esa cabecera en cada petición (o, con `X-Forwarded-For`, le añade la IP real al final). Las cabeceras se falsean con facilidad: si el proxy deja pasar la que manda el cliente, cualquiera podría poner la IP que quiera y saltarse el límite de intentos.
- Si `ADDRESS_HEADER` está configurada y una petición llega sin esa cabecera (o, con `X-Forwarded-For`, con menos direcciones que `XFF_DEPTH`), `adapter-node` lanza un error al pedir la IP y la petición falla. Configúrala solo cuando todo el tráfico pase por el proxy.

**La web y la API**: la web manda a la API la clave interna y los tokens de sesión, así que `API_URL` tiene que ser `https:`, salvo en loopback (`127.0.0.1`, `localhost`, `::1`); si no, la web no arranca. Si la API está en una red privada de contenedores sin TLS, pon `API_URL_ALLOW_HTTP=true` para permitir `http:` de forma explícita. No lo actives si el tráfico entre la web y la API pasa por una red que no controlas.

## Entrar con Google y Facebook

Los botones solo aparecen para los proveedores configurados: sin credenciales, la web funciona como en H0. Hay dos formas de probarlos en local.

**Con el proveedor falso** (sin cuentas de Google ni de Meta). Añade al `.env`:

```sh
OAUTH_REDIRECT_BASE_URL=http://localhost:5173
GOOGLE_CLIENT_ID=falso-google
GOOGLE_CLIENT_SECRET=falso-google-secreto
FACEBOOK_APP_ID=1234567890
FACEBOOK_APP_SECRET=falso-facebook-secreto
OAUTH_FAKE_PROVIDER_URL=http://127.0.0.1:4400
```

y arranca el proveedor falso en otra terminal, junto a `npm run dev`:

```sh
npm run oauth:fake            # proveedor falso en http://127.0.0.1:4400
```

Al pulsar «Continuar con Google» se abre su formulario: escribe un correo y pulsa «Autorizar» o «Cancelar». Si dejas vacío el identificador, se calcula a partir del correo, así que el mismo correo es siempre la misma cuenta de Google. Para simular otra cuenta del proveedor con el mismo correo, escribe un identificador distinto. El campo «Escenario» simula fallos del proveedor (`token_error`, `slow_token`, `graph_error`…). La API se niega a usar el proveedor falso con `NODE_ENV=production`, y solo lo admite en loopback.

**Con Google y Facebook reales** (solo `localhost`). Crea las apps siguiendo [§15 del diseño técnico](docs/login-terceros-diseno-tecnico.md#15-pasos-del-ceo-en-google-y-meta-solo-localhost), con estas *redirect URI* exactas (sin barra final, con `localhost` y no `127.0.0.1`):

- Google: `http://localhost:5173/auth/google/callback`
- Facebook: `http://localhost:5173/auth/facebook/callback`

Después pon en el `.env` `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` y `OAUTH_REDIRECT_BASE_URL=http://localhost:5173`, **sin** `OAUTH_FAKE_PROVIDER_URL`, y reinicia `npm run dev`. Mientras las apps estén en modo de pruebas, solo entran las cuentas añadidas como probadoras. Cada proveedor necesita su pareja completa: con media pareja, la API no arranca. Los secretos solo los usa la API y nunca van al navegador.

Los e2e (`npm run test:e2e`) arrancan su propio proveedor falso en el puerto 4400 y no necesitan nada de esto.

Los scripts de `docker/postgres/init` solo se ejecutan con el volumen vacío: si cambian, `npm run db:reset` (borra los datos locales).

## Documentos

| Documento | Para qué sirve |
|---|---|
| [Producto](docs/producto.md) | Qué es Cupidilla, para quién, cómo funciona una presentación y cómo gana dinero |
| [MVP](docs/mvp.md) | Qué se construye primero, qué queda fuera, hitos con criterios de aceptación y cómo se valida |
| [Arquitectura](docs/arquitectura.md) | Stack, módulos, modelo de datos y cómo se integra el modelo de lenguaje |
| [Entrevista con Cupidilla](docs/entrevista-cupidilla.md) | Especificación del primer hito: la conversación que construye el perfil privado |
| [Privacidad y seguridad](docs/privacidad-y-seguridad.md) | Datos sensibles, consentimientos y lo que hay que resolver antes de tener usuarios reales |
| [Decisiones](docs/decisiones.md) | Qué está decidido, qué sigue abierto y quién debería resolverlo |
| [H0 — Diseño técnico](docs/h0-diseno-tecnico.md) | Cómo se construye la base mínima: estructura, versiones, datos, API, sesión, seguridad, entorno y pruebas |
| [H0 — Diseño UX](docs/h0-diseno-ux.md) | Pantallas, textos, estados, accesibilidad y criterios de aceptación de la base mínima |
| [Entrada con terceros — Diseño técnico](docs/login-terceros-diseno-tecnico.md) | Google y Facebook: protocolo, datos, API, web, seguridad, pruebas y pasos en las consolas |
| [Entrada con terceros — Diseño UX](docs/login-terceros-diseno-ux.md) | Botones, alta, unión, «Formas de entrar», textos y criterios de aceptación |

## Decisiones clave

- **Una sola marca**: la web y la asistente se llaman Cupidilla.
- **Arquitectura**: monorepo con SvelteKit sobre **Svelte 5 estable** (web) + NestJS (API) + PostgreSQL, como monolito modular.
- **Modelo de lenguaje**: Claude Opus 5.5 detrás de una interfaz propia intercambiable.
- **Primer hito**: entrevista con Cupidilla y perfil privado editable.
- **Regla de oro**: el modelo propone; el backend valida. El consentimiento se implementa en código, nunca en un prompt.

## Origen de estos documentos

Ordenan una conversación de ideación con ChatGPT (18–19 de octubre de 2026) y las decisiones tomadas el 11 de noviembre de 2026. No son una transcripción: donde el contenido se aparta de lo que propuso ChatGPT aparece marcado como **Ajuste**, y lo que nadie ha comprobado todavía aparece como **Por comprobar**.
