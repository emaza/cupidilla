# Verificación de correo, recuperación de contraseña y registro uniforme — Diseño técnico

[← Índice](../README.md) · Base: [H0](h0-diseno-tecnico.md) y [entrada con terceros](login-terceros-diseno-tecnico.md) · UX: [correo-diseno-ux.md](correo-diseno-ux.md) · Fecha: 14 de noviembre de 2026

Documento para el programador. Amplía H0 y la entrada con terceros sin cambiar sus principios: el navegador solo habla con SvelteKit, SvelteKit llama a la API con la clave interna, los tokens son opacos y en PostgreSQL solo se guarda su SHA-256, y ninguna respuesta revela si un correo tiene cuenta. Las decisiones del cliente (§1.1) no se reabren; las del CTO se concretan en §1.2, con las discrepancias marcadas y su estado; §1.3 responde a lo que UX dejó «pendiente con arquitectura». Los criterios de hecho y los casos de prueba están escritos como escenarios Dado-Cuando-Entonces, dentro de cada tarea del plan.

## Resumen

- **Datos**: `users.email_verified_at` y `users.verification_reminded_at`; tabla `email_tokens` (hash, un token vivo por usuario y propósito, un solo uso con `DELETE … RETURNING`); tabla `email_outbox` (correos pendientes, sin ningún secreto).
- **Envío**: puerto `Mailer` con `SmtpMailer` (nodemailer 10.3.1) y `MemoryMailer`. Las peticiones HTTP solo insertan en el *outbox* dentro de su transacción; un *worker* en la propia API envía con reintentos. **El token se genera al enviar**, en el *worker*: nunca se guarda en claro y su caducidad cuenta desde el envío.
- **Cinco correos**: confirma tu correo, recordatorio antes del borrado (desactivable), restablece tu contraseña, alguien intentó registrarse con tu correo y tu contraseña ha cambiado (desactivable).
- **Registro**: `POST /auth/register` responde siempre `202` sin cuerpo y sin sesión. Correo nuevo: cuenta sin verificar y «confirma tu correo». Correo ya registrado: no cambia nada y avisa a su dueño.
- **Verificar**: `POST /auth/email-verification`. Con la sesión de esa misma cuenta basta el botón. Sin ella se pide la contraseña de la cuenta: sin sesión, se abre; con la de otra cuenta, se conserva (decisión del cliente). Un enlace nunca es un inicio de sesión de un clic.
- **Recuperar**: `POST /auth/password-reset/request` (`202` siempre) y `POST /auth/password-reset`, que fija la contraseña (o la crea si la cuenta no tenía: cierra R4), verifica el correo, cierra todas las sesiones y abre una nueva con la cuenta del enlace.
- **Igualdad**: en el registro, la solicitud de recuperación y el reenvío, la respuesta es idéntica y el trabajo de la petición no depende de que el correo exista (§5.2). Límites por IP y por correo que no revelan nada.
- **Ocupación (R7b)**: un `users.email` sin verificar sigue ocupando su correo. Su dueño real lo recupera con «¿Olvidaste tu contraseña?», que echa al ocupante. Si nadie lo verifica, la cuenta se borra a los **7 días**, con recordatorio el 5.º. Sin verificar no se puede añadir un proveedor.
- **Revisión de datos**: quien restablece la contraseña de una cuenta que tenía el correo sin verificar no puede usar nada más hasta revisar su fecha de nacimiento (con la misma regla de edad que el alta) y volver a aceptar las condiciones (§5.11). Así nadie hereda los datos ni la aceptación de un ocupante.
- **Pruebas**: integración con `MemoryMailer` y `FakeClock`; e2e con **Mailpit** (en `docker-compose`), que Playwright lee por su API HTTP.

---

## 1. Alcance, decisiones y relación con UX

**Dentro**: marca de correo verificado, aviso y guard reutilizable; envío por SMTP con *outbox*; registro con respuesta uniforme; verificación, comprobación de enlaces, reenvío y recuperación; recordatorio y borrado de cuentas sin verificar; aviso de contraseña cambiada; Mailpit en local y e2e.

**Fuera**: cambiar la contraseña desde `/account` con la actual, cambiar el correo de la cuenta (decisión del cliente), lista de contraseñas comprometidas, captcha, proveedor SMTP de producción (depende de «Marca y dominio»).

Este documento manda en código, datos, API y seguridad; el de UX manda en pantallas, textos y correos (mismo reparto que H0 §1 bis).

### 1.1 Decisiones del cliente (14 de noviembre de 2026)

| # | Decisión | Consecuencia aquí |
|---|---|---|
| 1 | Sin verificar se puede entrar, con límites | El login no cambia. `emailVerified` en la sesión, aviso y `@RequiresVerifiedEmail()` listo para H1 (§5.9). Primer uso: añadir un proveedor (§5.10) |
| 2 | SMTP genérico (nodemailer) y Mailpit en local | §4, §8 |
| 3 | Registro con respuesta uniforme en este hito | §5.1, §5.2 |
| 4 | Recordatorio antes de borrar una cuenta sin confirmar, activo por defecto y desactivable (`EMAIL_UNVERIFIED_REMINDER`) | Cuarto correo, el 5.º día (§6.3). El borrado sigue a los 7 días |
| 5 | «Tu contraseña ha cambiado» tras restablecerla, activo por defecto y desactivable (`EMAIL_PASSWORD_CHANGED_NOTICE`) | Quinto correo, encolado en la transacción del restablecimiento (§5.6) |
| 6 | Recuperar con un correo sin cuenta no envía nada | §4.3, §5.5 |
| 7 | No hay cambio de correo: quien se equivoca se registra de nuevo y la cuenta errónea se borra sola | §6.3 |
| 8 | Restablecer abre sesión con la cuenta del enlace aunque hubiera otra; confirmar el correo no cambia la sesión | §5.4, §5.6 |
| 9 | No se sube la versión de las condiciones | `SERVICE_TERMS_VERSION` no cambia. Los retoques de texto de UX §7 van al archivo `2026-11-borrador-2` existente. Solo es aceptable porque no hay usuarios reales que lo hayan aceptado |
| 10 | `MAIL_FROM` por defecto «Cupidilla &lt;no-reply@example.com&gt;» y buzón de contacto `MAIL_SUPPORT_ADDRESS` (por defecto `soporte@example.com`), los dos configurables; en producción, valores reales | §8.1 |
| 11 | K3 aceptada: para confirmar el correo se pide la contraseña si no hay sesión de esa misma cuenta; con ella basta el botón | §5.4 |
| 12 | Opción B: tras recuperar una cuenta que tenía el correo sin verificar, queda «pendiente de revisar datos». Hay que revisar o cambiar la fecha de nacimiento y volver a aceptar las condiciones (fila nueva en `consents`) antes de usar cualquier otra cosa; la edad se valida igual que en el alta | §5.11, fase C |
| 13 | El proveedor SMTP de producción y el dominio remitente se deciden antes del despliegue, junto a «Marca y dominio» | Pendiente, no bloquea este hito (R-M15) |
| 14 | Criterios de hecho y casos de prueba como escenarios Dado-Cuando-Entonces con datos concretos | Plan de implementación |

### 1.2 Cómo concreto las decisiones del CTO

| # | Plan del CTO | Este diseño | Motivo |
|---|---|---|---|
| K1 | El enlace se guarda en el *outbox* hasta enviarlo y luego se borra | **Discrepo en el cómo.** El *outbox* no guarda ningún secreto: el *worker* genera el token al enviar y solo su hash llega a `email_tokens` (§4.4) | Ningún token en claro en la base de datos, en copias de seguridad ni en filas que esperan horas a que vuelva el SMTP. Un correo retrasado llega con el enlace vivo |
| K2 | `email_tokens.used_at` | Sin `used_at`: consumir es `DELETE … RETURNING`, como `oauth_states`. Un `UNIQUE (user_id, purpose)` garantiza un token vivo | Un solo uso atómico sin estado extra. «Usado» y «caducado» dan el mismo error, y UX tampoco quiere distinguirlos |
| K3 | Verificar abre sesión si no la había | **Discrepo en parte. Aceptada por el cliente** (UX §3.2 se adapta). Con la sesión de esa misma cuenta, el botón basta. Sin ella, se pide la contraseña de la cuenta (§5.4) | Sin contraseña, el enlace sería un inicio de sesión de un clic: un atacante podría mandar a otra persona el enlace de **su** cuenta (*login CSRF*; en H1 la víctima contaría su vida a la cuenta del atacante). Y la víctima de una ocupación podría confirmar sin querer la cuenta que el ocupante creó con su correo, que quedaría verificada con la contraseña del ocupante |
| K4 | Reenviar solo con sesión | Reenvío público por correo (`POST /auth/email-verification/request` `{ email }`), con respuesta uniforme. Con sesión, la web envía el correo de la sesión | Quien acaba de registrarse no tiene sesión. Un solo *endpoint* para los dos casos (UX §10.1) |
| K5 | Solicitud de recuperación con el mismo `verifyDummy` | Sin argon2. La petición inserta siempre una fila en el *outbox* y no consulta `users`; el *worker* decide si hay a quién enviar (§5.2) | Lo único que podía variar era la escritura (y su `fsync` en el `COMMIT`). Así la petición hace exactamente lo mismo en los dos casos |
| K6 | Google con el correo de una cuenta con contraseña sin verificar: no ofrecer unir, sino «recupera la contraseña» | **Discrepo. Aceptada por el CTO.** Se mantiene la unión de terceros §6 (pide la contraseña), con «¿Olvidaste tu contraseña?» visible (UX §3.9). Si se completa, el correo queda verificado (§6) | Solo puede unir quien sabe la contraseña **y** controla el correo: el dueño. El dueño real de una cuenta ocupada no sabe la contraseña y usa «¿Olvidaste…?», que le da la cuenta. No cambia el flujo de `pending_identities` |
| K7 | (no estaba) | **Aceptada por el CTO.** Añadir un proveedor desde `/account` exige correo verificado | Sin esto, el ocupante une su propio Google antes de que el dueño recupere la cuenta y conserva el acceso (ataque de identidad troyana) |
| K8 | `PUBLIC_WEB_URL` nueva, o reutilizar `OAUTH_REDIRECT_BASE_URL` | Se **renombra** `OAUTH_REDIRECT_BASE_URL` a `PUBLIC_WEB_URL` | Es el mismo origen. Dos variables que deben coincidir acaban desincronizadas |
| K9 | Borrar sin verificar a los 7 días | 7 días, con la fecha visible en `/account` y en los correos, y recordatorio el 5.º día | §6.3 |
| K10 | (no estaba) | El login, la unión y la verificación con contraseña crean la sesión comprobando, con un bloqueo, que el hash no ha cambiado desde que se verificó (§5.7) | Cierra la carrera «login con la contraseña vieja mientras se restablece»: sin esto, esa sesión sobreviviría al cierre de todas |

El CTO acepta también las dos variantes nuevas del aviso de registro (§4.3) y seguir dando por verificado el correo de Facebook (R-M14). Los nombres de variables de §8.1 son definitivos. El resto se concreta tal cual: `email_verified_at`, TTL de 24 h y 1 h, un solo uso, *outbox* transaccional con reintentos, `Mailer` con dos adaptadores, `revokeAllForUser`, restablecimiento que crea la contraseña, verifica y abre sesión nueva, `@RequiresVerifiedEmail` y POST para consumir.

### 1.3 Respuestas a UX §10.1 («pendiente con arquitectura»)

| Tema | Respuesta | Dónde |
|---|---|---|
| Reenvío público | Sí, sin `purpose` en el cuerpo: cada pantalla llama a su ruta. `/register/check-email` → `POST /auth/email-verification/request`; `/forgot-password/check-email` → `POST /auth/password-reset/request` (pedir otro enlace es pedirlo otra vez). Las dos `202` uniformes | §5.3, §5.5 |
| Consulta de validez sin consumir | Sí: `POST /auth/email-tokens/inspection` `{ token, purpose }` → `200 { emailHint, sessionMatches }` o 400 `TOKEN_INVALID_OR_EXPIRED`. Es POST para que el token no vaya en una URL. `emailHint` es el correo enmascarado (`p•••@ejemplo.com`), que UX puede mostrar en `/reset-password`: quien tiene el enlace tiene el buzón | §5.4, §7 |
| TTL | Confirmados: 24 h y 1 h. Constantes en `contracts` (`EMAIL_VERIFICATION_TTL_HOURS`, `PASSWORD_RESET_TTL_MINUTES`, `UNVERIFIED_ACCOUNT_TTL_DAYS`), así que `{duracion}` y `{dias}` salen de ahí | §7.1 |
| Respuesta de confirmar | Adoptada la forma de UX: `{ session: 'same' \| 'opened' \| 'kept-other' }`; con `opened` lleva además la sesión nueva | §5.4, §7.1 |
| `emailVerified` | En `GET /auth/session`, en el login y en `/users/me` (con `emailVerifiedAt` y `unverifiedDeletionAt`) | §5.8 |
| Configuración visible para la web (tercera ronda) | Va en **`GET /config`**, la ruta pública de configuración que introduce el cambio de edad mínima (rama `edad-minima-configurable`): `{ minAge, mail: { unverifiedReminder, passwordChangedNotice } }`, con el valor de `EMAIL_UNVERIFIED_REMINDER` y `EMAIL_PASSWORD_CHANGED_NOTICE`. Una sola fuente de configuración pública, también para las páginas de invitado, y con la caché de 60 s de la web. `GET /auth/session` no cambia por esto. Nada de `PUBLIC_*` en la web | §5.8, §7.1 |
| `{fecha}` de borrado (segunda ronda) | Es `unverifiedDeletionAt` (`created_at + 7 días`, un instante UTC) escrito como el día de ese instante **en Europe/Madrid**, la zona de la regla de edad, con `formatSpanishDate` de `contracts`: «18 de noviembre de 2026». La usan la API (correos 1 y 4, variante (b)) y la web (`/account`), así que siempre coinciden. La cuenta no se borra antes de ese instante; el barrido horario la borra como mucho una hora después | §6.3, §7.1 |
| Pista de correo (segunda ronda) | La API devuelve `emailHint` ya enmascarado (`b•••@example.com`) y la web lo muestra tal cual, sin recomponerlo. No se devuelven la inicial y el dominio por separado | §5.4 |
| Correo 5 y revisión (segunda ronda) | Confirmado: «Tu contraseña ha cambiado» se encola **dentro de la transacción del restablecimiento**, así que llega aunque no se termine la revisión de datos | §5.6 |
| Límites | Por correo: registro (y con él el aviso) 3 cada 24 h; reenvío de verificación 5 cada 24 h; recuperación 5 cada 24 h; mismo contador exista o no la cuenta. **Sin el límite de un reenvío por minuto**: la deduplicación del *outbox* y que cada envío anula el enlace anterior ya cortan las ráfagas, y un segundo límite por ruta complicaría el *throttler* | §7.3 |
| `EMAIL_ALREADY_VERIFIED` al reenviar con sesión | **No hace falta código nuevo.** La web conoce `emailVerified` en cada carga (`GET /auth/session`): si ya está verificado, no llama a la API y redirige con `notice=verification-already`. La API responde siempre `202` y no envía nada a una cuenta verificada | §9.1 |
| Borrado a los 7 días | Se mantiene, con recordatorio (decisión 4 del cliente): se muestran `correo.texto.plazo` y la última frase del correo 1 | §6.3 |
| Cookie «correo pendiente» (UX §2.3) | Aceptada: `cupidilla_pending_email`, solo en la web (§9.1). La API no la ve | §9.1 |
| Código HTTP de «Este enlace ya no sirve» | 410 si se detecta al cargar (consulta de validez); 200 tras el 303 de un POST rechazado | §9.1 |
| Sesión tras restablecer con otra cuenta abierta | Confirmado: la cookie pasa a la cuenta del enlace; la otra sesión no se revoca en el servidor | §5.6 |
| Reenvío público a un correo verificado o de proveedor | No se envía nada; `202` y el texto condicional de UX §3.1 | §4.3 |
| Token en un campo oculto del formulario | **Variante**: el token pasa del `?token=` a una cookie `httpOnly` con un 303 **antes** de pintar la página, así que no queda ni en el historial. El formulario no lleva campo oculto. Para la persona no cambia nada | §9.1 |

**Pendiente con UX**:

1. K3 (aceptada): el estado de `/verify-email` con campo de contraseña (sin sesión o con la de otra cuenta). La consulta de validez dice de antemano si hace falta (`sessionMatches`).
2. `/account` cuando el correo no está verificado: cómo se ve «Añadir Google/Facebook» (K7) y el error `EMAIL_NOT_VERIFIED`.
3. `/login/link` con `accountEmailVerified: false` (§6.2).
4. Textos de `TOKEN_ATTEMPTS_EXCEEDED`, `EMAIL_NOT_VERIFIED` y `DATA_REVIEW_REQUIRED`.
5. Pantalla `/account/review` (§5.11, UX §3.10): fecha de nacimiento **vacía** (decisión del CTO: la guardada puede ser de otra persona y no se muestra), casilla de condiciones desmarcada, cerrar sesión y borrar la cuenta; la pantalla de cierre cuando la cuenta se ha borrado por ser menor, y el aviso `details-reviewed`. Tras restablecer en una cuenta que estaba sin verificar, se llega aquí en vez de a `/account`.

Los textos de los cinco correos, el pie con `{soporte}` y las variantes (a), (b) y (c) del aviso ya están en UX §5.1 a §5.5.

---

## 2. Versiones fijadas

Comprobadas hoy con `npm view` y la API de GitHub. Se exige que tengan al menos dos semanas, como en el diseño de terceros.

| Paquete | Versión | Dónde | Notas |
|---|---|---|---|
| `nodemailer` | **10.3.1** (29 de octubre de 2026) | `apps/api` `dependencies` | ESM y CJS, trae sus tipos (no hace falta `@types/nodemailer`), sin dependencias y sin scripts de instalación. Las 10.4.x y 10.5.0 (7–10 de noviembre) no cumplen las dos semanas |
| `axllent/mailpit` | **v1.32.0** (22 de octubre de 2026) | `docker-compose.yml` | La v1.33.0 tiene justo 14 días; se toma la anterior. La imagen trae su `HEALTHCHECK` (`/mailpit readyz`) |

**Prueba hecha** (scratchpad, Node 24, `nodemailer@10.3.1` y `mailpit:v1.32.0` en Docker):

- Con `streamTransport` el mensaje sale `multipart/alternative` (texto y HTML en UTF-8) con `From`, `To`, `Subject` y la cabecera `Auto-Submitted: auto-generated`. Sirve para el unitario del formato sin servidor.
- Conexión rechazada: `code: 'ESOCKET'`, sin `responseCode`. Los errores con respuesta SMTP traen `permanent: true` para los 5xx salvo 503: es lo que usa el *worker* para no reintentar (§4.3).
- `requireTLS: true` contra Mailpit falla con `ETLS`: en *loopback* no se fuerza TLS; fuera de *loopback*, siempre (§8.1).
- Mailpit: `GET /api/v1/search?query=to:"e2e+bbb@example.com"` devuelve solo ese destinatario aunque haya otros del mismo dominio; `GET /view/{ID}.txt` devuelve el texto plano tal cual; `DELETE /api/v1/search?query=…` borra solo esos.

**Descartados**

| Opción | Por qué no |
|---|---|
| API HTTP de un proveedor (Resend, Postmark, SES) | El cliente eligió SMTP genérico: no ata a un proveedor y Mailpit lo prueba de verdad |
| `@nestjs-modules/mailer`, motores de plantillas | Cinco correos fijos no justifican una dependencia más; las plantillas son funciones TypeScript con escape (§4.5) |
| Cola externa (BullMQ con Redis, `pg-boss`) | Para decenas de correos al día basta una tabla y un bucle; `pg-boss` añadiría su propio esquema |
| `smtp-server` para probar `SmtpMailer` sin Docker | El formato se prueba con `streamTransport` y el envío real con Mailpit en e2e |

---

## 3. Modelo de datos

### 3.1 `users` (cambios)

| Columna | Tipo | Notas |
|---|---|---|
| `email_verified_at` | `timestamptz` `NULL` | Cuándo se demostró que el correo es de la persona. `NULL` = sin verificar |
| `verification_reminded_at` | `timestamptz` `NULL` | Cuándo se encoló el recordatorio de §6.3. Evita enviarlo dos veces |
| `data_review_required_at` | `timestamptz` `NULL` | Cuándo quedó «pendiente de revisar datos» (§5.11). `NULL` = nada pendiente |

- `CHECK (email_verified_at IS NOT NULL OR password_hash IS NOT NULL)` (`users_unverified_has_password`). Una cuenta sin verificar solo nace del registro con contraseña; las de proveedor nacen verificadas (§5.10). La verificación con contraseña de §5.4 cuenta con ello.
- `CHECK (data_review_required_at IS NULL OR email_verified_at IS NOT NULL)` (`users_review_requires_verified`): la marca solo la pone el restablecimiento, que a la vez verifica el correo.
- Índice parcial `users_unverified_created_at_idx ON users (created_at) WHERE email_verified_at IS NULL`, para el recordatorio y el borrado de §6.3.
- `toPublicUser` añade `emailVerified: row.emailVerifiedAt !== null` y `dataReviewRequired: row.dataReviewRequiredAt !== null`.

### 3.2 `email_tokens`

| Columna | Tipo | Restricciones |
|---|---|---|
| `token_hash` | `text` | PK, `CHECK (token_hash ~ '^[0-9a-f]{64}$')` |
| `user_id` | `uuid` | `NOT NULL`, FK → `users(id)` `ON DELETE CASCADE` |
| `purpose` | `text` | `NOT NULL`, `CHECK (purpose IN ('verify_email','reset_password'))` |
| `email` | `text` | `NOT NULL`. El `users.email` al emitirlo; si no coincide al consumir, el token no vale |
| `failed_attempts` | `smallint` | `NOT NULL DEFAULT 0`, `CHECK (failed_attempts BETWEEN 0 AND 5)`. Contraseñas erróneas al verificar sin la sesión de la cuenta |
| `created_at`, `expires_at` | `timestamptz` | `NOT NULL`. Verificación: 24 h; recuperación: 60 min |

`UNIQUE (user_id, purpose)` (`email_tokens_user_purpose_unique`): un solo token vivo por usuario y propósito, garantizado por la base de datos. Emitir es `DELETE … WHERE user_id AND purpose` + `INSERT` en la misma transacción. Índice en `expires_at`. Token: `generateOpaqueToken()` (256 bits, 43 caracteres) y `hashOpaqueToken()` de `common/crypto/opaque-token.ts`.

### 3.3 `email_outbox`

| Columna | Tipo | Restricciones |
|---|---|---|
| `id` | `uuid` | PK, `DEFAULT gen_random_uuid()` |
| `kind` | `text` | `NOT NULL`, `CHECK (kind IN ('verify_email','verify_reminder','reset_password','signup_notice','password_changed'))` |
| `to_email` | `text` | `NOT NULL`, normalizado (misma `CHECK` que `users.email`) |
| `attempts` | `smallint` | `NOT NULL DEFAULT 0`, `CHECK (attempts BETWEEN 0 AND 8)` |
| `next_attempt_at` | `timestamptz` | `NOT NULL` |
| `locked_until` | `timestamptz` | `NULL`. Concesión del *worker* que la está enviando |
| `failed_at` | `timestamptz` | `NULL`. Error permanente o intentos agotados |
| `last_error` | `text` | `NULL`, `CHECK (char_length(last_error) <= 64)`. Solo un código (`ESOCKET`, `smtp_421`), nunca la respuesta del servidor |
| `created_at` | `timestamptz` | `NOT NULL` |

- **Sin `user_id` ni secretos.** La fila dice «manda este tipo de correo a esta dirección»; a quién pertenece y qué variante toca lo decide el *worker* al enviar (§4.3). Así la solicitud de recuperación y el reenvío pueden encolar sin consultar `users` (§5.2), y una cuenta borrada antes del envío no recibe nada.
- Índice único parcial `email_outbox_pending_unique ON (kind, to_email) WHERE failed_at IS NULL`: como mucho una fila pendiente por tipo y dirección. Encolar es `INSERT … ON CONFLICT DO NOTHING` (deduplica los reenvíos seguidos).
- Índice parcial `email_outbox_due_idx ON (next_attempt_at) WHERE failed_at IS NULL`.

### 3.4 Migración

Según la nota del 14 de noviembre: se borra `apps/api/drizzle/`, `npm run db:generate -- --name init` y `npm run db:reset`. Esquemas nuevos en `database/schema/email-tokens.ts` y `email-outbox.ts`, exportados en `index.ts`.

**Cuentas existentes**: no hay usuarios reales, así que el `db:reset` las borra todas (también las de prueba del `.env` de desarrollo). Si las hubiera, la regla sería: verificadas las que tienen una identidad con `email_verified = true` y `provider_email = users.email`, o no tienen contraseña; sin verificar, el resto, sin excepciones (el registro nunca verificó nada).

### 3.5 Retención

| Dato | Cuánto vive |
|---|---|
| Fila del *outbox* enviada o descartada | Se borra en el acto |
| Fila del *outbox* fallida | 7 días (para diagnosticar), luego la limpieza |
| Fila del *outbox* pendiente | Hasta enviarse; como mucho unas 8 h de reintentos (§4.3) |
| `email_tokens` | Hasta usarse, caducar (limpieza) o borrarse la cuenta |
| Cuenta sin verificar | 7 días desde `created_at` (§6.3) |

Al borrar una cuenta (`UsersService.deleteAccount`) se borran también, en la misma transacción, las filas del *outbox* con su `users.email`. Hay que añadir estas filas a la política de retención de `privacidad-y-seguridad.md`.

---

## 4. Envío: `Mailer`, *outbox* y *worker*

### 4.1 Estructura

```
apps/api/src/
├─ mail/
│  ├─ mail.module.ts             # elige SmtpMailer o MemoryMailer; exporta OutboxService y EmailTokensService
│  ├─ mailer.ts                  # abstract class Mailer, MailMessage, MailDeliveryError
│  ├─ smtp.mailer.ts             # nodemailer; smtpTransportOptions(url), classifySmtpError(error)
│  ├─ memory.mailer.ts           # bandeja en memoria y fallos programados (tests)
│  ├─ outbox.service.ts          # enqueue(tx, kind, toEmail), kick()
│  ├─ outbox.worker.ts           # drain(), temporizador, reintentos y limpiezas
│  ├─ mail-resolver.ts           # por tipo: destinatario, variante y token, o descartar
│  ├─ email-tokens.service.ts    # issue, findLive, consume, deleteForUser, emailHint
│  └─ templates/                 # layout.ts (escape, envoltorio y pie) y una por correo
├─ auth/
│  ├─ auth.controller.ts         # + las rutas de §7.3
│  ├─ email-verification.service.ts
│  ├─ password-reset.service.ts
│  ├─ sessions.service.ts        # + revokeAllForUser
│  ├─ verified-email.guard.ts
│  └─ data-review.guard.ts       # fase C (§5.11)
├─ common/decorators/requires-verified-email.decorator.ts | allow-during-data-review.decorator.ts
├─ users/unverified-accounts.sweeper.ts
├─ users/users.controller.ts     # + POST /users/me/data-review (fase C)
└─ database/schema/email-tokens.ts | email-outbox.ts
```

`MailModule` importa `UsersModule` e `IdentitiesModule` (para resolver destinatarios). `AuthModule` importa `MailModule` para encolar. `UnverifiedAccountsSweeper` y `UsersService.deleteAccount` escriben en `email_outbox` con SQL directo sobre la tabla (la misma forma de `INSERT … ON CONFLICT DO NOTHING`), sin importar `MailModule`, para no crear un ciclo; el *worker* recoge esas filas en su siguiente ciclo.

```ts
// mail/mailer.ts
export interface MailMessage { to: string; subject: string; text: string; html: string }
export abstract class Mailer {                     // clase abstracta: sirve de token de inyección
  abstract send(message: MailMessage): Promise<void>;
}
export class MailDeliveryError extends Error {
  constructor(readonly permanent: boolean, readonly code: string) { super(`mail delivery failed: ${code}`); }
}

// mail/outbox.service.ts
export type MailKind = 'verify_email' | 'verify_reminder' | 'reset_password' | 'signup_notice' | 'password_changed';
enqueue(db: Executor, kind: MailKind, toEmail: string): Promise<void>;   // INSERT … ON CONFLICT DO NOTHING
kick(): void;                                                             // tras el COMMIT; nunca se espera

// mail/outbox.worker.ts
drain(): Promise<{ sent: number; skipped: number; retried: number; failed: number }>;

// mail/email-tokens.service.ts
issue(tx: Tx, input: { userId: string; purpose: EmailTokenPurpose; email: string; ttlMs: number }): Promise<string>;
findLive(db: Executor, token: string, purpose: EmailTokenPurpose): Promise<EmailTokenRow | undefined>;
consume(tx: Tx, token: string, purpose: EmailTokenPurpose): Promise<EmailTokenRow | undefined>; // DELETE … RETURNING

// auth/sessions.service.ts
revokeAllForUser(db: Executor, userId: string): Promise<number>;   // DELETE FROM sessions WHERE user_id; arrastra oauth_states
```

**Adaptadores**

- `SmtpMailer`: un *transport* de nodemailer creado al arrancar con `smtpTransportOptions(SMTP_URL)` (§8.1), sin *pool*, con `connectionTimeout: 5000`, `greetingTimeout: 5000` y `socketTimeout: 15000`. `From` = `MAIL_FROM`; cabecera `Auto-Submitted: auto-generated` (evita respuestas automáticas). `classifySmtpError` convierte el error en `MailDeliveryError`: `permanent` es el `error.permanent` de nodemailer (5xx salvo 503) o un `EENVELOPE`; `code` es `smtp_<responseCode>` o el `code` del error. `EAUTH` y `ETLS` **no** son permanentes: son configuración, y los correos deben esperar a que se arregle.
- `MemoryMailer`: guarda los mensajes; `failNext(n, { permanent })` programa fallos; `messagesTo(email)`; `linkIn(message, path)` extrae el enlace. Vive en `src/` porque `MailModule` lo usa sin `SMTP_URL` en `NODE_ENV=test`, y nunca se puede elegir en producción (§8.1).

### 4.2 Encolar

Quien envía un correo llama a `outbox.enqueue(tx, kind, email)` **dentro de su transacción** y, tras el `COMMIT`, a `outbox.kick()`. Si la transacción se deshace, no hay correo; si el SMTP está caído, la respuesta HTTP no se entera.

`kick()` programa un `drain()` con `setImmediate` si no hay uno en curso y nunca se espera: la respuesta HTTP ya ha salido. Con `MemoryMailer` no hace nada (los tests llaman a `drain()` a mano).

### 4.3 El *worker*

Corre dentro de la API (`OutboxWorker`, `OnModuleInit`/`OnModuleDestroy`): un `drain()` al arrancar, cada 30 s con `setInterval(...).unref()` y con cada `kick()`. **No arranca su temporizador con `MemoryMailer`**; con `SmtpMailer` sí, también en `NODE_ENV=test` (los e2e lo necesitan). Al parar, espera al `drain()` en curso.

```mermaid
sequenceDiagram
  participant W as OutboxWorker
  participant D as PostgreSQL
  participant S as SMTP
  W->>D: UPDATE … SET locked_until = now+2 min, attempts = attempts+1<br/>WHERE id IN (SELECT … due … FOR UPDATE SKIP LOCKED LIMIT 10) RETURNING
  loop cada fila
    W->>D: BEGIN; resolver destinatario (users / identities)
    alt no hay a quién enviar
      W->>D: DELETE fila; COMMIT (mail_skipped)
    else con enlace
      W->>D: DELETE email_tokens (user, purpose); INSERT hash nuevo; COMMIT
      W->>S: send (token en claro solo en memoria)
      alt aceptado
        W->>D: DELETE fila (mail_sent)
      else transitorio
        W->>D: next_attempt_at = now + espera(attempts), locked_until = NULL, last_error
      else permanente o 8.º intento
        W->>D: failed_at = now, last_error (mail_failed, nivel error)
      end
    end
  end
```

- **Reclamar**: la fila elegible tiene `failed_at IS NULL`, `next_attempt_at <= now` y `locked_until` nulo o vencido. `SKIP LOCKED` y la concesión de 2 minutos permiten varias instancias y recuperan una fila si la API muere a mitad de envío.
- **Esperas** tras el intento *n*: 30 s, 2 min, 10 min, 30 min, 1 h, 2 h y 4 h; el 8.º fallo marca `failed_at` (unas 8 h en total). Constantes en `outbox.worker.ts`.
- **Duplicados**: si la API muere entre que el SMTP acepta y el `DELETE`, la fila se reenvía al vencer la concesión, con otro token; el enlace del primer correo deja de valer. Raro y aceptado (R-M6).
- **Resolver** (`mail-resolver.ts`), siempre por `to_email` en el momento del envío:

| `kind` | Destinatario | Token | Se descarta si |
|---|---|---|---|
| `verify_email` | `users` con ese `email` y sin verificar | `verify_email`, 24 h | No existe o ya está verificada |
| `verify_reminder` | Igual | `verify_email`, 24 h (sustituye al anterior) | Igual |
| `reset_password` | `users` con ese `email` (verificada o no, con o sin contraseña) | `reset_password`, 60 min | No existe (decisión 6 del cliente) |
| `signup_notice` | `users` con ese `email`; si no, la cuenta de la identidad con ese `provider_email` verificado (la de `last_used_at` más reciente, como R7b) | — | No hay ninguna |
| `password_changed` | `users` con ese `email` | — | No existe |

- **Variantes del aviso** (`signup_notice`), elegidas al enviar: (a) cuenta verificada, tenga o no contraseña: el texto de UX §5.3; (b) cuenta **sin verificar**, con su fecha de borrado; (c) correo de un **proveedor** unido a una cuenta con otro correo (R7b), con sus proveedores, porque la recuperación por ese correo no envía nada. Todas sin token. Textos en UX §5.3. En (c), `{proveedores}` sale de las identidades de la cuenta en el orden «Google», «Facebook»; si no hubiera ninguna al enviar, se descarta la fila (no hay cuenta a la que remitir).
- **Limpiezas** en el mismo ciclo, como mucho una vez por minuto: `DELETE FROM email_tokens WHERE expires_at <= now` y las filas con `failed_at` de más de 7 días.

### 4.4 Por qué el token se genera al enviar

| Opción | Valoración |
|---|---|
| Guardar el enlace en el *outbox* y borrarlo al enviar (plan) | Durante el envío, y durante horas si el SMTP cae, la base de datos tiene tokens válidos en claro. Una copia de seguridad hecha en ese momento los conserva |
| Cifrarlo en el *outbox* con una clave de entorno | Una clave más que custodiar y rotar, para un dato que no hace falta guardar |
| Derivarlo con HMAC de una clave y el `id` de la fila | Igual: una clave nueva |
| **Generarlo en el *worker* justo antes de enviar (elegida)** | El token en claro solo existe en la memoria del *worker* y en el correo. Sin claves nuevas. La caducidad empieza al enviar. «Un token vivo por usuario y propósito» se aplica en el mismo sitio. Coste: un reintento emite otro token, y un duplicado invalida el primero (R-M6) |

### 4.5 Plantillas

- Funciones puras `render…(input) → { subject, text, html }` en `mail/templates/`, con el esqueleto HTML y las reglas comunes de UX §5: texto plano y HTML con estilos en línea, **sin imágenes, sin píxeles de seguimiento y sin enlaces que no sean de `PUBLIC_WEB_URL`**. Todo valor interpolado en HTML pasa por `escapeHtml`.
- Enlaces: `${PUBLIC_WEB_URL}/verify-email?token=…` y `${PUBLIC_WEB_URL}/reset-password?token=…`, más `/login` y `/forgot-password` sin token. Se construyen solo con la configuración, nunca con la cabecera `Host` de una petición.
- Pie común de UX §5, con `{soporte}` = `MAIL_SUPPORT_ADDRESS` (decisión 10 del cliente).
- Los plazos (`24 horas`, `1 hora`) salen de las constantes de `contracts`, y `{fecha}` de `formatSpanishDate(unverifiedDeletionAt)` (§7.1); no se escriben en el texto.
- Textos: los de UX §5.1 (confirma tu correo), §5.2 (restablece), §5.3 (aviso, variantes (a), (b) y (c)), §5.4 (recordatorio) y §5.5 (contraseña cambiada). Viven en la API, que es quien envía, no en `texts.ts`.

---

## 5. Flujos de la API

### 5.1 Registro uniforme

`POST /auth/register` (`registerRequestSchema` sin cambios) → **`202` sin cuerpo**, siempre que la petición sea válida:

1. Esquema → 400. Edad: futura → 400 `in_future`; menor → 422 `UNDERAGE`. Versión de condiciones → 409 `TERMS_VERSION_OUTDATED`. Nada de esto lee `users` ni escribe.
2. `PasswordService.hash(password)`, **siempre**, fuera de la transacción.
3. `Transactions.run`:
   - `lockEmail(tx, email)`.
   - ¿Existe en `users.email` (verificada o no) o como `provider_email` verificado de una identidad? (la consulta actual de `assertEmailNotInIdentities`, sin lanzar).
   - **No**: `INSERT users` (`email_verified_at = NULL`) → `ConsentsService.grant(service_use)` → `enqueue('verify_email', email)`.
   - **Sí**: `enqueue('signup_notice', email)`. Nada más: ni contraseña, ni fecha, ni consentimiento.
4. `outbox.kick()` y `202`. **No se crea sesión** en ningún caso.

El `UNIQUE` de `users.email` sigue de red de seguridad: dentro del bloqueo no puede saltar, y si saltara sería un 500, no un `EMAIL_TAKEN`. `EMAIL_TAKEN` deja de salir de esta ruta; se queda en el alta con proveedor (§7.2). En la web, `register` sigue siendo `nonIdempotent`: repetirlo tras un `OUTCOME_UNKNOWN` es inocuo (la segunda vez, como mucho, llega un aviso).

### 5.2 Igualdad de respuesta y de tiempo

| Ruta | Respuesta | Trabajo de la petición, exista o no el correo | Lo que cambia | Residual |
|---|---|---|---|---|
| `POST /auth/register` | `202`, sin cuerpo, mismas cabeceras | Validar, argon2id, transacción con `lockEmail`, dos `SELECT` y un `INSERT` en el *outbox* (con su `fsync`) | Si es nuevo, dos `INSERT` más (`users`, `consents`) | Del orden de 1 ms frente a ~100 ms de argon2 con su variación. El límite por correo (3 cada 24 h) deja tan pocas muestras por dirección que no se puede medir |
| `POST /auth/password-reset/request` | `202` | Validar e `INSERT` en el *outbox* (`reset_password`, correo). **No consulta `users`** | Nada | Ninguno en la petición. El *worker* resuelve después, fuera de la respuesta |
| `POST /auth/email-verification/request` | `202` | Igual, con `verify_email` | Nada | Ninguno |

- Los únicos errores posibles (400 de validación, 422, 409 de versión y 429) dependen solo de la entrada y de los contadores, nunca de que la cuenta exista.
- **Por qué no se rellena el tiempo hasta un mínimo fijo**: retrasaría todos los registros y todos los tests, y la diferencia que taparía ya es inexplotable con el límite por correo. Se descarta también registrar en segundo plano (encolar la petición y crear la cuenta en el *worker*): igualaría el registro al 100 %, a cambio de una tabla más y de cuentas que aparecen con retraso.
- Lo que no se puede igualar: que el dueño del correo recibe un mensaje. Es el objetivo, y el atacante no lo ve.

### 5.3 Pedir el correo de verificación (reenviar)

`POST /auth/email-verification/request` `{ email }`, público → `202` (§5.2). Con sesión, la web envía `locals.user.email`. Si ya había un correo pendiente para esa dirección, no se encola otro. Si se envía, el nuevo token sustituye al anterior: **solo vale el enlace del último correo**. A una cuenta verificada, de proveedor o inexistente no se envía nada.

### 5.4 Comprobar un enlace y confirmar el correo

**Comprobar sin consumir**: `POST /auth/email-tokens/inspection` `{ token, purpose }`, público; lee el `Bearer` si viene. `findLive` con su usuario, comprobando `email_tokens.email = users.email`. Sin fila → 400 `TOKEN_INVALID_OR_EXPIRED`. Con fila → `200 { emailHint, sessionMatches }`: `emailHint` es el correo enmascarado (primera letra, `•••` y el dominio) y `sessionMatches` dice si el `Bearer` es una sesión viva de esa cuenta. No escribe nada ni cuenta intentos. La web la llama al cargar `/verify-email` y `/reset-password`.

**Confirmar**: `POST /auth/email-verification` `{ token, password? }`, público; lee el `Bearer` si viene.

1. `findLive(token, 'verify_email')` con su usuario y la misma comprobación de correo → sin fila, 400 `TOKEN_INVALID_OR_EXPIRED`.
2. **Con la sesión viva de esa misma cuenta**: transacción con `consume` → `markEmailVerified` → `200 { session: 'same' }`. No se crea sesión; `password` se ignora.
3. **Sin ella** (sin sesión o con la de otra cuenta): sin `password` → 400 `VALIDATION_FAILED` `password: required`, y el token sigue vivo. Con `password`, argon2id **fuera** de la transacción:
   - Falla: `UPDATE email_tokens SET failed_attempts = failed_attempts + 1 WHERE … AND failed_attempts < 5 RETURNING`. Con menos de 5, 403 `PASSWORD_INCORRECT`; con el 5.º, se borra el token y 403 `TOKEN_ATTEMPTS_EXCEEDED` (la salida es recuperar la contraseña). Es el patrón de la unión (`pending_identities`).
   - Acierta, **sin sesión**: transacción con `consume` (`… AND failed_attempts < 5`) → `lockUnchangedPassword` (§5.7) → `markEmailVerified` → `SessionsService.create` → `200 { session: 'opened', auth: { user, session } }`. La web pone la cookie.
   - Acierta, **con la sesión de otra cuenta**: lo mismo sin crear sesión → `200 { session: 'kept-other' }`. La sesión del navegador no cambia (decisión 8 del cliente).

`UsersService.markEmailVerified(tx, userId, email)`: `UPDATE users SET email_verified_at = now WHERE id AND email_verified_at IS NULL`, borra los `email_tokens` `verify_email` del usuario y las filas `verify_email` y `verify_reminder` pendientes del *outbox* para ese correo. Lo usan la verificación, la recuperación y la unión.

Límites: confirmar, 20 por IP cada 15 min; comprobar, 30 por IP cada 15 min. **No** se declara el cubo `account`: sin `email` en el cuerpo, `accountTracker` cae en el hash de un `Bearer` vacío y todas las personas sin sesión compartirían un único cubo. Lo mismo en §5.6.

### 5.5 Pedir la recuperación

`POST /auth/password-reset/request` `{ email }`, público → `202` (§5.2). El *worker* envía a cualquier cuenta con ese `users.email`: verificada o no, con o sin contraseña. **Una cuenta solo con proveedor puede crear así su contraseña** (cierra R4 y D12). Por un `provider_email` o un correo sin cuenta no se envía nada.

### 5.6 Restablecer la contraseña

`POST /auth/password-reset` `{ token, password }` (`password` con `newPasswordSchema`):

1. Esquema → 400. `PasswordService.hash(password)` fuera de la transacción.
2. `Transactions.run`:
   1. `consume(token, 'reset_password')` → sin fila, 400 `TOKEN_INVALID_OR_EXPIRED`.
   2. `SELECT … FROM users WHERE id = $1 AND email = token.email FOR UPDATE` → sin fila, 400 `TOKEN_INVALID_OR_EXPIRED` (el `ROLLBACK` devuelve el token, que ya no sirve). Se guarda si `email_verified_at` era `NULL` (`wasUnverified`).
   3. `UPDATE users SET password_hash, updated_at` y, si `wasUnverified`, `data_review_required_at = now` (§5.11). Si no tenía contraseña, se crea.
   4. `markEmailVerified`: abrir el enlace demuestra que el correo es suyo.
   5. Borra las filas `reset_password` pendientes del *outbox* para ese correo (un correo atrasado traería otro token válido).
   6. `revokeAllForUser(tx, userId)`: cierra **todas** las sesiones de la cuenta, y en cascada sus `oauth_states` (reautenticaciones y uniones a medias).
   7. `SessionsService.create(tx, userId)`.
   8. Si `EMAIL_PASSWORD_CHANGED_NOTICE` (por defecto `true`): `enqueue('password_changed', email)`, **en esta misma transacción**. Así sale aunque la cuenta quede pendiente de revisión y nunca se termine (UX §10.1).
3. `kick()` y `200 AuthResponse`, con `user.dataReviewRequired` verdadero si se marcó. La web pone la cookie nueva aunque hubiera la de otra cuenta (decisión 8 del cliente); esa otra sesión no se revoca en el servidor. Log `{ event: 'password_reset_completed', wasUnverified }`.

No toca `identities` ni `pending_identities`. Límite: 10 por IP cada 15 min.

### 5.7 La carrera entre un login y el restablecimiento

Hoy el login verifica el hash (unos 100 ms) y después inserta la sesión. Si el restablecimiento hace `COMMIT` en medio, esa sesión, creada con la contraseña vieja, sobrevive al cierre de todas. Se cierra con `UsersService.lockUnchangedPassword(tx, userId, verifiedHash)`, dentro de la misma transacción que crea la sesión:

- Sin *rehash*: `SELECT 1 FROM users WHERE id = $1 AND password_hash = $2 FOR SHARE`.
- Con *rehash*: `UPDATE users SET password_hash = $nuevo WHERE id = $1 AND password_hash = $2 RETURNING`, que sustituye a la actualización suelta de hoy.

Si no devuelve fila, la contraseña cambió entre medias: el login responde 401 `INVALID_CREDENTIALS`, y la unión y la verificación 403 `PASSWORD_INCORRECT`. `FOR SHARE` espera al `FOR UPDATE` del restablecimiento y, tras su `COMMIT`, vuelve a evaluar la condición con el hash nuevo. Se aplica en `AuthService.login`, `PendingIdentitiesService.link` y §5.4.

### 5.8 `emailVerified` en la sesión y en `/users/me`

- `publicUserSchema` añade `emailVerified: boolean`, así que llega en `POST /auth/login`, `GET /auth/session`, las respuestas de OAuth, §5.4 y §5.6. `SessionsService.validate` selecciona `users.email_verified_at`, y `ActiveSession.user` lo lleva. La unión, que hoy construye el usuario a mano, pasa a usar `toPublicUser`.
- `accountResponseSchema.user` añade `emailVerifiedAt` (`datetime | null`) y `unverifiedDeletionAt` (`created_at + 7 días` si no está verificada; si no, `null`).
- `GET /config` (pública, con `X-Internal-Api-Key` y sin sesión; la añade el cambio de edad mínima) añade `mail: { unverifiedReminder: boolean, passwordChangedNotice: boolean }`, leídos de la configuración de la API. La web los toma de su caché de configuración (60 s) para decidir si pinta `correo.texto.recordatorio` y `restablecer.aviso.correo_enviado` (UX §6.9). Un cambio de estas variables exige reiniciar la API y tarda como mucho 60 s en verse en la web.
- La web guarda `emailVerified` en `locals.user` para la banda de la cabecera (UX §3.7).

### 5.9 Guard `@RequiresVerifiedEmail()`

- Decorador en `common/decorators/requires-verified-email.decorator.ts`, con `SetMetadata`.
- `VerifiedEmailGuard`, global, **después** de `SessionGuard` (clave interna → límites → sesión → correo verificado). Si la ruta no lleva el metadato o es `@Public()`, deja pasar. Si `request.session.user.emailVerified` es falso → 403 `EMAIL_NOT_VERIFIED`.
- Uso en este hito: `POST /users/me/oauth/:provider/authorization` (§5.10). En H1 lo llevarán la entrevista, las recomendaciones y el chat.

### 5.10 Cuentas con proveedor, unión y añadir proveedor

| Caso | Regla |
|---|---|
| Alta con proveedor (`PendingIdentitiesService.signup`) | Nace con `email_verified_at = now`: el correo es el del proveedor y es verificado (Google: el *claim*; Facebook: por política, R1) |
| Unión con contraseña (`link`) | Si `pending.emailVerified` y `pending.providerEmail = users.email` (siempre, por construcción), `markEmailVerified` dentro de la transacción de la unión. Quien une sabe la contraseña y el proveedor certifica el correo |
| Añadir un proveedor desde `/account` | `@RequiresVerifiedEmail()` en `POST /users/me/oauth/:provider/authorization`. Con el correo sin verificar → 403 `EMAIL_NOT_VERIFIED`. En la práctica solo afecta a `connect`: una cuenta sin verificar siempre tiene contraseña (la CHECK de §3.1), así que no usa `create_password`, y no tiene proveedores con los que reautenticarse |
| Crear contraseña (decisión 21) | Sin cambios: solo cuentas sin contraseña, que siempre están verificadas |

### 5.11 Revisión de datos tras recuperar una cuenta sin verificar (decisión 12 del cliente)

Una cuenta con el correo sin verificar puede ser de su dueño, que no llegó a confirmar, o de un ocupante. Al restablecer la contraseña no se pueden distinguir, así que quien entra revisa los datos que escribió quien creó la cuenta: la fecha de nacimiento y la aceptación de las condiciones.

**La marca** es la columna `users.data_review_required_at` (§3.1). No se puede derivar: tras el restablecimiento la cuenta está verificada y nada más la distingue de otra. La pone solo §5.6 cuando `email_verified_at` era `NULL`. La confirmación con contraseña y la unión no la ponen: las hace quien sabe la contraseña, es decir, quien creó la cuenta.

**Quitarla**: `POST /users/me/data-review` `{ birthDate, acceptTerms: true, termsVersion }` (sesión), en el orden del alta (H0 §8.5):

1. Esquema (`dataReviewRequestSchema`) → 400.
2. `checkBirthDate(birthDate, referenceToday(clock.now()), minAge)`, **antes de leer nada**, con la misma regla y **la misma edad mínima configurada (`MIN_AGE`, 18 por defecto, de 18 a 25)** que el alta (Europe/Madrid, 29 de febrero incluido). La revisión es una declaración nueva, así que se aplica el `MIN_AGE` vigente, no el que había cuando se creó la cuenta; las cuentas que no pasan por la revisión se respetan aunque `MIN_AGE` suba. Futura → 400 `in_future`. **Menor** → `DELETE FROM users WHERE id = $1 AND data_review_required_at IS NOT NULL` (cascada de siempre) y 422 `UNDERAGE`. Como en el alta, un menor no tiene cuenta y su fecha no se guarda ni se registra. Si la fila ya no estaba pendiente, el `DELETE` no borra nada y responde igual.
3. `termsVersion` distinto de `SERVICE_TERMS_VERSION` → 409 `TERMS_VERSION_OUTDATED`.
4. `Transactions.run`: `SELECT … FROM users WHERE id = $1 AND data_review_required_at IS NOT NULL FOR UPDATE` → sin fila, 404 `NOT_FOUND` (esta ruta no sirve para cambiar la fecha cuando no hay revisión pendiente) → `UPDATE users SET birth_date, data_review_required_at = NULL, updated_at` → `ConsentsService.revoke(service_use)` y `grant(service_use, termsVersion)`, con `granted_at` del `Clock`. La fila anterior queda con `revoked_at` como histórico.
5. `204`. Log `{ event: 'data_review_completed' }`, sin la fecha.

La persona escribe la fecha de nuevo; puede coincidir con la guardada o no. Límite: 10 por sesión cada 15 min (conjunto `session`).

**Bloqueo**: `DataReviewGuard`, global, el último (clave interna → límites → sesión → correo verificado → revisión). Con sesión y `request.session.user.dataReviewRequired`, toda ruta sin `@AllowDuringDataReview()` responde 403 `DATA_REVIEW_REQUIRED`. Es una lista blanca: las rutas nuevas (H1) quedan bloqueadas sin hacer nada. Llevan el decorador `GET /auth/session`, `POST /auth/logout`, `GET /users/me`, `POST /users/me/data-review` y `POST /users/me/deletion` (quien no quiera la cuenta puede borrarla). Las rutas `@Public()` no se ven afectadas. `SessionsService.validate` selecciona la columna y `ActiveSession.user` lleva `dataReviewRequired`.

**En la web**: `guardRoutes` redirige con 303 a `/account/review` a quien tenga `locals.user.dataReviewRequired`, salvo en `/account/review`, `/account/delete`, `/legal/terms`, `/verify-email`, `/forgot-password` y `/reset-password`. `/account/review` (privada) tiene su propia acción `logout`. Tras restablecer, si `dataReviewRequired`, la web va a `/account/review?notice=password-reset` en vez de a `/account`. **La fecha de nacimiento sale vacía** (decisión del CTO, UX §3.10): la guardada puede ser de otra persona, así que la web no la pide a la API ni la pinta. Con un menor, la acción **sí** llama a la API (hay una cuenta que borrar), borra la cookie de sesión y pinta la pantalla de cierre de UX §3.10 sin valores (acuerdo A3). Con `204` → `/account?notice=details-reviewed`.

---

## 6. Ocupación de correo (R7b) y correos únicos

### 6.1 Cómo cuenta un correo sin verificar

- **`users.email` sin verificar ocupa su correo igual que uno verificado**: lo impone el `UNIQUE` y no hay forma limpia de tener dos cuentas con el mismo correo. Bloquea el registro (que avisa al dueño), el alta con proveedor (que pasa a unión, porque tiene contraseña) y `connect` desde otra cuenta (`connect_refused`).
- La salida para el dueño real es inmediata, recuperar la contraseña, o automática, el borrado a los 7 días.
- Un `provider_email` sin verificar **no** ocupa nada (decisión 21, sin cambios). La asimetría es a propósito: el proveedor sin verificar no tiene dueño comprobable, y la cuenta con contraseña tiene una salida (la recuperación).

### 6.2 Un ocupante frente al dueño real

Un atacante registra `ana@x` con su contraseña y no puede verificarlo (no tiene el buzón). Ana:

| Lo que hace Ana | Qué pasa |
|---|---|
| Recibe «Confirma tu correo» (y el recordatorio) de una cuenta que no creó | Los correos dicen «si no la has creado, no hagas nada». Si pulsa el enlace, se le pide la contraseña, que no sabe: no puede confirmar la cuenta del ocupante (K3) |
| Intenta registrarse | `202` como siempre; recibe el aviso, variante (b): «hay una cuenta sin confirmar con tu correo; si no es tuya, recupera la contraseña para quedártela, o se borrará el día X» |
| «¿Olvidaste tu contraseña?» | Recibe el enlace (la cuenta existe). Al fijar su contraseña: el correo queda verificado, **todas las sesiones del ocupante se cierran**, entra ella y la cuenta queda pendiente de revisar datos (§5.11). El ocupante ya no sabe la contraseña y no tiene ninguna identidad unida (K7) |
| Entra con Google (`ana@x` verificado) | Caso 6 de terceros §6: `link_required`. `/login/link` pide la contraseña de la cuenta, que no sabe, y ofrece «¿Olvidaste tu contraseña?». `GET /auth/oauth/pending` devuelve `accountEmailVerified: false` para que UX lo explique. Si la recupera, la siguiente entrada con Google vuelve a dar `link_required`, y ya puede unir con su contraseña nueva |
| No hace nada | A los 7 días la cuenta se borra y `ana@x` queda libre. Las sesiones del ocupante desaparecen en cascada |

Qué no puede hacer el ocupante mientras tanto: añadir un proveedor (K7), usar las funciones sociales de H1 (decisión 1) ni confirmar el correo. Sí puede entrar y ver `/account`.

**Lo que escribió el ocupante** (fecha de nacimiento y aceptación de las condiciones) no lo hereda Ana: al recuperar la cuenta queda pendiente de revisión (§5.11) y no puede hacer nada más hasta confirmar o corregir la fecha y aceptar ella las condiciones.

### 6.3 Recordatorio y borrado de cuentas sin verificar

- **Borrado a los 7 días** desde `users.created_at`. Es suficiente para quien tarda en abrir el correo (se puede reenviar), corto para un ocupante, y la cuenta sin verificar no tiene datos que perder (no hay funciones sociales). Es también la salida de quien escribió mal su correo (decisión 7 del cliente).
- **Recordatorio el 5.º día** (`UNVERIFIED_REMINDER_AFTER_DAYS = 5`, dos días antes del borrado), si `EMAIL_UNVERIFIED_REMINDER` está activo (por defecto, `true`). Es un `verify_reminder`: lleva un enlace nuevo, que sustituye al anterior, y la fecha de borrado. Se envía como mucho una vez por cuenta.
- `UnverifiedAccountsSweeper` (en `UsersModule`), cada hora:
  1. Borrado: `DELETE FROM users WHERE id IN (SELECT id FROM users WHERE email_verified_at IS NULL AND created_at <= now - 7 días LIMIT 100)`, repetido mientras borre 100. Usa el índice parcial de §3.1 y la cascada de siempre. Log `{ event: 'unverified_accounts_deleted', count }`.
  2. Recordatorio, si está activo, en una transacción: `UPDATE users SET verification_reminded_at = now WHERE email_verified_at IS NULL AND verification_reminded_at IS NULL AND created_at <= now - 5 días AND created_at > now - 7 días RETURNING email`, y por cada una `INSERT` en el *outbox* (`verify_reminder`). Como no importa `MailModule`, no llama a `kick()`: el *worker* lo recoge en su ciclo de 30 s.
  - Como la limpieza de OAuth, no arranca su temporizador en `NODE_ENV=test`; los tests llaman a `sweep()`.
- Carrera con una verificación: el `DELETE` vuelve a evaluar `email_verified_at IS NULL` sobre la fila bloqueada (READ COMMITTED), así que una cuenta verificada justo antes no se borra; y si se borra antes, el token desaparece en cascada y la verificación da `TOKEN_INVALID_OR_EXPIRED`.
- La fecha de borrado se ve en `/account`, en los dos correos de verificación y en el aviso (b), siempre como `formatSpanishDate(unverifiedDeletionAt)`: el día en Europe/Madrid («18 de noviembre de 2026»). La cuenta no se borra antes de ese instante.

---

## 7. Contratos

### 7.1 `packages/contracts`

```ts
// auth.ts
export const EMAIL_VERIFICATION_TTL_HOURS = 24;
export const PASSWORD_RESET_TTL_MINUTES = 60;
export const UNVERIFIED_ACCOUNT_TTL_DAYS = 7;
export const UNVERIFIED_REMINDER_AFTER_DAYS = 5;
export const EMAIL_TOKEN_MAX_FAILURES = 5;
export const EMAIL_TOKEN_PURPOSES = ['verify_email', 'reset_password'] as const;

export const opaqueTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);   // oauth.ts pasa a importarlo

/** «18 de noviembre de 2026»: el día del instante en Europe/Madrid (Intl, es-ES). Lo usan los correos y la web. */
export function formatSpanishDate(instant: Date | string): string;

// La respuesta de GET /config (cambio de edad mínima: { minAge }) añade la configuración de los correos opcionales (UX §6.9)
//   mail: z.object({ unverifiedReminder: z.boolean(), passwordChangedNotice: z.boolean() })
// checkBirthDate, isAdultOn y latestAdultBirthDate reciben minAge (cambio de edad mínima); aquí se usan así

export const publicUserSchema = z.object({
  id: z.uuid(), email: z.string(), createdAt: z.iso.datetime(),
  emailVerified: z.boolean(),                                               // nuevo (fase B)
  dataReviewRequired: z.boolean(),                                          // nuevo (fase C)
});

// POST /auth/email-verification/request y POST /auth/password-reset/request → 202 sin cuerpo
export const emailRequestSchema = z.strictObject({ email: emailSchema }, { error: strictObjectError });

export const emailTokenInspectionRequestSchema = z.strictObject(
  { token: opaqueTokenSchema, purpose: z.enum(EMAIL_TOKEN_PURPOSES) }, { error: strictObjectError });
export const emailTokenInspectionResponseSchema = z.object({
  emailHint: z.string(),           // «p•••@ejemplo.com»
  sessionMatches: z.boolean(),     // el Bearer es una sesión viva de la cuenta del enlace
});

export const emailVerificationRequestSchema = z.strictObject(
  { token: opaqueTokenSchema, password: passwordInputSchema.optional() }, { error: strictObjectError });
export const emailVerificationResponseSchema = z.discriminatedUnion('session', [
  z.object({ session: z.literal('same') }),
  z.object({ session: z.literal('kept-other') }),
  z.object({ session: z.literal('opened'), auth: authResponseSchema }),
]);

export const passwordResetSchema = z.strictObject(
  { token: opaqueTokenSchema, password: newPasswordSchema }, { error: strictObjectError });
// respuesta: authResponseSchema

// users.ts (fase C): POST /users/me/data-review → 204
export const dataReviewRequestSchema = z.strictObject({
  birthDate: birthDateSchema,
  acceptTerms: z.literal(true, { error: 'required' }),
  termsVersion: /* el de registerRequestSchema */,
}, { error: strictObjectError });

// users.ts: accountResponseSchema.user añade
//   emailVerifiedAt: z.iso.datetime().nullable(), unverifiedDeletionAt: z.iso.datetime().nullable()

// oauth.ts: pendingIdentityResponseSchema añade
//   accountEmailVerified: z.boolean().optional()     // solo con kind = 'link'
```

`POST /auth/register` deja de tener esquema de respuesta: la web lo llama con `expectStatus: 202`, igual que el borrado con 204. Un token con otro formato da 400 `VALIDATION_FAILED` en el esquema, no `TOKEN_INVALID_OR_EXPIRED`; la web los trata igual (UX §1.4).

### 7.2 Códigos de error

| Código | HTTP | Cuándo |
|---|---|---|
| `TOKEN_INVALID_OR_EXPIRED` | 400 | Token de correo inexistente, caducado, ya usado, del otro propósito o de un correo que ya no es el de la cuenta |
| `TOKEN_ATTEMPTS_EXCEEDED` | 403 | 5.º fallo de contraseña al confirmar el correo; el token ya no existe |
| `EMAIL_NOT_VERIFIED` | 403 | Ruta con `@RequiresVerifiedEmail()` y correo sin verificar |
| `DATA_REVIEW_REQUIRED` | 403 | Cuenta pendiente de revisar datos y ruta sin `@AllowDuringDataReview()` (fase C) |

`EMAIL_TAKEN` se queda en `ERROR_CODES` (alta con proveedor, carrera de terceros §7). En la web se quitan `registro.error.correo_existente` y `errorMessages.register.EMAIL_TAKEN` (UX §7). `messages.ts` debe cubrir los tres nuevos (W-1).

### 7.3 *Endpoints*

Todos con `X-Internal-Api-Key`. Los límites se multiplican por `RATE_LIMIT_FACTOR`.

| Método y ruta | Sesión | Entrada | Éxito | Errores | Límite |
|---|---|---|---|---|---|
| `POST /auth/register` (cambia) | — | `RegisterRequest` | `202` | 400, 409 `TERMS_VERSION_OUTDATED`, 422, 429 | 5 por IP y hora (como hoy) + **3 por correo cada 24 h** |
| `POST /auth/email-verification/request` | — | `{ email }` | `202` | 400, 429 | 5 por IP cada 15 min + 5 por correo cada 24 h |
| `POST /auth/email-tokens/inspection` | Lee `Bearer` si viene | `{ token, purpose }` | `200 { emailHint, sessionMatches }` | 400, 400 `TOKEN_INVALID_OR_EXPIRED`, 429 | 30 por IP cada 15 min |
| `POST /auth/email-verification` | Lee `Bearer` si viene | `{ token, password? }` | `200 EmailVerificationResponse` | 400, 400 `TOKEN_INVALID_OR_EXPIRED`, 403 `PASSWORD_INCORRECT`/`TOKEN_ATTEMPTS_EXCEEDED`, 429 | 20 por IP cada 15 min |
| `POST /auth/password-reset/request` | — | `{ email }` | `202` | 400, 429 | 5 por IP cada 15 min + 5 por correo cada 24 h |
| `POST /auth/password-reset` | — | `{ token, password }` | `200 AuthResponse` | 400, 400 `TOKEN_INVALID_OR_EXPIRED`, 429 | 10 por IP cada 15 min |
| `POST /users/me/oauth/:provider/authorization` (cambia) | S + correo verificado | igual | igual | + 403 `EMAIL_NOT_VERIFIED` | igual |
| `POST /users/me/data-review` (fase C) | S (permitida durante la revisión) | `{ birthDate, acceptTerms, termsVersion }` | `204` | 400, 401, 404 (nada pendiente), 409 `TERMS_VERSION_OUTDATED`, 422 `UNDERAGE` (la cuenta se ha borrado), 429 | 10 por sesión cada 15 min |
| Cualquier otra ruta con sesión (fase C) | S | — | — | + 403 `DATA_REVIEW_REQUIRED` si la cuenta está pendiente | — |

**Límite por correo**: un cuarto conjunto del *throttler*, `email` (`EMAIL_THROTTLER`), opcional por ruta como `account` y `session`, con un cubo **por ruta** (la `generateKey` por defecto) y como *tracker* el correo normalizado del cuerpo (`email:<correo>`, o `email:none` si falta, que el esquema rechazará después). Se aplica igual exista o no la cuenta, así que un 429 no revela nada. Va por ruta y no compartido para que nadie pueda bloquear la recuperación de otra persona enviando registros con su correo. Es en memoria, como el resto (R5 de H0).

Lo que protege del abuso, además: la deduplicación del *outbox* (un pendiente por tipo y dirección) y que cada envío sustituye al token anterior. Por una dirección pueden salir como mucho 3 avisos de registro, 5 correos de recuperación y 5 de verificación al día, más el recordatorio y el aviso de contraseña cambiada, que no dependen de nadie de fuera.

---

## 8. Configuración, Mailpit y scripts

### 8.1 Variables nuevas en `envSchema`

```ts
SMTP_URL: optional(z.url({ protocol: /^smtps?$/ })),        // smtp://usuario:clave@host:587 o smtps://…:465
MAIL_FROM: z.string().default('Cupidilla <no-reply@example.com>'),
MAIL_SUPPORT_ADDRESS: z.email().default('soporte@example.com'),   // buzón de contacto del pie
PUBLIC_WEB_URL: z.url({ protocol: /^https?$/ }),             // sustituye a OAUTH_REDIRECT_BASE_URL (K8)
EMAIL_UNVERIFIED_REMINDER: booleanFlag.default(true),         // 'true' | 'false'
EMAIL_PASSWORD_CHANGED_NOTICE: booleanFlag.default(true),
```

`booleanFlag` acepta solo `'true'` y `'false'` (como `API_URL_ALLOW_HTTP` en la web); cualquier otro valor impide arrancar. Reglas del `superRefine` (el error nombra la variable y nunca muestra su valor, que puede llevar la clave SMTP):

- `SMTP_URL` es obligatoria salvo con `NODE_ENV=test`. Sin ella y con `test`, `MailModule` usa `MemoryMailer`; con ella, siempre `SmtpMailer`.
- `smtpTransportOptions`: `smtps:` → `secure: true` (TLS implícito, puerto 465 por defecto); `smtp:` → puerto 587 por defecto y **`requireTLS: true` si el *host* no es *loopback*** (STARTTLS obligatorio; sin él, falla en vez de enviar en claro). `tls.rejectUnauthorized` se queda en `true`. Usuario y clave salen de la URL, decodificados.
- `MAIL_FROM`: una dirección válida (`z.email()`), sola o con nombre (`Nombre <dirección>`).
- `PUBLIC_WEB_URL`: obligatoria; solo el origen (sin ruta, barra final ni consulta) y `https:` salvo en *loopback*, con las reglas que hoy tiene `OAUTH_REDIRECT_BASE_URL`. La *redirect URI* de OAuth pasa a construirse con ella. En producción tiene que coincidir con `ORIGIN` de SvelteKit.
- **En producción** (decisión 10 del cliente): `SMTP_URL` no puede apuntar a *loopback*, y el dominio de `MAIL_FROM` y de `MAIL_SUPPORT_ADDRESS` no puede ser un dominio reservado para ejemplos o pruebas (`example.com`, `example.net`, `example.org` y sus subdominios, ni los TLD `.example`, `.test`, `.invalid` y `.localhost`). Los valores por defecto existen para que desarrollo y tests arranquen sin configurar nada; en producción hay que escribir los reales.
- Si el entorno trae `OAUTH_REDIRECT_BASE_URL`, la API no arranca: «OAUTH_REDIRECT_BASE_URL ya no existe: usa PUBLIC_WEB_URL». Así un `.env` antiguo no falla en silencio.

### 8.2 `docker-compose.yml`

```yaml
  mail:
    image: axllent/mailpit:v1.32.0
    environment:
      MP_MAX_MESSAGES: 500
      TZ: UTC
    ports:
      - '127.0.0.1:${MAILPIT_SMTP_PORT:-1025}:1025'
      - '127.0.0.1:${MAILPIT_HTTP_PORT:-8025}:8025'
```

Usa el `HEALTHCHECK` de la imagen, así que `docker compose up -d --wait mail` espera a que esté sano. Solo escucha en `127.0.0.1`. Sin volumen: los correos de desarrollo se pierden al recrear el contenedor, y está bien así.

### 8.3 Scripts y `.env.example`

| Script (raíz) | Cambio |
|---|---|
| `mail:up` | Nuevo: `docker compose up -d --wait mail` |
| `dev` | `npm run db:up && npm run mail:up && …` |
| `test:e2e` | `npm run mail:up && npm run build:contracts && …` |
| `db:reset` | Sin cambios (solo la base de datos) |

```sh
# Origen público de la web, sin barra final. Base de los enlaces de los correos y de la redirect URI de OAuth
PUBLIC_WEB_URL=http://localhost:5173
# Correo (API). En local, Mailpit de docker compose; bandeja en http://localhost:8025
SMTP_URL=smtp://127.0.0.1:1025
# En producción, direcciones reales (example.com no vale)
# MAIL_FROM="Cupidilla <no-reply@example.com>"
# MAIL_SUPPORT_ADDRESS=soporte@example.com
# Recordatorio antes de borrar una cuenta sin confirmar y aviso de contraseña cambiada
# EMAIL_UNVERIFIED_REMINDER=true
# EMAIL_PASSWORD_CHANGED_NOTICE=true
# MAILPIT_SMTP_PORT=1025
# MAILPIT_HTTP_PORT=8025
```

Se quita `OAUTH_REDIRECT_BASE_URL`. La web no necesita variables nuevas.

---

## 9. Web (SvelteKit)

### 9.1 Rutas

Las de UX §2.1, con estos detalles técnicos:

| Ruta | Qué hace |
|---|---|
| `/register` (cambia) | Con `202`: pone `cupidilla_pending_email` y 303 a `/register/check-email`. Sin cookie de sesión y sin el correo en la URL. Se quita la rama `EMAIL_TAKEN` |
| `/register/check-email` | Lee el correo de la cookie. Acción `resend` → `POST /auth/email-verification/request` → 303 `?notice=resent` |
| `/verify-email` | `load`: con `?token=` de forma válida, guarda el token en `cupidilla_email_token` (`path=/verify-email`) y 303 a `/verify-email` sin consulta. Después, `POST /auth/email-tokens/inspection` (con el `Bearer` si hay sesión): inválido → estado «Este enlace ya no sirve» con 410; válido → el botón, y el campo de contraseña si `sessionMatches` es falso (K3). Acción `confirm` → `POST /auth/email-verification`: `same` → `/account?notice=email-verified`; `opened` → cookie de sesión y `/account?notice=email-verified-signin`; `kept-other` → `/account?notice=email-verified-other`. Con `TOKEN_INVALID_OR_EXPIRED` → 303 `/verify-email?error=token-invalid` |
| `/forgot-password` | Campo `email` → `POST /auth/password-reset/request` → cookie `cupidilla_pending_email` y 303 `/forgot-password/check-email` |
| `/forgot-password/check-email` | Acción `resend` → otra vez `POST /auth/password-reset/request` → 303 `?notice=resent` |
| `/reset-password` | El mismo paso por la cookie (`path=/reset-password`) y la misma comprobación (`emailHint` para UX §3.5). Campo `password` (`autocomplete="new-password"`) → `POST /auth/password-reset` → cookie de sesión nueva (sustituye a la que hubiera) → 303 `/account?notice=password-reset` |
| `/login`, `/login/link` | Enlace «¿Olvidaste tu contraseña?» (UX §3.8, §3.9) |
| `/account/review` (fase C) | `(private)`. Si no hay revisión pendiente, 303 `/account`. Fecha de nacimiento **vacía** (UX §3.10), casilla de condiciones desmarcada y `termsVersion` oculto. Acciones `review` y `logout` (§5.11) |
| `/account` | Sección y estado del correo con `unverifiedDeletionAt`. Acción `resendVerification`: si `locals.user.emailVerified` ya es verdadero, 303 `?notice=verification-already` sin llamar a la API; si no, `POST /auth/email-verification/request` con `locals.user.email` → `?notice=verification-sent`. «Añadir proveedor» según UX (K7) |

- **Cookie del token** `cupidilla_email_token`: `httpOnly`, `SameSite=Lax`, `Secure` fuera de `dev`, la ruta de su página y 60 min. Se borra al terminar y con `TOKEN_INVALID_OR_EXPIRED`. Saca el token de la URL **antes** de pintar nada: no queda en el historial, ni en capturas, ni en un `Referer`. Un escáner que hace GET solo consigue una cookie en su propio navegador y una consulta que no escribe nada.
- **Cookie del correo pendiente** `cupidilla_pending_email` (UX §2.3): `httpOnly`, `SameSite=Lax`, `Secure` fuera de `dev`, `path=/`, 1 h, valor `signup:<correo>` o `reset:<correo>` codificado. Se pone siempre que el formulario es válido, exista o no la cuenta, y se borra al entrar, al confirmar con `opened` y al restablecer. Manipularla solo permite reenviar a otra dirección, lo mismo que escribirla en el formulario.
- `/verify-email`, `/forgot-password` y `/reset-password` van **fuera** de `(guest)`; `/register/check-email` está dentro (con sesión → `/account`) y `/forgot-password/check-email` fuera, como dice UX.
- `hooks.server.ts` (`securityHeaders`): `Referrer-Policy: no-referrer` y `X-Robots-Tag: noindex` en `/verify-email` y `/reset-password`; `Cache-Control: no-store` en esas dos y en las de «Revisa tu correo».
- La configuración de los correos opcionales sale de la caché de `GET /config` de la web (§5.8), igual que `{edad}`.
- `locals.user` añade `emailVerified` y `dataReviewRequired`; `+layout.server.ts` pasa el primero para la banda de la cabecera, y `guardRoutes` usa el segundo (§5.11).
- `api-client.ts`: `register` (`expectStatus: 202`, `nonIdempotent`), `requestEmailVerification` y `requestPasswordReset` (`expectStatus: 202`), `inspectEmailToken`, y `verifyEmail` y `resetPassword` (`nonIdempotent`: un `OUTCOME_UNKNOWN` pide comprobar, porque el token ya puede estar consumido).
- CSP sin cambios: no hay recursos externos.

### 9.2 Avisos

Las listas cerradas de UX §6.9, más `details-reviewed` en `/account` y `password-reset` en `/account/review` (fase C): `/account` (`email-verified`, `email-verified-signin`, `email-verified-other`, `password-reset`, `verification-sent`, `verification-already`; errores `rate-limited`, `verification-failed`), las dos de «Revisa tu correo» (`resent`; `rate-limited`, `resend-failed`) y `error=token-invalid` en `/verify-email` y `/reset-password`.

---

## 10. Amenazas y riesgos

| # | Amenaza o riesgo | Qué lo cubre |
|---|---|---|
| R-M1 | **Escáneres de enlaces** del correo (Outlook, antivirus) que abren los GET | El GET no consume nada: pone una cookie, redirige y consulta sin escribir. Consumir es un POST que además pide la contraseña (verificación sin la sesión de la cuenta) o una contraseña nueva (recuperación) |
| R-M2 | **`Referer`, historial y registros** con el token | Paso por la cookie (§9.1), `no-referrer`, ninguna petición a terceros (CSP). **Vigilar en producción**: el *proxy* no debe registrar la consulta de `/verify-email` y `/reset-password` (o registrar sin consulta). Los logs de la API y de la web ya no registran URLs (H0 §8.9) |
| R-M3 | **Ocupación y pre-secuestro** de cuentas: el ocupante registra el correo ajeno y espera | §6: la verificación pide la contraseña sin la sesión de la cuenta (K3), no se puede añadir un proveedor sin verificar (K7), la recuperación cierra todas las sesiones y verifica, la revisión de datos impide heredar la fecha y la aceptación del ocupante (§5.11), y el borrado a los 7 días. **Residual**: el dueño que simplemente no llegó a confirmar también tiene que revisar sus datos una vez |
| R-M4 | **Enumeración** | §5.2. El login no cambia. La comprobación de un enlace solo responde a quien tiene el token (el buzón). La unión con proveedor ya revela la cuenta al dueño acreditado del correo (terceros §6). El aviso de registro solo llega al buzón |
| R-M5 | **Spam y acoso** a una dirección vía registro, recuperación o reenvío | Límites por IP y por correo (§7.3), deduplicación en el *outbox*. Una red de bots podría escribir a muchas direcciones distintas: la mitigación es la beta por invitación (decisión abierta) y, si hiciera falta, un tope global de envíos por hora en el *worker* o un captcha |
| R-M6 | **Duplicados** si la API muere tras enviar y antes de borrar la fila | Concesión de 2 min; el reenvío emite otro token y el primero deja de valer. Raro y sin riesgo |
| R-M7 | **SMTP caído** | Las respuestas HTTP no dependen de él. Reintentos durante ~8 h; después `failed_at` y log de nivel error `mail_failed`. Hace falta una alerta sobre ese log antes de la beta |
| R-M8 | **Fijación de sesión** | La verificación con `opened` y la recuperación crean siempre un token de sesión nuevo; la recuperación cierra antes todas las de la cuenta. Las cookies del token y del correo pendiente no son sesiones |
| R-M9 | **Login con la contraseña vieja a la vez que se restablece** | §5.7 (K10) |
| R-M10 | **Inyección de cabecera `Host`** en los enlaces | Se construyen solo con `PUBLIC_WEB_URL` |
| R-M11 | **Buzón comprometido** | Inherente a la recuperación por correo: quien controla el buzón controla la cuenta. TTL cortos y un solo uso. El aviso de contraseña cambiada llega al mismo buzón, así que no lo detecta; sí detecta un restablecimiento hecho con un buzón ajeno reenviado. Fuera de alcance: segundo factor |
| R-M12 | **Base de datos filtrada** | Solo hashes de tokens. El *outbox* tiene correos y tipos, sin secretos, y vive poco (§3.5) |
| R-M13 | **Logs** | Nunca: token, enlace, `to_email`, `emailHint`, la respuesta del servidor SMTP, la URL del SMTP (lleva la clave) ni la contraseña. Eventos sin identificadores: `mail_sent`, `mail_skipped`, `mail_retry` y `mail_failed` (`{ kind, code, attempt }`), `email_verified` (`{ method: 'token' \| 'oauth_link' \| 'password_reset' }`), `password_reset_completed`, `unverified_reminders_enqueued`, `unverified_accounts_deleted` y `data_review_completed` |
| R-M14 | **Correo de Facebook verificado por política** (R1 de terceros): las altas con Facebook nacen verificadas sin comprobación propia | Confirmado por el CTO el 14 de noviembre. Una verificación propia para Facebook chocaría con §5.4 (esas cuentas no tienen contraseña) y obligaría a abrir la CHECK de §3.1 |
| R-M15 | **Entregabilidad en producción**: sin SPF, DKIM y DMARC del dominio de `MAIL_FROM`, los correos van a spam | Pendiente y no bloqueante: el proveedor SMTP y el dominio se deciden antes del despliegue, con «Marca y dominio» (decisión 13 del cliente). Tiene que ser encargado del tratamiento con servidores en la UE. Mailpit no lo prueba |
| R-M16 | El *throttler* en memoria (R5 de H0) | Se pierde al reiniciar. El tope de intentos de la verificación está en PostgreSQL |

---

## 11. Pruebas

### 11.1 Integración (Vitest, `MemoryMailer` y `FakeClock`)

- `vitest.config.ts` (proyecto `integration`): sin `SMTP_URL` y con `PUBLIC_WEB_URL=http://localhost:5173`; `MAIL_FROM` y `MAIL_SUPPORT_ADDRESS` con sus valores por defecto. Con `NODE_ENV=test`, `MailModule` elige `MemoryMailer` y el *worker* no arranca su temporizador.
- `test/helpers/mail.ts`: `deliverMail(app)` (llama a `OutboxWorker.drain()`), `inbox(app)` (el `MemoryMailer`) y `linkTo(app, email, '/verify-email')`, que devuelve el token.
- `registerUser(app, { verified = true })` cambia: registra (`202`) y entrega el correo. Con `verified`, confirma con la contraseña y usa la sesión de `opened`; si no, hace login. Devuelve lo mismo que hoy, así que las pruebas existentes no cambian. Las que añaden un proveedor necesitan la cuenta verificada (K7), que es el valor por defecto.
- `truncateAll` ya vacía las tablas nuevas. `MemoryMailer.clear()` en `beforeEach`.

### 11.2 E2E con Mailpit

- Mailpit es el de `docker compose`, compartido con `npm run dev` (puertos fijos 1025 y 8025). Las pruebas no se pisan porque cada una usa un destinatario único (`e2e+<uuid>@example.com`) y busca solo ese.
- `playwright.config.ts`: la API de e2e recibe `SMTP_URL=smtp://127.0.0.1:${MAILPIT_SMTP_PORT ?? 1025}` y `PUBLIC_WEB_URL=http://localhost:4173` (que sustituye a `OAUTH_REDIRECT_BASE_URL` en `OAUTH_E2E_ENV`). El *worker* corre de verdad y `kick()` envía al momento. `helpers/stack.ts` pasa las mismas variables a sus pilas.
- `globalSetup` comprueba `GET /api/v1/info` y, si Mailpit no responde, falla con «levanta Mailpit: npm run mail:up».
- `tests/e2e/helpers/mailpit.ts`:
  - `waitForMail(to, { subject?, timeoutMs = 10_000 })`: sondea `GET /api/v1/search?query=to:"<to>"` cada 200 ms.
  - `linkIn(message, path)`: lee `GET /view/{ID}.txt` y extrae `http://localhost:4173<path>?token=…`.
  - `clearMailTo(to)`: `DELETE /api/v1/search?query=to:"<to>"`.
- `registerAdult(page, { verified = true })`: registro, correo, enlace y contraseña → `/account`. Con `verified: false`, registro y login.
- Base de datos `cupidilla_e2e` sin cambios: se resetea y migra al arrancar la API de e2e.

### 11.3 Escenarios

Los criterios de hecho y los casos clave están en el plan, dentro de cada tarea, como escenarios Dado-Cuando-Entonces (decisión 14 del cliente). Cada escenario es una prueba automática, salvo los marcados **(QA)**, que se comprueban a mano. Datos comunes:

| Dato | Valor |
|---|---|
| Reloj de las pruebas (`TEST_NOW`) | 2026-11-11T10:00:00Z |
| Ana | `ana@example.com`, con contraseña y correo verificado |
| Beto | `beto@example.com`, registrado con contraseña el 2026-11-11T10:00:00Z, sin verificar |
| Carla | Cuenta creada con Google (`carla@gmail.com`, sin contraseña) con Facebook unido (`provider_email` `carla.fb@example.com`, verificado) |
| Nadie | `nadie@example.com`, sin cuenta |
| Contraseña de las pruebas | `una frase larga de prueba`; fecha de nacimiento 1990-05-05 |

---

## Plan de implementación por fases

Cada fase va en su PR y pasa QA por separado. Una fase está hecha cuando todos los escenarios de sus tareas están en verde y, partiendo de `npm run db:reset` y con Mailpit levantado, pasan `npm run lint`, `npm run typecheck`, `npm test` y `npm run test:e2e`, y la aplicación funciona en `npm run dev`.

### Fase A (PR 1) — Infraestructura

Sin cambios visibles en la interfaz.

**A.1 Configuración** (`envSchema` de §8.1, con el renombrado a `PUBLIC_WEB_URL` en API, pruebas, `OAUTH_E2E_ENV`, `.env.example` y README). Hecho cuando:

- **A1-1.** Dado `NODE_ENV=development` sin `SMTP_URL`, cuando arranca la API, entonces no arranca y el error nombra `SMTP_URL` sin mostrar ningún valor.
- **A1-2.** Dado `NODE_ENV=test` sin `SMTP_URL`, cuando arranca, entonces el `Mailer` inyectado es `MemoryMailer` y el *worker* no ha programado ningún temporizador.
- **A1-3.** Dado `NODE_ENV=production`, `SMTP_URL=smtps://usuario:clave@smtp.proveedor.eu` y `MAIL_FROM` sin definir (vale `Cupidilla <no-reply@example.com>`), cuando arranca, entonces no arranca y el error nombra `MAIL_FROM`; con `MAIL_FROM="Cupidilla <no-reply@cupidilla.es>"` y `MAIL_SUPPORT_ADDRESS=soporte@example.com`, nombra `MAIL_SUPPORT_ADDRESS`; con `soporte@cupidilla.es`, arranca.
- **A1-4.** Dado `NODE_ENV=production` y `MAIL_SUPPORT_ADDRESS=ayuda@cupidilla.test`, cuando arranca, entonces no arranca.
- **A1-5.** Dado `NODE_ENV=production` y `SMTP_URL=smtp://127.0.0.1:1025`, cuando arranca, entonces no arranca y el mensaje no contiene `127.0.0.1`.
- **A1-6.** Dado `PUBLIC_WEB_URL=http://cupidilla.es`, cuando arranca, entonces no arranca; con `http://localhost:5173`, arranca; con `https://cupidilla.es/`, no arranca (barra final).
- **A1-7.** Dado un `.env` antiguo con `OAUTH_REDIRECT_BASE_URL=http://localhost:5173`, cuando arranca, entonces no arranca con «OAUTH_REDIRECT_BASE_URL ya no existe: usa PUBLIC_WEB_URL».
- **A1-8.** Dado `EMAIL_UNVERIFIED_REMINDER=si`, cuando arranca, entonces no arranca; con `false`, arranca.
- **A1-9.** Dado Google configurado y `PUBLIC_WEB_URL=http://localhost:5173`, cuando se empieza un flujo con Google, entonces la `redirect_uri` es `http://localhost:5173/auth/google/callback`, y todas las pruebas de OAuth existentes siguen en verde.
- **A1-10** (unitario). Dado `SMTP_URL=smtp://u%40x:cl%3Ave@mail.proveedor.eu`, cuando se calcula `smtpTransportOptions`, entonces el puerto es 587, `secure` es falso, `requireTLS` es verdadero y las credenciales son `u@x` y `cl:ve`.
- **A1-11** (unitario). Dado `smtps://mail.proveedor.eu`, entonces puerto 465 y `secure` verdadero; dado `smtp://127.0.0.1:1025`, entonces `requireTLS` es falso.

**A.2 Mailpit y scripts** (`docker-compose.yml`, `mail:up`, `dev`, `test:e2e`, README). Hecho cuando:

- **A2-1 (QA).** Dado Docker sin el contenedor `mail`, cuando se ejecuta `npm run mail:up`, entonces el comando termina con `mail` en *healthy* y `GET http://127.0.0.1:8025/api/v1/info` responde 200 con `"Version":"v1.32.0"`.
- **A2-2 (QA).** Dado un `.env` copiado de `.env.example` con `INTERNAL_API_KEY` rellena, cuando se ejecuta `npm run dev`, entonces se levantan `db` y `mail` y la API arranca sin errores de configuración.

**A.3 Esquema** (columnas de `users` con sus CHECK e índice, `email_tokens`, `email_outbox`; `0000_init` regenerada). Hecho cuando:

- **A3-1 (QA).** Dado `npm run db:reset`, cuando se mira `\d users`, `\d email_tokens` y `\d email_outbox`, entonces aparecen las columnas, las CHECK, los UNIQUE, los índices parciales y las FK de §3.
- **A3-2.** Dado un `INSERT` en `users` con `password_hash` y `email_verified_at` nulos, cuando se ejecuta, entonces falla con `users_unverified_has_password`.
- **A3-3.** Dado un `INSERT` en `users` con `email_verified_at` nulo y `data_review_required_at` puesto, cuando se ejecuta, entonces falla con `users_review_requires_verified`.
- **A3-4.** Dado un `email_tokens` de Beto con propósito `verify_email`, cuando se inserta otro con el mismo usuario y propósito, entonces falla con `email_tokens_user_purpose_unique`.
- **A3-5.** Dado una fila pendiente (`verify_email`, `beto@example.com`), cuando se encola otra igual, entonces sigue habiendo 1 fila; si la primera tiene `failed_at`, la segunda sí entra.
- **A3-6.** Dado Beto con un `email_tokens`, cuando se borra su cuenta, entonces el token desaparece, e I-16 sigue en verde con las tablas nuevas.

**A.4 `MailModule`** (`Mailer`, `SmtpMailer`, `MemoryMailer`, `OutboxService`, `OutboxWorker`, `mail-resolver`, `EmailTokensService`, esqueleto de plantillas con el pie; `nodemailer@10.3.1` exacta). Hecho cuando:

- **A4-1.** Dado una transacción que encola (`verify_email`, `beto@example.com`) y después lanza un error, cuando se llama a `drain()`, entonces no hay filas en `email_outbox` ni mensajes en `MemoryMailer`.
- **A4-2.** Dado Beto y una fila `verify_email` para él, cuando se llama a `drain()` a las 10:00:00, entonces hay 1 mensaje a `beto@example.com` con `From` igual a `MAIL_FROM`, el pie con `soporte@example.com`, parte de texto y parte HTML, un enlace `http://localhost:5173/verify-email?token=` seguido de 43 caracteres y ningún `<img`; `email_tokens` tiene 1 fila cuyo `token_hash` es el SHA-256 de ese token y cuyo `expires_at` es 2026-11-12T10:00:00Z; y `email_outbox` está vacía.
- **A4-3.** Dado ese primer correo entregado y otra fila `verify_email` para Beto, cuando se llama a `drain()`, entonces sigue habiendo 1 `email_tokens` de Beto y el hash del primer token ya no existe.
- **A4-4.** Dado `MemoryMailer.failNext(1, { permanent: false })` y una fila para Beto, cuando se llama a `drain()` a las 10:00:00, entonces `attempts` vale 1, `next_attempt_at` es 10:00:30, `locked_until` es nulo y `last_error` es un código; y cuando el reloj pasa a 10:00:31 y se llama a `drain()`, el correo sale y la fila desaparece.
- **A4-5.** Dado `failNext(1, { permanent: true })`, cuando se llama a `drain()`, entonces la fila tiene `failed_at`; y un día después, otro `drain()` no envía nada.
- **A4-6.** Dado 8 fallos transitorios seguidos, adelantando el reloj según las esperas de §4.3, cuando falla el 8.º, entonces la fila tiene `failed_at`; y con el reloj 8 días después, `drain()` la borra.
- **A4-7.** Dado una fila con `locked_until` dentro de 1 minuto, cuando se llama a `drain()`, entonces no se envía; con el reloj 2 min y 1 s después, sí.
- **A4-8.** Dado 3 filas pendientes, cuando se lanzan dos `drain()` a la vez, entonces salen 3 mensajes, no 6.
- **A4-9.** Dado una fila `reset_password` para Nadie, una `verify_email` para Ana (ya verificada) y una `signup_notice` para Nadie, cuando se llama a `drain()`, entonces no sale ningún mensaje y las tres filas desaparecen con `mail_skipped`.
- **A4-10.** Dado filas `signup_notice` para Ana, Beto y `carla.fb@example.com`, cuando se llama a `drain()`, entonces Ana recibe la variante (a), Beto la (b) con la fecha 18 de noviembre de 2026 y `carla.fb@example.com` la (c), que nombra Google y Facebook; ninguna lleva token.
- **A4-11.** Dado un `email_tokens` que caducó hace 1 minuto, cuando se llama a `drain()`, entonces se borra.
- **A4-12** (unitario). Dado un error `{ code: 'EENVELOPE' }`, o `{ responseCode: 550, permanent: true }`, cuando se clasifica, entonces es permanente, con código `EENVELOPE` y `smtp_550`; dado `{ responseCode: 421, permanent: false }`, `{ code: 'EAUTH' }`, `{ code: 'ETLS' }` o `{ code: 'ESOCKET' }`, es transitorio.
- **A4-13** (unitario). Dado un mensaje enviado con `streamTransport`, cuando se lee el mensaje en bruto, entonces lleva `Auto-Submitted: auto-generated` y `Content-Type: multipart/alternative`; y `escapeHtml('<b>&"')` devuelve `&lt;b&gt;&amp;&quot;`.
- **A4-14** (unitario). Dado `beto@example.com`, cuando se calcula `emailHint`, entonces devuelve `b•••@example.com`.
- **A4-15 (QA).** Dado `npm ci`, cuando se ejecuta `npm install-scripts ls`, entonces sale vacío, y `npm ls nodemailer` muestra 10.3.1.

**A.5 `revokeAllForUser`**. Hecho cuando:

- **A5-1.** Dado Ana con 3 sesiones, una de ellas con una reautenticación a medias en `oauth_states`, y Beto con 1 sesión, cuando se llama a `revokeAllForUser` con Ana, entonces devuelve 3, las tres sesiones de Ana dan 401 en `GET /auth/session`, su fila de `oauth_states` ha desaparecido y la sesión de Beto sigue dando 200.

**A.6 Infraestructura e2e** (variables de correo en `playwright.config.ts` y `stack.ts`, `globalSetup` de Mailpit, `helpers/mailpit.ts`). Hecho cuando:

- **A6-1.** Dado Mailpit sin responder en el puerto 8025, cuando arranca Playwright, entonces el `globalSetup` falla con «levanta Mailpit: npm run mail:up».
- **A6-2.** Dado dos correos enviados con nodemailer a `e2e+<uuid1>@example.com` y `e2e+<uuid2>@example.com`, cuando se llama a `waitForMail` con el segundo, entonces devuelve solo ese, `linkIn` extrae el enlace exacto y `clearMailTo` con el segundo deja el primero en Mailpit.
- **A6-3.** Dado el código de la fase, cuando se ejecuta `npm run test:e2e`, entonces todos los e2e existentes siguen en verde en los dos proyectos.

**QA de la fase A**

- **QA-A1 (QA).** Dado Mailpit parado y 3 filas pendientes, cuando se vuelve a levantar y pasan 30 s, entonces los 3 correos están en la bandeja; y `SELECT * FROM email_outbox` no ha mostrado nunca un token.

### Fase B (PR 2) — Verificación y registro uniforme

Toca seguridad: programador Opus.

**B.1 `contracts`** (§7.1 y §7.2, sin lo de la fase C). Hecho cuando:

- **B1-1.** Dado `{ session: 'same' }`, `{ session: 'kept-other' }` y `{ session: 'opened', auth }` con un `auth` válido, cuando se validan con `emailVerificationResponseSchema`, entonces se aceptan; `{ session: 'otra' }` se rechaza.
- **B1-2.** Dado un token de 42 caracteres, otro de 44 y otro de 43 con `+`, cuando se validan con `opaqueTokenSchema`, entonces se rechazan; uno de 43 en base64url se acepta.
- **B1-3.** Dado `{ email: ' Ana@Example.COM ' }`, cuando se valida con `emailRequestSchema`, entonces queda `ana@example.com`.
- **B1-4.** Dado `ERROR_CODES`, entonces contiene `TOKEN_INVALID_OR_EXPIRED`, `TOKEN_ATTEMPTS_EXCEEDED` y `EMAIL_NOT_VERIFIED`, y `npm run build:contracts` termina en verde.

**B.2 Registro uniforme** (§5.1, conjunto `email` del *throttler*, `registerUser` y el resto de *helpers*). Hecho cuando:

- **B2-1.** Dado Nadie, cuando se registra con la contraseña y la fecha de las pruebas y las condiciones vigentes, entonces responde 202 sin cuerpo; hay un `users` con `email_verified_at` nulo, un `consents` con `granted_at` igual al reloj y ninguna sesión; y tras `drain()` hay 1 correo «Confirma tu correo» para `nadie@example.com`.
- **B2-2.** Dado Nadie, Ana, Beto y `carla.fb@example.com`, cuando cada uno se registra con los mismos datos, entonces las cuatro respuestas son 202 con el cuerpo vacío y las mismas cabeceras salvo `Date`; `PasswordService.hash` se llama una vez en cada petición; cada una deja una fila en `email_outbox`; y las filas de Ana, Beto y Carla en `users` no cambian.
- **B2-3.** Dado los registros de B2-2, cuando se llama a `drain()`, entonces Nadie recibe «Confirma tu correo», Ana la variante (a) del aviso, Beto la (b) y `carla.fb@example.com` la (c).
- **B2-4.** Dado 7 registros de correos nuevos y 7 con el correo de Ana (con IP distintas y el límite por correo multiplicado), cuando se miden, entonces la diferencia entre las dos medianas es menor que 50 ms.
- **B2-5.** Dado 3 registros con el correo de Ana desde 10.0.0.1, 10.0.0.2 y 10.0.0.3 en una hora, cuando llega el 4.º desde 10.0.0.4, entonces responde 429 con `Retry-After`; con Nadie pasa lo mismo en el mismo intento; y `nadie2@example.com` desde 10.0.0.4 responde 202.
- **B2-6.** Dado una persona nacida el 2008-11-12 (cumple 18 mañana), cuando se registra con el correo de Ana, entonces responde 422 `UNDERAGE` y no hay ninguna fila nueva en `email_outbox`.
- **B2-7.** Dado `registerUser` cambiado, cuando se ejecuta `npm test`, entonces todas las pruebas de integración existentes están en verde sin cambiar sus aserciones.

**B.3 Comprobar, confirmar, reenviar y `lockUnchangedPassword`** (§5.3, §5.4, §5.7 en el login y la unión). Hecho cuando:

- **B3-1.** Dado el enlace de Beto, cuando se comprueba sin `Bearer`, entonces responde 200 con `emailHint` `b•••@example.com` y `sessionMatches` falso, y el token sigue valiendo; con el `Bearer` de Beto, `sessionMatches` es verdadero; con el de Ana, falso.
- **B3-2.** Dado un token inventado de 43 caracteres, el de Beto con el reloj a 2026-11-12T10:00:00Z, o un token de recuperación comprobado como `verify_email`, cuando se comprueba, entonces responde 400 `TOKEN_INVALID_OR_EXPIRED`.
- **B3-3.** Dado el enlace de Beto y ninguna sesión, cuando confirma con su contraseña, entonces responde 200 `{ session: 'opened' }` con una sesión que da 200 en `GET /auth/session`, `email_verified_at` es el reloj y no quedan `email_tokens` de Beto; y si usa el mismo enlace otra vez, responde 400 `TOKEN_INVALID_OR_EXPIRED`.
- **B3-4.** Dado el enlace de Beto y ninguna sesión, cuando confirma sin contraseña, entonces responde 400 `VALIDATION_FAILED` con `password: required` y la comprobación sigue dando 200.
- **B3-5.** Dado el enlace de Beto, cuando envía 4 contraseñas erróneas, entonces cada una responde 403 `PASSWORD_INCORRECT` y `failed_attempts` vale 4; la 5.ª responde 403 `TOKEN_ATTEMPTS_EXCEEDED` y el token ya no existe; y la correcta después responde 400 `TOKEN_INVALID_OR_EXPIRED`.
- **B3-6.** Dado el enlace de Beto y su `Bearer`, cuando confirma sin contraseña, entonces responde `{ session: 'same' }` y `sessions` no tiene ninguna fila nueva.
- **B3-7.** Dado el enlace de Beto y el `Bearer` de Ana, cuando confirma sin contraseña, entonces responde 400 `required`; con la contraseña de Beto, responde `{ session: 'kept-other' }`, no se crea ninguna sesión y la de Ana sigue dando 200.
- **B3-8.** Dado un enlace emitido a las 10:00 del 11 de noviembre, cuando se confirma a las 9:59 del 12, entonces responde 200; a las 10:00 del 12, 400.
- **B3-9.** Dado Beto con un primer correo entregado, cuando se pide el reenvío con `{ email: 'beto@example.com' }` y se llama a `drain()`, entonces llega otro correo y el enlace del primero da 400 en la comprobación.
- **B3-10.** Dado dos peticiones de reenvío para Beto sin `drain()` entre ellas, cuando se llama a `drain()`, entonces hay 1 fila y sale 1 correo.
- **B3-11.** Dado peticiones de reenvío para Ana, `carla@gmail.com` y Nadie, cuando se envían, entonces las tres responden 202 idéntico, `UsersService` no se llama durante las peticiones y, tras `drain()`, no sale ningún correo.
- **B3-12.** Dado un login de Ana que ya ha verificado su hash, cuando otra conexión cambia `password_hash` y hace `COMMIT` antes de que el login cree la sesión, entonces el login responde 401 `INVALID_CREDENTIALS` y no se crea ninguna sesión; lo mismo con una unión, que responde 403 `PASSWORD_INCORRECT`.

**B.4 `emailVerified`, proveedores y guard** (§5.8 a §5.10). Hecho cuando:

- **B4-0.** Dado `EMAIL_UNVERIFIED_REMINDER=false`, `EMAIL_PASSWORD_CHANGED_NOTICE` sin definir y `MIN_AGE` sin definir, cuando se pide `GET /config` con la clave interna y **sin sesión**, entonces responde 200 con `{ minAge: 18, mail: { unverifiedReminder: false, passwordChangedNotice: true } }`; y sin la clave interna, 403.
- **B4-0a** (web). Dado la configuración de B4-0 en la caché de la web, cuando Beto (sin verificar) carga `/account`, entonces la sección de correo no muestra `correo.texto.recordatorio`; con `unverifiedReminder: true`, sí.
- **B4-0b** (unitario). Dado el instante 2026-11-18T10:00:00Z, cuando se llama a `formatSpanishDate`, entonces devuelve «18 de noviembre de 2026»; con 2026-11-18T23:30:00Z devuelve «19 de noviembre de 2026» (ya es día 19 en Madrid).
- **B4-1.** Dado Beto sin verificar, cuando entra, entonces `user.emailVerified` es falso, y `GET /users/me` devuelve `emailVerifiedAt` nulo y `unverifiedDeletionAt` 2026-11-18T10:00:00Z; tras confirmar, `emailVerified` es verdadero, `emailVerifiedAt` es el reloj y `unverifiedDeletionAt` es nulo.
- **B4-2.** Dado un alta con Google de `dani@gmail.com` verificado, cuando completa la fecha y las condiciones, entonces su `email_verified_at` es el reloj; con Facebook, lo mismo.
- **B4-3.** Dado Beto sin verificar y un Google de `beto@example.com` verificado, cuando vuelve del proveedor, entonces el resultado es `link_required` y `GET /auth/oauth/pending` devuelve `accountEmailVerified: false`; y cuando une con su contraseña, la cuenta queda verificada y sin `email_tokens` de verificación.
- **B4-4.** Dado Beto sin verificar con sesión, cuando pide `POST /users/me/oauth/google/authorization` con `{ purpose: 'connect', password }`, entonces responde 403 `EMAIL_NOT_VERIFIED`; Ana, con su contraseña, recibe 201.
- **B4-5** (unitario). Dado `VerifiedEmailGuard`, cuando la ruta no lleva el metadato, o es `@Public()`, o la sesión tiene `emailVerified` verdadero, entonces deja pasar; con el metadato y `emailVerified` falso, lanza 403 `EMAIL_NOT_VERIFIED`.

**B.5 Recordatorio y borrado** (`UnverifiedAccountsSweeper`, §6.3). Hecho cuando:

- **B5-1.** Dado Beto, creado el 2026-11-11T10:00:00Z, cuando se ejecuta `sweep()` el 2026-11-16T09:59:00Z, entonces no pasa nada; el 2026-11-16T10:00:00Z, se encola un `verify_reminder` y `verification_reminded_at` es el reloj; y tras `drain()` llega el recordatorio con «18 de noviembre» y un enlace nuevo, y el enlace anterior da 400 en la comprobación.
- **B5-2.** Dado el recordatorio de B5-1 ya encolado, cuando se ejecuta `sweep()` a las 11:00, entonces no se encola otro.
- **B5-3.** Dado `EMAIL_UNVERIFIED_REMINDER=false` y Beto a los 5 días, cuando se ejecuta `sweep()`, entonces no se encola nada.
- **B5-4.** Dado Beto, cuando se ejecuta `sweep()` el 2026-11-18T09:59:00Z, entonces sigue existiendo; el 2026-11-18T10:01:00Z se borra y no quedan filas suyas en ninguna tabla con FK hacia `users`; y Ana, verificada y creada el 2026-10-01, sigue intacta.
- **B5-5.** Dado 150 cuentas sin verificar creadas hace 8 días, cuando se ejecuta `sweep()`, entonces se borran las 150.
- **B5-6.** Dado Beto a los 7 días y una confirmación que bloquea su fila a la vez que el borrado, cuando terminan las dos, entonces o la cuenta está verificada y sigue, o no existe y la confirmación respondió 400 `TOKEN_INVALID_OR_EXPIRED`.

**B.6 Plantillas** (textos de UX §5.1 y §5.3, recordatorio y variantes). Hecho cuando:

- **B6-1.** Dado Beto, cuando se genera «Confirma tu correo», entonces el asunto es «Confirma tu correo», el texto plano tiene el enlace solo en su línea, «24 horas» y la fecha de borrado, y el HTML tiene el enlace dos veces (botón y texto).
- **B6-2.** Dado un correo con `<b>` en la dirección (imposible tras `emailSchema`, se fuerza en la prueba), cuando se genera cualquiera de las plantillas, entonces el HTML lo muestra escapado.

**B.7 Web** (`/register`, `/register/check-email`, `/verify-email`, banda y sección de `/account`, cookies y cabeceras de §9.1, `messages.ts`, textos; `registerAdult` con Mailpit). Hecho cuando:

- **B7-1.** Dado `messages.ts`, cuando se ejecuta W-1, entonces hay texto para los códigos nuevos y el registro ya no usa `registro.error.correo_existente`.
- **B7-2.** Dado `GET /verify-email?token=` con 43 caracteres válidos, cuando responde la web, entonces es un 303 a `/verify-email` con `Set-Cookie: cupidilla_email_token=…; Path=/verify-email; HttpOnly; SameSite=Lax`; con `?token=abc`, no hay cookie y se pinta «Este enlace ya no sirve».
- **B7-3.** Dado una cookie de token que la comprobación rechaza, cuando se carga `/verify-email`, entonces el estado es 410 con «Este enlace ya no sirve».
- **B7-4.** Dado la acción de registro con el correo de Ana y con el de Nadie, cuando la API responde 202, entonces las dos acaban en 303 a `/register/check-email` con la cookie `cupidilla_pending_email` con valor `signup:` y el correo.
- **B7-5.** Dado un corte de conexión después de enviar, cuando la web llama a `register` o a `verifyEmail`, entonces el resultado es `OUTCOME_UNKNOWN`; y un 201 a `register` también da `OUTCOME_UNKNOWN`.
- **B7-6.** Dado `/account?notice=cualquier-cosa`, cuando se pinta, entonces no se muestra ningún aviso.
- **B7-7.** Dado una sesión de Ana (verificada), cuando envía la acción `resendVerification`, entonces la web no llama a la API y redirige a `/account?notice=verification-already`.

**B.8 E2E** (proyectos `chromium` y `chromium-no-js`). Hecho cuando:

- **B8-1.** Dado un correo nuevo `e2e+<uuid>@example.com`, cuando se registra en `/register`, entonces llega a `/register/check-email`, que muestra el correo sin que esté en la URL; llega «Confirma tu correo» a Mailpit; al abrir el enlace la URL queda en `/verify-email` sin `token`; y tras escribir la contraseña acaba en `/account?notice=email-verified-signin` sin aviso de correo sin confirmar, con la cookie de sesión `HttpOnly`, `SameSite=Lax` y `Secure`.
- **B8-2.** Dado una cuenta ya registrada, cuando alguien se registra otra vez con su correo, entonces ve la misma pantalla, a Mailpit llega el aviso (no «Confirma tu correo») y en `cupidilla_e2e` sigue habiendo una sola cuenta con ese correo.
- **B8-3.** Dado una cuenta registrada y que ha entrado sin confirmar, cuando pulsa «Enviar otro mensaje» en `/account`, entonces ve la banda y la sección con la fecha de borrado, llega un segundo correo, el enlace del primero muestra «Este enlace ya no sirve» y el del segundo confirma sin pedir contraseña (`notice=email-verified`).
- **B8-4.** Dado una sesión abierta de otra cuenta, cuando se abre el enlace de confirmación, entonces se pide la contraseña y, tras escribirla, acaba en `/account?notice=email-verified-other` con la misma sesión.
- **B8-5.** Dado un enlace de confirmación, cuando se pide con `request.get` (como un escáner), entonces la respuesta lleva `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex` y `Cache-Control: no-store`, y en la base de datos la cuenta sigue sin verificar.
- **B8-6.** Dado las páginas nuevas, cuando se recorren, entonces la consola no muestra violaciones de CSP.
- **B8-7.** Dado `registerAdult` cambiado, cuando se ejecuta `npm run test:e2e`, entonces todos los e2e existentes están en verde.

**B.9 Logs**. Hecho cuando:

- **B9-1.** Dado el logger capturado durante B2 a B5, cuando se revisa la salida, entonces no aparecen ningún token, ningún enlace, `beto@example.com`, `b•••@example.com`, la contraseña ni la `SMTP_URL`.

**QA de la fase B**

- **QA-B1 (QA).** Dado `npm run dev`, cuando se registra un correo nuevo y otro ya existente sin verificar, entonces en `http://localhost:8025` hay «Confirma tu correo» y la variante (b) del aviso.
- **QA-B2 (QA).** Dado una cuenta sin verificar creada en dev, cuando se cambia a mano su `created_at` a hace 5 días y se espera al barrido horario (o se reinicia la API), entonces llega el recordatorio.
- **QA-B3 (QA).** Dado JavaScript desactivado, cuando se recorren B8-1 a B8-4, entonces funcionan igual.

### Fase C (PR 3) — Recuperación de contraseña y revisión de datos

Programador Opus.

**C.1 `contracts`** (`passwordResetSchema`, `dataReviewRequestSchema`, `DATA_REVIEW_REQUIRED`, `dataReviewRequired` en `publicUserSchema`). Hecho cuando:

- **C1-1.** Dado `{ token, password }` con una contraseña de 9 caracteres, cuando se valida con `passwordResetSchema`, entonces da `too_short`; con 10, se acepta.
- **C1-2.** Dado `{ birthDate: '1990-05-05', acceptTerms: false, termsVersion }`, cuando se valida con `dataReviewRequestSchema`, entonces da `acceptTerms: required`; con un campo desconocido, `unrecognized`.
- **C1-3.** Dado `ERROR_CODES`, entonces contiene `DATA_REVIEW_REQUIRED`.

**C.2 Solicitud y restablecimiento** (§5.5, §5.6, plantillas de recuperación y de contraseña cambiada). Hecho cuando:

- **C2-1.** Dado Ana y Nadie, cuando cada una pide la recuperación, entonces las dos respuestas son 202 con el cuerpo vacío y las mismas cabeceras salvo `Date`, cada una deja una fila en `email_outbox` y `UsersService` no se llama; y tras `drain()` solo Ana recibe «Restablece tu contraseña».
- **C2-2.** Dado Ana con 3 sesiones abiertas y Beto con 1, cuando Ana restablece con `otra frase larga nueva`, entonces la contraseña vieja da 401 en el login y la nueva 200; las tres sesiones previas de Ana dan 401; la de Beto sigue dando 200; la respuesta trae una sesión nueva válida; y no quedan `email_tokens` de Ana ni filas `reset_password` pendientes para su correo.
- **C2-3.** Dado el restablecimiento de C2-2 y `EMAIL_PASSWORD_CHANGED_NOTICE` sin definir, cuando se llama a `drain()`, entonces Ana recibe «Tu contraseña ha cambiado»; con `EMAIL_PASSWORD_CHANGED_NOTICE=false`, no recibe nada.
- **C2-3b.** Dado Beto (sin verificar) que restablece y cierra el navegador sin hacer la revisión, cuando se llama a `drain()`, entonces recibe «Tu contraseña ha cambiado», porque la fila se encoló en la transacción del restablecimiento.
- **C2-4.** Dado Carla (solo Google, sin contraseña), cuando pide la recuperación con `carla@gmail.com` y restablece, entonces después entra con `POST /auth/login` (200) y su identidad de Google sigue unida.
- **C2-5.** Dado `carla.fb@example.com` (correo de un proveedor), cuando pide la recuperación, entonces responde 202 y tras `drain()` no sale ningún correo.
- **C2-6.** Dado un enlace de recuperación emitido a las 10:00, cuando se usa a las 10:59, entonces funciona; a las 11:00, responde 400 `TOKEN_INVALID_OR_EXPIRED`; usado dos veces, la segunda responde 400; y un token de verificación aquí, también 400.
- **C2-7.** Dado un enlace válido, cuando se envía una contraseña de 9 caracteres, entonces responde 400 y el token sigue dando 200 en la comprobación.
- **C2-8.** Dado Beto (sin verificar) con 2 sesiones abiertas por un ocupante, cuando el dueño del buzón restablece, entonces las 2 sesiones dan 401, la cuenta queda verificada, `data_review_required_at` es el reloj y la respuesta trae `user.dataReviewRequired: true`.
- **C2-9.** Dado Ana (ya verificada), cuando restablece, entonces `data_review_required_at` sigue nulo.
- **C2-10.** Dado un login de Ana con la contraseña vieja que ha verificado su hash y espera al bloqueo de un restablecimiento en curso, cuando el restablecimiento hace `COMMIT`, entonces el login responde 401 y no queda ninguna sesión creada con la contraseña vieja.
- **C2-11.** Dado el SMTP caído (fallos transitorios) desde las 10:00 hasta las 12:00, cuando el correo de recuperación sale a las 12:00, entonces su token caduca a las 13:00.
- **C2-12.** Dado 5 solicitudes de recuperación de Ana en 24 h, cuando llega la 6.ª, entonces responde 429; con Nadie, lo mismo en el mismo intento.

**C.3 Revisión de datos** (§5.11: `POST /users/me/data-review`, `DataReviewGuard`, `@AllowDuringDataReview()`). Hecho cuando:

- **C3-1.** Dado Beto pendiente de revisión con sesión, cuando pide `GET /users/me`, `GET /auth/session` o `POST /auth/logout`, entonces responden con normalidad; y cuando pide `POST /users/me/oauth/google/authorization` o `POST /users/me/reauthentication`, responden 403 `DATA_REVIEW_REQUIRED`.
- **C3-1b.** Dado Beto pendiente con sesión, cuando la web carga `/account/review`, entonces no llama a `GET /users/me` y el HTML no contiene la fecha guardada (1990-05-05) en ningún campo.
- **C3-2.** Dado Beto pendiente, cuando envía `{ birthDate: '1990-05-05', acceptTerms: true, termsVersion: SERVICE_TERMS_VERSION }`, entonces responde 204; `data_review_required_at` es nulo; su consentimiento anterior tiene `revoked_at` igual al reloj; hay uno nuevo con `granted_at` igual al reloj y la versión vigente; y `POST /users/me/oauth/google/authorization` ya no da 403 por revisión.
- **C3-3.** Dado Beto pendiente con la fecha 1990-05-05, cuando envía 1985-01-20, entonces `birth_date` pasa a 1985-01-20.
- **C3-4.** Dado `MIN_AGE` sin definir (18), Beto pendiente y el reloj a 2026-11-11T23:30:00Z (12 de noviembre en Madrid), cuando envía 2008-11-12 (cumple 18 ese día), entonces responde 204; con 2008-11-13, responde 422 `UNDERAGE`, la cuenta de Beto ya no existe, no quedan filas suyas en ninguna tabla con FK hacia `users` y la fecha no aparece en los logs.
- **C3-4b.** Dado `MIN_AGE=21`, el reloj a 2026-11-11T10:00:00Z (11 de noviembre en Madrid), Beto pendiente de revisión y Ana creada antes con fecha 2006-01-01 (20 años), cuando Beto envía 2005-11-11 (cumple 21 ese día), entonces responde 204; si en su lugar envía 2005-11-12 (cumple 21 mañana), responde 422 `UNDERAGE`, la cuenta de Beto ya no existe y la fecha no aparece en los logs; y Ana sigue entrando con `POST /auth/login` (200), porque su cuenta no pasa por la revisión.
- **C3-5.** Dado Beto pendiente, cuando envía una fecha futura, entonces responde 400 `in_future` y no cambia nada; con la versión de condiciones `'2026-11-borrador'`, 409 `TERMS_VERSION_OUTDATED` y no cambia nada.
- **C3-6.** Dado Ana, sin revisión pendiente, cuando envía la revisión con otra fecha, entonces responde 404 y su `birth_date` no cambia.
- **C3-7.** Dado Beto pendiente, cuando borra su cuenta con su contraseña nueva en `POST /users/me/deletion`, entonces responde 204.
- **C3-8.** Dado Beto pendiente, cuando entra otra vez con `POST /auth/login`, entonces la respuesta trae `user.dataReviewRequired: true` y la revisión sigue pendiente.
- **C3-9** (unitario). Dado `DataReviewGuard`, cuando la ruta es `@Public()`, o la sesión no tiene revisión pendiente, o la ruta lleva `@AllowDuringDataReview()`, entonces deja pasar; en otro caso, lanza 403 `DATA_REVIEW_REQUIRED`.

**C.4 Web** (`/forgot-password`, `/forgot-password/check-email`, `/reset-password`, `/account/review`, redirección de `guardRoutes`, enlaces en `/login` y `/login/link`). Hecho cuando:

- **C4-1.** Dado `GET /reset-password?token=` con 43 caracteres válidos, cuando responde la web, entonces es un 303 a `/reset-password` con la cookie del token en `Path=/reset-password`.
- **C4-2.** Dado la acción de `/forgot-password` con el correo de Ana y con el de Nadie, cuando la API responde 202, entonces las dos acaban en 303 a `/forgot-password/check-email` con `cupidilla_pending_email` con valor `reset:` y el correo.
- **C4-3.** Dado una sesión con `dataReviewRequired`, cuando pide `/account`, `/account/password` o `/`, entonces recibe 303 a `/account/review`; y `/account/review`, `/account/delete` y `/legal/terms` se pintan.
- **C4-4.** Dado un restablecimiento cuya respuesta trae `dataReviewRequired: true`, cuando termina la acción, entonces redirige a `/account/review?notice=password-reset`; con `false`, a `/account?notice=password-reset`.
- **C4-5.** Dado `/account/review` con una fecha de menor, cuando se envía, entonces la web llama a la API, borra la cookie de sesión y pinta la pantalla de menor de edad sin ningún valor.
- **C4-6.** Dado un corte de conexión después de enviar, cuando la web llama a `resetPassword`, entonces el resultado es `OUTCOME_UNKNOWN`.

**C.5 E2E** (proyectos `chromium` y `chromium-no-js`). Hecho cuando:

- **C5-1.** Dado una cuenta verificada con sesión en otro contexto del navegador, cuando en `/login` pulsa «¿Olvidaste tu contraseña?», pide el enlace, lo abre desde Mailpit y guarda una contraseña nueva, entonces acaba en `/account?notice=password-reset`, el otro contexto acaba en `/login` al cargar cualquier página privada y llega «Tu contraseña ha cambiado».
- **C5-2.** Dado `/login/link` de una unión en curso, cuando se pulsa «¿Olvidaste tu contraseña?», entonces lleva a `/forgot-password`.
- **C5-3.** Dado una cuenta creada con Google en el proveedor falso, cuando recupera la contraseña por correo, entonces después entra en `/login` con correo y contraseña.
- **C5-4.** Dado una cuenta registrada sin confirmar, cuando recupera la contraseña, entonces acaba en `/account/review` con los campos de la fecha vacíos y la casilla desmarcada; si intenta ir a `/account`, vuelve a `/account/review`; y tras escribir la fecha y aceptar las condiciones acaba en `/account?notice=details-reviewed`.
- **C5-5.** Dado `/account/review`, cuando se envía una fecha de menor, entonces se ve la pantalla de menor de edad y en `cupidilla_e2e` ya no hay ninguna cuenta con ese correo.

**QA de la fase C**

- **QA-C1 (QA).** Dado tres cuentas en dev (con contraseña, solo con Google y sin verificar), cuando cada una recupera la contraseña con otra cuenta abierta en el mismo navegador, entonces la cookie pasa a la cuenta del enlace y solo la sin verificar pasa por `/account/review`.
- **QA-C2 (QA).** Dado JavaScript desactivado, cuando se recorren C5-1 a C5-5, entonces funcionan igual.

### Fase D — Documentación (en el PR de la fase C)

**D.1** Hecho cuando:

- **D1-1.** Dado `decisiones.md`, cuando se lee, entonces tiene la decisión 22 (este diseño y las decisiones del cliente del 14 de noviembre, con la revisión de datos) y «Antes de la beta» ya no tiene «Verificación de correo y recuperación de contraseña» ni «Cuenta sin forma de entrar».
- **D1-2.** Dado el diseño técnico de terceros, cuando se lee, entonces R4 y R7 están resueltos, R1 remite a R-M14, R7b tiene la regla de §6.1 y una nota dice que `PUBLIC_WEB_URL` sustituye a `OAUTH_REDIRECT_BASE_URL`; y en H0, R8 marca como hechas la verificación, la recuperación y la respuesta uniforme.
- **D1-3.** Dado `terms-2026-11-borrador-2.svelte`, cuando se lee, entonces tiene los retoques de UX §7 y `SERVICE_TERMS_VERSION` sigue siendo `'2026-11-borrador-2'` (decisión 9 del cliente).
- **D1-4.** Dado `privacidad-y-seguridad.md`, cuando se lee, entonces incluye la retención de §3.5 y el proveedor SMTP como encargado del tratamiento, pendiente de elegir.

---

## Pendiente

Ninguna pregunta bloquea el hito.

1. **Proveedor SMTP de producción y dominio remitente** (decisión 13 del cliente): se deciden antes del despliegue, con «Marca y dominio». Tiene que ser encargado del tratamiento con servidores en la UE, y el dominio necesita SPF, DKIM y DMARC (R-M15).
2. **Con UX**: los puntos de §1.3.
3. **Para el CTO, por si quiere revisarlo**: en la revisión de datos, una fecha de menor borra la cuenta en el acto (§5.11). Es la regla del alta aplicada a una cuenta que ya existe; la alternativa sería bloquearla sin borrarla, pero obligaría a guardar la fecha de un menor.
