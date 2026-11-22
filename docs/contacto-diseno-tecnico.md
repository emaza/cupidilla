# Formulario de contacto y política de privacidad (borrador): diseño técnico

[← Índice](../README.md) · Base: [correo](correo-diseno-tecnico.md) (*outbox*, *worker*, plantillas, `envSchema`), [H0](h0-diseno-tecnico.md) (web → API, límites, migraciones) · Privacidad: [privacidad-y-seguridad.md](privacidad-y-seguridad.md#formulario-de-contacto) · Fecha: 22 de noviembre de 2026

Este documento es para el programador y para QA. No hay diseño UX de esta página: los textos de §8.4 son provisionales y UX puede cambiarlos sin tocar este diseño (los nombres de las claves y de los campos sí se mantienen). Las decisiones del cliente (§1.1) no se reabren.

## Resumen

- **Qué**: una página pública `/contact` con nombre, correo, teléfono (opcional), asunto, mensaje y la casilla «He leído y acepto la política de privacidad» (obligatoria y enlazada a un borrador nuevo, `/legal/privacy`). Cada envío se guarda en la tabla `contact_messages` y se manda por correo al buzón `CONTACT_TO_ADDRESS`, con `Reply-To` a quien escribe. Si `CONTACT_ACK_EMAIL=true`, quien escribe recibe además un acuse breve.
- **Cómo**: se usa lo que ya existe. La web llama a la API con la clave interna (`POST /contact`, `202` sin cuerpo). La API guarda el mensaje y encola los correos **en la misma transacción** en `email_outbox`, y el *worker* actual los envía con sus reintentos.
- **Cambio en el *outbox***: una columna nueva, `contact_message_id`, que es una referencia a `contact_messages` y que solo llevan los dos tipos nuevos (`contact_message` y `contact_ack`). Esos tipos se deduplican por mensaje y no por dirección, así que diez mensajes seguidos a `CONTACT_TO_ADDRESS` dan diez correos. El *outbox* sigue sin guardar el contenido: el *worker* lo lee de `contact_messages` al enviar.
- **Antispam**: límites estrictos por IP y por correo, y un campo trampa (*honeypot*). Si el campo trampa viene relleno, la API responde exactamente lo mismo que a una persona (`202`), pero no guarda ni envía nada.
- **Privacidad**: no se guarda la IP, ni en claro ni con hash, y en los logs no aparece ningún dato del formulario. Los mensajes se borran **a los 180 días** (es una propuesta) con un barrido automático, o antes si la persona lo pide.
- **Por qué así**: es la arquitectura mínima que respeta los principios del *outbox* (nada se envía si la transacción se deshace, y la respuesta HTTP no depende del SMTP) sin una cola ni una tabla nuevas para el envío.

---

## 1. Alcance y decisiones

**Dentro**: la página `/contact` con su página de confirmación, el borrador `/legal/privacy`, el *endpoint* `POST /contact`, la tabla `contact_messages`, los cambios del *outbox*, el *worker* y las plantillas, dos variables de entorno, el barrido de retención y los enlaces en el pie.

**Fuera**: un panel para leer los mensajes (se leen en el buzón), responder desde la aplicación, adjuntos, captcha, enlazar la política de privacidad desde el registro (ver Preguntas) y la versión definitiva de la política, que depende de la revisión jurídica.

### 1.1 Decisiones del cliente (cerradas)

| # | Decisión | Consecuencia aquí |
|---|---|---|
| C1 | Todos los campos son obligatorios salvo el teléfono. La casilla de privacidad también | §3.1, §5.1 |
| C2 | Cada envío se guarda en la base de datos y se envía por correo | §3, §4 |
| C3 | El destino es la variable nueva `CONTACT_TO_ADDRESS`, sin reutilizar `MAIL_SUPPORT_ADDRESS`. En producción es obligatoria y con un dominio real, con los mismos controles que `MAIL_FROM` | §7.1 |
| C4 | El acuse al remitente está desactivado por defecto y se activa con `CONTACT_ACK_EMAIL=true` (`booleanFlag`). Es un correo breve | §4.5, §7.1 |
| C5 | Se crea el borrador `/legal/privacy`, igual que `/legal/terms`. La casilla enlaza ahí y se guarda la versión aceptada | §3.1, §8.2 |

### 1.2 Decisiones de este diseño

| # | Decisión | Alternativa descartada y motivo |
|---|---|---|
| A1 | `email_outbox.contact_message_id` (FK `ON DELETE CASCADE`) y **dos índices únicos parciales**: el actual, que pasa a cubrir solo las filas sin referencia, y uno nuevo por `(contact_message_id, kind)` | Añadir la columna al índice actual: en PostgreSQL los `NULL` son distintos en un índice único, así que las filas de cuenta (todas con `NULL`) dejarían de deduplicarse. Se podría usar `NULLS NOT DISTINCT`, pero no queda claro si Drizzle 0.45 lo genera en índices parciales, y dos índices se leen mejor |
| A2 | El *outbox* no guarda el contenido: el *worker* lee `contact_messages` al enviar | Copiar el contenido en el *outbox*: duplicaría datos personales en una segunda tabla con otra retención, y el borrado a petición tendría que tocar dos sitios |
| A3 | No se guarda la IP, ni en claro ni con hash | Un SHA-256 de una IPv4 se invierte probando las 2³² posibilidades. Un HMAC necesitaría una clave nueva y no tendría ningún uso: nadie bloquea por IP desde la base de datos, y los límites ya los aplica el *throttler* en memoria |
| A4 | El campo trampa lo decide la API: la web lo envía tal cual, en el campo `website` | Comprobarlo en la web y no llamar a la API: el bot no contaría para los límites por IP, y la regla quedaría fuera del backend («el backend valida») |
| A5 | Ante el campo trampa, la API responde `202`, igual que a una persona | Un 400 o un 403 le diría al bot qué campo evitar |
| A6 | El acuse **no lleva ningún texto escrito por quien envía** (ni nombre, ni asunto, ni mensaje) | Con el acuse activado, quien abuse del formulario puede hacer que Cupidilla escriba a direcciones ajenas. Si el acuse repitiera lo escrito, serviría para mandar spam con nuestro dominio |
| A7 | `From` = `MAIL_FROM` siempre y `Reply-To` = el correo de quien escribe, sin su nombre | Poner al remitente en `From` falla DMARC y es suplantación. El nombre en `Reply-To` no aporta nada y añade texto del usuario a una cabecera |
| A8 | La aceptación de la política se guarda **en la propia fila** (`privacy_policy_version`), no en `consents` | `consents` es de cuentas (`user_id NOT NULL`), y quien escribe no tiene por qué tener cuenta. Tampoco se enlaza el mensaje con la cuenta aunque haya sesión: la web solo rellena el correo |
| A9 | La versión de la política es una constante en `contracts` (`PRIVACY_POLICY_VERSION`) y una versión desfasada da 409 `PRIVACY_VERSION_OUTDATED`, el mismo patrón que `SERVICE_TERMS_VERSION` | Reutilizar `TERMS_VERSION_OUTDATED`: la web enseñaría el texto de las condiciones de uso, que es otro documento |
| A10 | Un solo límite por IP para esta ruta, sin un tope global de mensajes al día | Un tope global protege el buzón frente a una red de bots, pero cualquiera podría bloquear el formulario a todo el mundo. Queda como mitigación si hiciera falta (R-C4) |
| A11 | Página de confirmación aparte (`/contact/sent`) tras un 303 | Un aviso en `/contact?notice=sent`, que también sirve. Una página aparte deja el formulario limpio y, al recargar, no vuelve a enviar nada |

---

## 2. Componentes y estructura

```
packages/contracts/src/
├─ contact.ts                       # NUEVO: límites, contactRequestSchema, CONTACT_* constantes
├─ consents.ts                      # + PRIVACY_POLICY_VERSION
├─ config.ts                        # + contact: { ackEmail } en GET /config
├─ errors.ts                        # + PRIVACY_VERSION_OUTDATED (409)
└─ index.ts                         # + export * from './contact.js'

apps/api/src/
├─ contact/                         # NUEVO módulo
│  ├─ contact.module.ts             # importa MailModule
│  ├─ contact.controller.ts         # POST /contact
│  ├─ contact.service.ts            # submit(): trampa, versión, transacción, encolar
│  └─ contact-retention.sweeper.ts  # borra los mensajes de más de 180 días
├─ database/schema/
│  ├─ contact-messages.ts           # NUEVO
│  ├─ email-outbox.ts               # + contact_message_id, kinds, índices, CHECK
│  └─ index.ts                      # + export
├─ mail/
│  ├─ mailer.ts                     # MailMessage + replyTo?
│  ├─ smtp.mailer.ts                # mailOptions: replyTo como objeto y comprobación de cabeceras
│  ├─ memory.mailer.ts              # guarda replyTo (viene en MailMessage)
│  ├─ outbox.service.ts             # + enqueueContact(); enqueue() solo para los tipos de cuenta
│  ├─ outbox.worker.ts              # reclama contact_message_id; notified_at tras enviar
│  ├─ mail-resolver.ts              # resuelve contact_message y contact_ack
│  └─ templates/
│     ├─ layout.ts                  # + bloque 'quote' y pie opcional
│     ├─ contact-message.ts         # NUEVO: correo interno
│     └─ contact-ack.ts             # NUEVO: acuse
├─ config/env.schema.ts             # + CONTACT_TO_ADDRESS, CONTACT_ACK_EMAIL y sus reglas
├─ config/config.controller.ts      # + contact.ackEmail
├─ users/users.service.ts           # el borrado de cuenta no toca las filas de contacto
├─ users/data-review.service.ts     # ídem
├─ users/unverified-accounts.sweeper.ts  # ídem
└─ app.module.ts                    # + ContactModule

apps/api/drizzle/0001_contact.sql   # NUEVA migración (+ meta/)

apps/web/src/
├─ routes/contact/+page.server.ts   # load (rellena el correo de la sesión) y acción default
├─ routes/contact/+page.svelte
├─ routes/contact/sent/+page.svelte # «Mensaje enviado»
├─ routes/legal/privacy/+page.svelte
├─ routes/+layout.svelte            # pie: + Privacidad, + Contacto
├─ lib/legal/privacy-2026-11-borrador.svelte   # texto del borrador (§8.2)
├─ lib/components/PrivacyCheckbox.svelte
├─ lib/components/HoneypotField.svelte
├─ lib/forms/contact.ts             # parseContactForm
├─ lib/server/api-client.ts         # + sendContactMessage
├─ lib/errors/messages.ts           # + contact, + fieldMessages.contact
├─ lib/texts.ts                     # + claves contacto.* y privacidad.*
└─ app.css                          # + .visually-hidden-trap (si no hay ya una clase equivalente)
```

**Responsabilidades**

| Pieza | Hace | No hace |
|---|---|---|
| `ContactController` | Ruta pública con clave interna, validación del esquema y límites | Lógica: todo está en el servicio |
| `ContactService` | Comprueba el campo trampa y la versión, guarda el mensaje, encola uno o dos correos y llama a `kick()` | Enviar: eso lo hace el *worker* |
| `ContactRetentionSweeper` | Borra cada hora los mensajes vencidos (sus filas del *outbox* caen en cascada) | Nada en `NODE_ENV=test` (los tests llaman a `sweep()`) |
| `MailResolver` | Para los tipos de contacto, lee la fila por `contact_message_id` y monta el correo. Si la fila ya no existe, descarta | Leer `users`: estos correos no dependen de ninguna cuenta |
| `OutboxWorker` | Lo mismo que hoy y, tras enviar un `contact_message`, marca `notified_at` | — |

`ContactModule` importa `MailModule` (por `OutboxService`). `MailResolver` lee `contact_messages` con el esquema de Drizzle, sin importar `ContactModule`, así que no hay ciclo (es la misma regla que §4.1 del diseño de correo).

---

## 3. Modelo de datos

### 3.1 `contact_messages`

| Columna | Tipo | Restricciones y notas |
|---|---|---|
| `id` | `uuid` | PK, `DEFAULT gen_random_uuid()` |
| `name` | `text` | `NOT NULL`. `CHECK (char_length(name) BETWEEN 1 AND 100)` y `CHECK (name !~ '[[:cntrl:]]')` (una sola línea) |
| `email` | `text` | `NOT NULL`. Se normaliza como `users.email`: `CHECK (email = lower(btrim(email)))` y `CHECK (char_length(email) BETWEEN 3 AND 254)` |
| `phone` | `text` | `NULL` si no se escribe. `CHECK (phone IS NULL OR (char_length(phone) BETWEEN 6 AND 30 AND phone ~ '^\+?[0-9 ().-]+$'))` |
| `subject` | `text` | `NOT NULL`. `CHECK (char_length(subject) BETWEEN 1 AND 150)` y `CHECK (subject !~ '[[:cntrl:]]')` |
| `message` | `text` | `NOT NULL`. `CHECK (char_length(message) BETWEEN 1 AND 3000)`. Puede tener saltos de línea (`\n`) y tabuladores |
| `privacy_policy_version` | `text` | `NOT NULL`. `CHECK (char_length(privacy_policy_version) BETWEEN 1 AND 64)`. La versión que se aceptó; el instante es `created_at` |
| `created_at` | `timestamptz` | `NOT NULL` (del `Clock`, no `defaultNow()`, para poder usar `FakeClock`) |
| `notified_at` | `timestamptz` | `NULL`. Cuándo aceptó el SMTP el correo interno. `NULL` y con más de unas horas quiere decir que el buzón no lo ha recibido (R-C7). `CHECK (notified_at IS NULL OR notified_at >= created_at)` |

- Índice `contact_messages_created_at_idx ON (created_at)` para el barrido de retención. No hay índice por `email`: el borrado a petición es raro y la tabla es pequeña.
- **No hay IP, ni *user agent*, ni `user_id`** (A3, A8).
- Las longitudes cuentan **caracteres** (puntos de código), igual que `char_length` en una base de datos UTF-8. El esquema de `contracts` mide lo mismo (§5.1), así que estas CHECK son la red de seguridad y en la práctica nunca saltan.
- Normalización antes de guardar (la hace el esquema de §5.1): NFC en todos los textos; `trim` en todos; en el mensaje, `\r\n` y `\r` pasan a `\n`; en el teléfono, los espacios seguidos se dejan en uno; el correo, con `emailSchema` (`trim` y minúsculas).

### 3.2 `email_outbox` (cambios)

| Cambio | Detalle |
|---|---|
| Columna nueva | `contact_message_id uuid NULL REFERENCES contact_messages(id) ON DELETE CASCADE`. Borrar un mensaje (por retención o a petición) quita sus correos pendientes o fallidos |
| `kind` | El enum y `email_outbox_kind_known` añaden `'contact_message'` y `'contact_ack'` |
| CHECK nueva | `email_outbox_contact_ref`: `(kind IN ('contact_message','contact_ack')) = (contact_message_id IS NOT NULL)`. Los dos tipos de contacto llevan siempre la referencia y los demás nunca |
| Índice actual | `email_outbox_pending_unique ON (kind, to_email) WHERE failed_at IS NULL AND contact_message_id IS NULL`. La misma deduplicación de hoy para los cinco correos de cuenta |
| Índice nuevo | `email_outbox_contact_pending_unique ON (contact_message_id, kind) WHERE failed_at IS NULL AND contact_message_id IS NOT NULL`. Como mucho un correo pendiente de cada tipo por mensaje. Empieza por `contact_message_id` para que también sirva al `ON DELETE CASCADE` |

- `to_email` sigue siendo obligatorio y normalizado: `CONTACT_TO_ADDRESS` en el correo interno (por eso el `envSchema` lo normaliza, §7.1) y el correo de quien escribe en el acuse.
- Encolar sigue siendo `INSERT … ON CONFLICT DO NOTHING` sin destino: vale para los dos índices.
- **Cómo carga el *worker* el contenido**: `claim()` devuelve también `contact_message_id`; el resolver hace `SELECT … FROM contact_messages WHERE id = $1` dentro de la transacción de resolución. Si no hay fila (se borró entre medias), la fila del *outbox* se descarta (`mail_skipped`). El *outbox* nunca tiene el nombre, el teléfono, el asunto ni el mensaje.

### 3.3 Migración

Ya existe `0000_init`, que se aplicó en todas las bases de desarrollo, así que según la regla de H0 §5 («una migración aplicada no se edita: se crea otra») esta va en una migración nueva: `npm run db:generate -- --name contact` → `apps/api/drizzle/0001_contact.sql` con su `meta/`. Se revisa el SQL a mano. Lo que tiene que hacer, en este orden:

```sql
CREATE TABLE contact_messages ( … columnas y CHECK de §3.1 … );
CREATE INDEX contact_messages_created_at_idx ON contact_messages (created_at);
ALTER TABLE email_outbox ADD COLUMN contact_message_id uuid;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_contact_message_id_contact_messages_id_fk
  FOREIGN KEY (contact_message_id) REFERENCES contact_messages(id) ON DELETE CASCADE;
ALTER TABLE email_outbox DROP CONSTRAINT email_outbox_kind_known;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_kind_known CHECK (kind IN ('verify_email','verify_reminder','reset_password','signup_notice','password_changed','contact_message','contact_ack'));
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_contact_ref CHECK ((kind IN ('contact_message','contact_ack')) = (contact_message_id IS NOT NULL));
DROP INDEX email_outbox_pending_unique;
CREATE UNIQUE INDEX email_outbox_pending_unique ON email_outbox (kind, to_email) WHERE failed_at IS NULL AND contact_message_id IS NULL;
CREATE UNIQUE INDEX email_outbox_contact_pending_unique ON email_outbox (contact_message_id, kind) WHERE failed_at IS NULL AND contact_message_id IS NOT NULL;
```

Las filas que ya hubiera en el *outbox* cumplen las restricciones nuevas (todas son de cuenta y tienen la referencia a `NULL`). Entre el `DROP INDEX` y el `CREATE` la deduplicación desaparece un instante, pero Drizzle ejecuta la migración en una transacción y la API no migra al arrancar. `test/helpers/test-app.ts` (`truncateAll`) tiene que vaciar `contact_messages`: hay que comprobar si las tablas están listadas a mano.

---

## 4. Envío por correo

### 4.1 `OutboxService`

```ts
// mail/outbox.service.ts
export type MailKind = (typeof emailOutbox.kind.enumValues)[number];      // ahora 7 tipos
export type ContactMailKind = Extract<MailKind, 'contact_message' | 'contact_ack'>;
export type AccountMailKind = Exclude<MailKind, ContactMailKind>;

/** Igual que hoy. Solo los tipos de cuenta: el tipo impide encolar uno de contacto sin referencia. */
enqueue(db: Executor, kind: AccountMailKind, toEmail: string): Promise<void>;
/** INSERT … ON CONFLICT DO NOTHING con contact_message_id. */
enqueueContact(db: Executor, kind: ContactMailKind, toEmail: string, contactMessageId: string): Promise<void>;
```

### 4.2 *Worker* y resolver

- `ClaimedRow` añade `contact_message_id: string | null`, y el `RETURNING` de `claim()` también.
- `process(row)`: los tipos de contacto **no** están en `TOKEN_KINDS`, así que no bloquean `users` ni emiten token. Llama a `resolver.resolve(tx, { kind, toEmail, contactMessageId })`, que cambia de firma.
- Después de enviar, en una transacción: `DELETE` de la fila del *outbox* y, si `kind = 'contact_message'`, `UPDATE contact_messages SET notified_at = now WHERE id = $1 AND notified_at IS NULL`. Si la API muere entre el envío y este paso, la fila se reenvía cuando vence su concesión (R-M6 del diseño de correo): el buzón recibe un duplicado, cosa rara y sin riesgo.
- Reintentos, esperas, `failed_at` y limpiezas: no cambian. Una fila de contacto fallida vive 7 días en el *outbox*, como las demás; el mensaje sigue en `contact_messages` hasta su retención.

```ts
// mail/mail-resolver.ts
resolve(tx: Tx, row: { kind: MailKind; toEmail: string; contactMessageId: string | null }): Promise<MailMessage | null>;
```

| `kind` | Destinatario | Contenido | Se descarta si |
|---|---|---|---|
| `contact_message` | `row.toEmail` (el `CONTACT_TO_ADDRESS` que había al encolar) | §4.4, con `replyTo` = `contact_messages.email` | La fila de `contact_messages` ya no existe |
| `contact_ack` | `row.toEmail` (el correo de quien escribe) | §4.5, sin ningún texto suyo | Igual |

Un `contact_message` usa siempre el `to_email` de la fila y no el valor actual de la configuración, como los demás tipos. Si se cambia `CONTACT_TO_ADDRESS`, lo que estaba pendiente sale hacia la dirección anterior (en la práctica, segundos).

### 4.3 `Mailer` y cabeceras (sin inyección)

```ts
// mail/mailer.ts
export interface MailMessage { to: string; subject: string; text: string; html: string; replyTo?: string }
```

`mailOptions(from, message)` en `smtp.mailer.ts`:

- `replyTo: message.replyTo ? { name: '', address: message.replyTo } : undefined`. **Como objeto, nunca como cadena**: si nodemailer recibe una cadena, la lee como una lista de direcciones, y `a@x.com, b@y.com` serían dos.
- Antes de construir el mensaje, `assertHeaderSafe(message)`: si `to`, `subject` o `replyTo` contienen `\r`, `\n` o cualquier otro carácter de control, lanza `new MailDeliveryError(true, 'header_unsafe')`. Es un fallo permanente: la fila queda `failed_at` y se registra `mail_failed` con ese código.
- La cabecera `Auto-Submitted: auto-generated` se mantiene en los dos correos.

**Tres capas contra la inyección de cabeceras**:

1. **Esquema** (§5.1): `name` y `subject` rechazan cualquier carácter de control (`\p{Cc}`, que incluye `\r` y `\n`), `U+2028` y `U+2029`, y los controles bidireccionales (`U+202A`–`U+202E`, `U+2066`–`U+2069`), que podrían disfrazar el asunto. `email` pasa por `z.email()`, que no admite espacios, comas ni saltos de línea. La base de datos lo vuelve a exigir con `!~ '[[:cntrl:]]'` (§3.1).
2. **`assertHeaderSafe`** en el `Mailer`, por si una plantilla o un cambio futuro mete algo en una cabecera.
3. **nodemailer 10.3.1**. Probado hoy con `streamTransport`: un `subject` con `\r\nBcc: …` sale como una sola línea `Subject: Hola Bcc: …` (cambia el salto por un espacio), y un `name` con un salto en un objeto de dirección se codifica en RFC 2047. Es la última red, no la que se diseña.

En las cabeceras solo entran el asunto escrito por la persona (en el correo interno) y su dirección (en `Reply-To`). El nombre y el teléfono van solo en el cuerpo.

### 4.4 Plantilla del correo interno (`contact-message.ts`)

`renderContactMessage(context, input: { id, name, email, phone, subject, message, createdAt, privacyPolicyVersion }) → RenderedMail`

- **Asunto**: `Contacto web: ${subject}`. Con 150 caracteres como mucho, el asunto completo cabe en la cabecera (nodemailer la pliega si hace falta).
- **Cuerpo**: un bloque con el nombre, el correo, el teléfono («No indicado» si falta), la fecha y la hora en Europe/Madrid («22 de noviembre de 2026, 10:15»), la referencia (los 8 primeros caracteres del `id`) y la versión de la política aceptada. Después, un aviso, «Texto escrito por quien envía el formulario: no abras enlaces que no esperes», y el mensaje en un bloque nuevo, `quote`.
- `layout.ts` añade el bloque `{ type: 'quote'; text: string }`. En HTML es `<div style="white-space:pre-wrap;border-left:4px solid …;padding-left:12px">${escapeHtml(text)}</div>`, que conserva los saltos de línea **sin** convertir el texto en HTML. En texto plano va tal cual.
- `renderMail` acepta un pie opcional (`footer?: string`). El de este correo es «Mensaje del formulario de contacto de Cupidilla. Si respondes a este correo, la respuesta le llega a {email}». No vale el pie de siempre («no hace falta que lo respondas»).
- **Todo valor del usuario pasa por `escapeHtml`**: el nombre, el correo, el teléfono, el asunto (también en el `<title>`) y el mensaje. No se crea ningún enlace con lo que escribe la persona, tampoco un `mailto:`.

### 4.5 Plantilla del acuse (`contact-ack.ts`)

`renderContactAck(context, input: { id, createdAt }) → RenderedMail`. Sin nombre, sin asunto y sin mensaje (A6).

- **Asunto**: «Hemos recibido tu mensaje».
- **Texto** (provisional, para UX): «Hemos recibido el mensaje que enviaste desde el formulario de contacto de Cupidilla el {fecha}. Te responderemos a este correo. Referencia: {ref}.» Y en negrita: «Si no has escrito tú, ignora este correo: nadie ha creado una cuenta con tu dirección y no volveremos a escribirte por esto.»
- Con el pie común (`MAIL_SUPPORT_ADDRESS`), sin enlaces.
- Solo se encola si `CONTACT_ACK_EMAIL` es `true` **cuando llega el mensaje**. Si después se cambia la variable, lo pendiente no cambia.

---

## 5. Contrato y *endpoint*

### 5.1 `packages/contracts/src/contact.ts`

```ts
export const CONTACT_NAME_MAX = 100;
export const CONTACT_SUBJECT_MAX = 150;
export const CONTACT_MESSAGE_MAX = 3000;
export const CONTACT_PHONE_MIN = 6;
export const CONTACT_PHONE_MAX = 30;
/** Retención de contact_messages (privacidad-y-seguridad.md). La usan el barrido y el texto de /legal/privacy. */
export const CONTACT_MESSAGE_RETENTION_DAYS = 180;
/** Nombre del campo trampa en el formulario y en el cuerpo. */
export const CONTACT_HONEYPOT_FIELD = 'website';

/** Longitud en puntos de código, como char_length de PostgreSQL. */
export const codePointLength = (value: string): number => [...value].length;

// Texto de una línea: NFC → trim → requerido → sin controles ni bidi → máximo en puntos de código.
//   z.string({ error: 'required' }).overwrite(v => v.normalize('NFC')).trim()
//    .min(1, { error: 'required', abort: true })
//    .refine(noControlChars, { error: 'invalid_format' })     // \p{Cc}, U+2028, U+2029, bidi
//    .refine(v => codePointLength(v) <= max, { error: 'too_long' })
// Mensaje: igual, pero antes cambia \r\n y \r por \n, y admite \n y \t.
// Teléfono: trim, espacios seguidos → uno; /^\+?[0-9 ().-]+$/ (invalid_format), 6–15 dígitos
//   (invalid_format), longitud 6–30 (too_short / too_long).

export const contactRequestSchema = z.strictObject(
  {
    name: singleLineText(CONTACT_NAME_MAX),
    email: emailSchema,                                   // de auth.ts: trim, minúsculas, ≤ 254
    phone: phoneSchema.optional(),                        // la web no lo envía si está vacío
    subject: singleLineText(CONTACT_SUBJECT_MAX),
    message: multiLineText(CONTACT_MESSAGE_MAX),
    acceptPrivacy: z.literal(true, { error: 'required' }),
    privacyPolicyVersion: termsVersionSchema,             // misma forma: 1–64 caracteres
    website: z.string().max(200).optional(),              // trampa; vacío o ausente = persona
  },
  { error: strictObjectError },
);
export type ContactRequest = z.infer<typeof contactRequestSchema>;
```

- `consents.ts`: `export const PRIVACY_POLICY_VERSION = '2026-11-borrador';`. Una versión nueva del texto es un archivo nuevo y otro valor de esta constante, como en las condiciones.
- `errors.ts`: `'PRIVACY_VERSION_OUTDATED', // 409  la versión de la política de privacidad enviada no es la vigente`.
- `config.ts`: `configResponseSchema` añade `contact: z.object({ ackEmail: z.boolean() })`.
- El teléfono vacío lo quita la web (§8.3). Si a la API le llega `phone: ''`, responde 400 `invalid_format`. Es una regla fija y no hace falta un `preprocess`.
- **Tamaño**: el *body parser* de la API admite 16 KB. En el peor caso (3000 caracteres de 4 bytes y los demás campos al máximo, también los 200 del campo trampa) son unos 14,5 KB de JSON, así que cabe. Por eso el mensaje no pasa de 3000 caracteres. Más allá, la API responde 400 `MALFORMED_REQUEST` y la web lo trata como un error general.

### 5.2 `POST /contact`

| | |
|---|---|
| Ruta | `POST /contact` (`@Controller('contact')`) |
| Acceso | `@Public()`. Exige `X-Internal-Api-Key`, como todas las rutas. Si viene un `Bearer`, no se mira |
| Entrada | `ContactRequest` (`@Body({ schema: contactRequestSchema })`) |
| Éxito | **`202` sin cuerpo** (`@HttpCode(202)`), tanto para una persona como para un bot |
| Límites | `@Throttle({ [IP_THROTTLER]: { limit: 3, ttl: THROTTLE_TTL.hour }, [EMAIL_THROTTLER]: { limit: 3, ttl: THROTTLE_TTL.day } })`, multiplicados por `RATE_LIMIT_FACTOR` |

| Código | Cuándo |
|---|---|
| 400 `VALIDATION_FAILED` con `fields` | Esquema: `name`, `email`, `phone`, `subject`, `message`, `acceptPrivacy` (`required`) y `privacyPolicyVersion`, con `required`, `invalid_format`, `too_short`, `too_long`. Un campo desconocido da `unrecognized` |
| 400 `MALFORMED_REQUEST` | JSON ilegible o de más de 16 KB |
| 403 `FORBIDDEN` | Falta la clave interna |
| 409 `PRIVACY_VERSION_OUTDATED` | `privacyPolicyVersion !== PRIVACY_POLICY_VERSION` (en una petición sin campo trampa) |
| 429 `RATE_LIMITED` | Con `Retry-After`. Por IP (3 cada hora) o por correo (3 cada 24 h) |
| 503 `OUTCOME_UNKNOWN` | Se perdió la conexión con la base de datos durante el `INSERT`: puede que el mensaje se haya guardado o no |
| 500 `INTERNAL_ERROR` | Cualquier otro fallo |

### 5.3 `ContactService.submit(body)`

1. **Campo trampa**: si `body.website?.trim()` no está vacío, registra `{ event: 'contact_honeypot_triggered' }` y termina: `202`, sin escribir nada. Va antes que la versión, así que un bot nunca ve el 409.
2. **Versión**: si no es la vigente, 409 `PRIVACY_VERSION_OUTDATED`.
3. `Transactions.run(tx)`:
   1. `INSERT INTO contact_messages (… , created_at = clock.now()) RETURNING id`. `phone` es `NULL` si falta.
   2. `outbox.enqueueContact(tx, 'contact_message', CONTACT_TO_ADDRESS, id)`.
   3. Si `CONTACT_ACK_EMAIL`: `outbox.enqueueContact(tx, 'contact_ack', body.email, id)`.
4. `outbox.kick()`, el log `{ event: 'contact_message_received', ack: boolean }` y `202`.

### 5.4 Antispam

| Medida | Detalle |
|---|---|
| Límite por IP | 3 mensajes cada hora por IP (la IP la envía SvelteKit en `X-Client-Ip`). En memoria, como el resto (R5 de H0) |
| Límite por correo | 3 cada 24 h por el correo del cuerpo, en un cubo propio de esta ruta (`EMAIL_THROTTLER`, el mismo conjunto que en el registro). También acota los acuses a una misma dirección |
| Campo trampa | `website`, un campo de texto que una persona no ve (§8.3). Si llega con algo, la respuesta es `202` y no se guarda ni se envía nada (A4, A5). Solo queda el log, sin datos |
| Acuse sin contenido | A6: el acuse no sirve para mandar texto a terceros |
| Lo que **no** se hace | Captcha (es un tercero, mete datos en otro proveedor y obliga a cambiar la CSP), una trampa de tiempo (necesitaría firmar la hora con una clave nueva) y el tope global (A10). Se reconsideran si R-C4 se materializa |

Respuestas que ve un bot: `202` con el campo trampa; 400 si los demás campos no son válidos (la validación va antes que el servicio); 429 cuando pasa los límites. Con nada de eso sabe si su mensaje se ha guardado.

---

## 6. Flujo principal

```mermaid
sequenceDiagram
  participant N as Navegador
  participant W as SvelteKit /contact
  participant A as API POST /contact
  participant D as PostgreSQL
  participant O as OutboxWorker
  participant S as SMTP
  N->>W: POST (form action, con CSRF de SvelteKit)
  W->>W: parseContactForm (mismo esquema): si no es válido, fail(400) con los errores
  W->>A: POST /contact + X-Internal-Api-Key + X-Client-Ip
  A->>A: throttler (IP, correo) y esquema
  alt campo trampa relleno
    A-->>W: 202 (no escribe nada)
  else persona
    A->>D: BEGIN; INSERT contact_messages; INSERT email_outbox (contact_message[, contact_ack]); COMMIT
    A->>O: kick()
    A-->>W: 202
  end
  W-->>N: 303 /contact/sent
  O->>D: claim (FOR UPDATE SKIP LOCKED)
  O->>D: SELECT contact_messages WHERE id = contact_message_id
  O->>S: send (From MAIL_FROM, To CONTACT_TO_ADDRESS, Reply-To remitente)
  O->>D: DELETE fila outbox; UPDATE notified_at
```

Paso a paso:

1. La persona abre `/contact`. Con sesión, el correo viene ya rellenado con `locals.user.email` y se puede cambiar. El mensaje no se enlaza con la cuenta.
2. Envía el formulario. La acción lo valida con `contactRequestSchema` y, si algo falla, vuelve a pintar la página con los errores y los valores (nunca el campo trampa).
3. La acción llama a `api.sendContactMessage`. Con `202`, redirige con un 303 a `/contact/sent`.
4. La API guarda el mensaje y encola el correo (o los dos) en una sola transacción.
5. El *worker* envía el correo interno y, si toca, el acuse. Si el SMTP está caído, reintenta durante unas 8 h y la persona no se entera.
6. En el buzón se responde con «Responder», que va a `Reply-To`, es decir, a quien escribió.
7. A los 180 días, el barrido borra el mensaje (y, en cascada, cualquier fila suya que quedara en el *outbox*).

---

## 7. Configuración

### 7.1 Variables nuevas (`envSchema`)

```ts
// Buzón que recibe los mensajes de /contact (decisión C3). Se normaliza (trim y minúsculas):
// email_outbox.to_email lo exige.
CONTACT_TO_ADDRESS: withDefault(z.email({ error: 'CONTACT_TO_ADDRESS tiene que ser una dirección de correo.' }),
                                'contacto@example.com')   // + normalización
// Acuse al remitente (decisión C4). Desactivado por defecto.
CONTACT_ACK_EMAIL: booleanFlag('CONTACT_ACK_EMAIL', false),
```

Reglas nuevas en `checkMail`. Como siempre, el mensaje nombra la variable y no enseña su valor.

- **Con `NODE_ENV=production`**, si `isReservedMailDomain(CONTACT_TO_ADDRESS)`: «CONTACT_TO_ADDRESS necesita un dominio real con NODE_ENV=production.». Como el valor por defecto es de `example.com`, olvidarse de la variable en producción impide arrancar. Así se cumple «obligatoria en producción» sin dejar de arrancar en desarrollo y en los tests.
- **En cualquier entorno**, si `CONTACT_TO_ADDRESS` es la misma dirección que la de `MAIL_FROM` (comparadas en minúsculas): «CONTACT_TO_ADDRESS no puede ser la dirección de MAIL_FROM: los mensajes irían a un buzón que nadie lee.».
- Hay que actualizar el comentario de `booleanFlag` («Valores de `EMAIL_*`») porque ya no es solo para esas.

`GET /config` añade `contact: { ackEmail }` con el valor de `CONTACT_ACK_EMAIL`, para que `/contact/sent` diga o no que llegará un acuse (§8.4). Como con los otros correos opcionales, la web lo lee de su caché de 60 s.

### 7.2 `.env.example`

Va en el bloque del correo, después de `EMAIL_PASSWORD_CHANGED_NOTICE`:

```sh
# Formulario de contacto: buzón que recibe los mensajes (en producción, un dominio real y distinto
# de MAIL_FROM) y acuse de recibo a quien escribe (desactivado por defecto)
# CONTACT_TO_ADDRESS=contacto@example.com
# CONTACT_ACK_EMAIL=false
```

La web no necesita variables nuevas. `vitest.config.ts` (integración) y `playwright.config.ts` (e2e) funcionan con los valores por defecto, y los tests del acuse ponen `CONTACT_ACK_EMAIL=true` en su propia app, como `mail-flags.int.spec.ts`.

---

## 8. Web (SvelteKit)

### 8.1 Rutas

| Ruta | Grupo | Qué hace |
|---|---|---|
| `/contact` | Fuera de `(guest)` y `(private)`: con o sin sesión | `load`: `{ email: locals.user?.email ?? '' }`. Acción `default`: `parseContactForm` → `api.sendContactMessage` → `202`: 303 `/contact/sent`. Errores: §8.3 |
| `/contact/sent` | Igual | Página estática «Mensaje enviado». Con `contact.ackEmail` de `GET /config`, añade la frase del acuse. No enseña ningún dato del formulario |
| `/legal/privacy` | Igual | Pinta `privacy-2026-11-borrador.svelte`, como `/legal/terms` |

- **Pie** (`+layout.svelte`): se añaden «Privacidad» (`/legal/privacy`) y «Contacto» (`/contact`) junto a «Condiciones de uso».
- `hooks.server.ts`: no hay que cambiar nada. `/contact` no lleva tokens, y `Cache-Control: no-store` ya se pone con sesión. La CSP tampoco cambia: no hay recursos externos.
- `api-client.ts`:

```ts
/** Siempre 202 si es válido (también ante un bot). No idempotente: un corte da OUTCOME_UNKNOWN. */
sendContactMessage: (event: RequestEvent, body: ContactRequest): Promise<ApiResult<void>> =>
  request(event, { method: 'POST', path: '/contact', body, expectStatus: 202, nonIdempotent: true }),
```

### 8.2 `/legal/privacy` (borrador)

- `src/lib/legal/privacy-2026-11-borrador.svelte`, con la misma forma que `terms-2026-11-borrador-2.svelte`: el aviso «Borrador pendiente de revisión jurídica», un `<h1>Política de privacidad</h1>`, «Versión {PRIVACY_POLICY_VERSION}» y los `[PENDIENTE]` visibles tal cual. Pone su propio `<title>`.
- Secciones mínimas (el texto lo cierran UX y la revisión jurídica):
  1. **Responsable**: [PENDIENTE: nombre o razón social, domicilio y correo].
  2. **Qué datos tratamos y para qué**: la cuenta (correo, fecha de nacimiento, contraseña cifrada, proveedores unidos y la aceptación de las condiciones) y el **formulario de contacto** (nombre, correo, teléfono si se da, asunto y mensaje), que solo sirve para responder.
  3. **Base jurídica**: [PENDIENTE: revisión jurídica].
  4. **Cuánto tiempo**: los mensajes de contacto, `{CONTACT_MESSAGE_RETENTION_DAYS}` días desde el envío, y la cuenta, hasta que se borra (sin confirmar el correo, 7 días). El número sale de la constante, no se escribe en el texto.
  5. **Quién más los recibe**: el proveedor de envío de correo, como encargado del tratamiento ([PENDIENTE: nombre y país]). No guardamos la dirección IP de quien escribe.
  6. **Tus derechos** (acceso, rectificación, supresión, oposición, limitación y portabilidad) y cómo ejercerlos: escribiendo a `MAIL_SUPPORT_ADDRESS`. [PENDIENTE: autoridad de control].
  7. **Cambios en esta política**.
- La dirección de soporte del texto sale de `GET /config` si hace falta. Si no, va como `[PENDIENTE]`, igual que en las condiciones.

### 8.3 Formulario

| Campo (`name`) | Control | Atributos |
|---|---|---|
| `name` | `<input type="text">` | `autocomplete="name"`, `maxlength="100"`, `required` |
| `email` | `EmailField` (el que ya existe) | `autocomplete="email"` |
| `phone` | `<input type="tel">` | `autocomplete="tel"`, `maxlength="30"`, opcional y marcado «(opcional)» en la etiqueta |
| `subject` | `<input type="text">` | `maxlength="150"`, `required` |
| `message` | `<textarea>` | `maxlength="3000"`, `rows="8"`, `required` |
| `acceptPrivacy` | `PrivacyCheckbox` | Desmarcada. El enlace a `/legal/privacy` va **fuera** de la etiqueta y abre una pestaña nueva, como `TermsCheckbox`. Lleva el oculto `privacyPolicyVersion` = `PRIVACY_POLICY_VERSION` |
| `website` | `HoneypotField` | Dentro de un contenedor fuera de la pantalla (no con `display:none`, que muchos bots detectan), con `aria-hidden="true"`, `tabindex="-1"` y `autocomplete="off"`, y con la etiqueta «No rellenes este campo» por si lo alcanza un lector de pantalla o un navegador sin CSS |

- El formulario usa `novalidate` y `use:enhance={submission.submit}`, igual que `/forgot-password`, y funciona sin JavaScript.
- `parseContactForm(data)` (`lib/forms/contact.ts`) devuelve los errores por campo (`FormErrors`) con los textos de `fieldMessages.contact`, o el cuerpo válido. Quita `phone` si queda vacío tras el `trim`, pasa `website` tal cual y pone `acceptPrivacy: data.get('acceptPrivacy') === 'on'` (si es `false`, el esquema da `required`).
- Al volver a pintar con errores se conservan `name`, `email`, `phone`, `subject` y `message`. El campo trampa nunca se devuelve y la casilla vuelve desmarcada.
- Errores de la API → `errorMessages.contact`: `RATE_LIMITED` → `contacto.error.limite`; `PRIVACY_VERSION_OUTDATED` → `contacto.error.privacidad_version` (en la casilla, desmarcada); `OUTCOME_UNKNOWN` → `contacto.error.incierto`; el resto → `contacto.error.servidor`. Un 400 de campos (que en la práctica no llega, porque la web valida antes) se pinta por campo.

### 8.4 Textos provisionales (`texts.ts`, a falta de UX)

No van en ningún documento UX, así que `texts.spec.ts` no los compara.

| Clave | Texto |
|---|---|
| `contacto.meta.titulo` | Contacto |
| `contacto.titulo` | Escríbenos |
| `contacto.texto.intro` | Cuéntanos qué necesitas y te responderemos al correo que nos indiques. |
| `contacto.campo.nombre` / `.correo` / `.telefono` / `.asunto` / `.mensaje` | Nombre / Correo electrónico / Teléfono (opcional) / Asunto / Mensaje |
| `contacto.campo.privacidad` | He leído y acepto la política de privacidad (versión {version}). |
| `contacto.enlace.privacidad` | Leer la política de privacidad |
| `contacto.campo.trampa` | No rellenes este campo |
| `contacto.boton.enviar` / `.enviando` / `contacto.estado.enviando` | Enviar mensaje / Enviando… / Enviando el mensaje… |
| `contacto.error.nombre_requerido` / `_largo` / `_formato` | Escribe tu nombre. / El nombre no puede pasar de 100 caracteres. / El nombre solo puede tener una línea de texto normal. |
| `contacto.error.asunto_requerido` / `_largo` / `_formato` | Escribe un asunto. / El asunto no puede pasar de 150 caracteres. / El asunto solo puede tener una línea de texto normal. |
| `contacto.error.mensaje_requerido` / `_largo` / `_formato` | Escribe tu mensaje. / El mensaje no puede pasar de 3000 caracteres. / El mensaje tiene caracteres que no podemos guardar. |
| `contacto.error.telefono_formato` / `_corto` / `_largo` | Escribe solo números, espacios y, si quieres, el prefijo con +. / El teléfono es demasiado corto. / El teléfono es demasiado largo. |
| `contacto.error.privacidad` | Para enviar el mensaje tienes que aceptar la política de privacidad. |
| `contacto.error.privacidad_version` | La política de privacidad ha cambiado mientras escribías. Léela de nuevo y vuelve a marcar la casilla. |
| `contacto.error.limite` | Has enviado varios mensajes seguidos. Espera un rato y vuelve a intentarlo. |
| `contacto.error.incierto` | No sabemos si tu mensaje ha llegado: se ha perdido la conexión. Si en unos días no te hemos respondido, vuelve a enviarlo. |
| `contacto.error.servidor` | No hemos podido enviar tu mensaje. Vuelve a intentarlo en unos minutos. |
| `contacto_enviado.meta.titulo` / `.titulo` | Mensaje enviado / Hemos recibido tu mensaje |
| `contacto_enviado.texto` | Te responderemos al correo que nos has indicado. |
| `contacto_enviado.texto.acuse` | Te hemos enviado un correo de confirmación; si no lo ves, mira en la carpeta de spam. |
| `comun.pie.privacidad` / `comun.pie.contacto` | Privacidad / Contacto |

Los errores de correo reutilizan `fieldMessages.register.email`, como `/forgot-password`.

---

## 9. Retención y borrado

| Dato | Cuánto vive | Cómo se borra |
|---|---|---|
| `contact_messages` | **180 días** desde `created_at` (propuesta, `CONTACT_MESSAGE_RETENTION_DAYS`) | `ContactRetentionSweeper`: al arrancar y cada hora, `DELETE FROM contact_messages WHERE created_at <= now - 180 d` en lotes de 500 mientras borre el lote entero. Log `{ event: 'contact_messages_deleted', count }` |
| Filas de contacto del *outbox* | Como las demás: se borran al enviarse; si fallan, a los 7 días | Además, en cascada al borrar su mensaje |
| A petición de la persona (supresión) | En el momento | Operación manual: `DELETE FROM contact_messages WHERE email = lower(btrim($1))`. La cascada borra sus correos pendientes. Hay que borrar también las copias del buzón (fila siguiente) |
| Copia en el buzón de `CONTACT_TO_ADDRESS` y las respuestas | Fuera de la aplicación | **Pendiente**: el mismo plazo, con una regla del proveedor de correo o a mano. Se anota en `privacidad-y-seguridad.md` |
| IP de quien escribe | No se guarda | Solo vive en el contador en memoria del *throttler* (como mucho 24 h, según el cubo) |

- **Por qué 180 días**: da tiempo a contestar y a una conversación de seguimiento, y no convierte el buzón en un archivo. Es más corto que el año que se ve a menudo, por minimización. Lo confirma el CTO (Preguntas) y lo revisa el jurídico.
- **El borrado de una cuenta no borra sus mensajes de contacto**: no están enlazados (A8). Puede que un mensaje sea justo para pedir ayuda con el borrado. La política lo dice (§8.2, sección 4), y la supresión a petición los cubre.
- **El borrado de una cuenta tampoco toca las filas de contacto del *outbox***: los tres `DELETE … WHERE to_email IN (deleted)` (`users.service.ts`, `data-review.service.ts`, `unverified-accounts.sweeper.ts`) añaden `AND contact_message_id IS NULL`. Si no, quien tuviera una cuenta con la dirección de `CONTACT_TO_ADDRESS` borraría al darse de baja los avisos pendientes del buzón, y cualquiera que borrase su cuenta anularía su propio acuse, que forma parte de otro tratamiento.

---

## 10. Riesgos y qué vigilar

| # | Riesgo | Qué lo cubre y qué vigilar |
|---|---|---|
| R-C1 | **Inyección de cabeceras** (`Bcc:` en el asunto, varias direcciones en `Reply-To`) | Tres capas (§4.3). En la prueba de QA no puede salir ninguna cabecera nueva |
| R-C2 | **HTML o *phishing* en el correo interno** | `escapeHtml` en todo, ningún enlace creado con lo que escribe la persona y un aviso antes del mensaje. **Residual**: el cliente de correo puede convertir en enlace una URL del texto plano; el aviso lo dice |
| R-C3 | **Acuse como spam o *backscatter*** (con `CONTACT_ACK_EMAIL=true`) | Sin contenido del usuario (A6), 3 al día por dirección y desactivado por defecto. **Residual**: una red de bots con muchas IP puede hacer que Cupidilla escriba a muchas direcciones distintas, y eso perjudica la reputación del dominio. Si se activa, hay que vigilar `mail_sent` con `kind=contact_ack` |
| R-C4 | **Inundación del buzón** con muchas IP | Límites por IP y por correo y campo trampa. Si pasa: un tope global en el *throttler* (A10), una trampa de tiempo firmada o un captcha |
| R-C5 | **IP del cliente mal propagada** | El límite por IP depende de que `event.getClientAddress()` devuelva la IP real detrás del *proxy* de producción (`ADDRESS_HEADER`/`XFF_DEPTH` del adaptador). Si no, todo el mundo comparte un cubo de 3 por hora. Hay que comprobarlo al desplegar, igual que en el registro |
| R-C6 | ***Throttler* en memoria** (R5 de H0) | Se pierde al reiniciar y no se comparte entre instancias |
| R-C7 | **El correo interno no llega** (SMTP caído, buzón que rechaza) | El mensaje queda en la base de datos y nunca se pierde. Tras ~8 h, `mail_failed` con `kind=contact_message`, y `notified_at` sigue a `NULL`. La alerta sobre `mail_failed` que ya pide R-M7 cubre esto. Consulta de diagnóstico: `SELECT count(*) FROM contact_messages WHERE notified_at IS NULL AND created_at < now() - interval '9 hours'` |
| R-C8 | **Datos personales en logs** | Nunca se registran el nombre, el correo, el teléfono, el asunto, el mensaje, la referencia ni la IP. Eventos sin identificadores: `contact_message_received` `{ ack }`, `contact_honeypot_triggered`, `contact_messages_deleted` `{ count }`, y los `mail_*` de siempre con su `kind` |
| R-C9 | **Base de datos filtrada** | Los mensajes están en claro, porque hay que leerlos. Por eso la retención es corta y no hay IP |
| R-C10 | **R-M17 (varias instancias del *worker*)** | Afecta igual a estos correos: como mucho, un correo interno duplicado. No bloquea con una sola instancia |
| R-C11 | **Política de privacidad en borrador** | La casilla guarda la versión `2026-11-borrador`. Cuando salga la definitiva, la versión cambia y los mensajes antiguos conservan la que se aceptó. Antes de tener usuarios reales hace falta el texto revisado |

---

## 11. Plan de implementación

Un PR, con las tareas en este orden. Cada una termina con sus pruebas en verde (`npm run lint`, `npm run check` y los tests del paquete que toca).

| # | Tarea | Hecho cuando |
|---|---|---|
| T1 | **Contratos**: `contact.ts` (§5.1), `PRIVACY_POLICY_VERSION`, `PRIVACY_VERSION_OUTDATED`, `contact` en `configResponseSchema` y la exportación en el índice | `contact.spec.ts` cubre cada campo con sus motivos (`required`, `invalid_format`, `too_short`, `too_long`, `unrecognized`), la normalización (NFC, `\r\n` → `\n`, correo en minúsculas, espacios del teléfono), el rechazo de `\r`, `\n`, `U+2028` y `U+202E` en el nombre y el asunto, y que 3000 caracteres de 4 bytes (emoji) pasan y 3001 no |
| T2 | **Esquema y migración**: `contact-messages.ts`, los cambios de `email-outbox.ts` (§3.2) y `0001_contact` | `npm run db:migrate` aplica sobre una base con `0000_init`. Prueba de integración del esquema (como `mail-schema.int.spec.ts`): cada CHECK de §3.1 rechaza su caso; un `contact_message` sin `contact_message_id` y un `verify_email` con él fallan por `email_outbox_contact_ref`; dos `verify_email` pendientes a la misma dirección siguen colapsando; dos `contact_message` con ids distintos y la misma dirección **no** colapsan; borrar un mensaje borra sus filas del *outbox* |
| T3 | **Configuración**: `CONTACT_TO_ADDRESS` y `CONTACT_ACK_EMAIL`, las reglas de §7.1, `GET /config` y `.env.example` | `env.schema.contact.spec.ts`: valores por defecto; `NODE_ENV=production` sin la variable o con `contacto@example.com` no arranca y el error nombra `CONTACT_TO_ADDRESS` sin enseñar su valor; la misma dirección que `MAIL_FROM` no arranca; ` Contacto@Cupidilla.ES ` se queda en `contacto@cupidilla.es`; `CONTACT_ACK_EMAIL=yes` no arranca |
| T4 | ***Mailer***: `replyTo`, `mailOptions` con el objeto de dirección y `assertHeaderSafe` | `smtp.mailer.spec.ts` con `streamTransport`: sale `Reply-To: ana@example.com`; un `subject` o un `replyTo` con `\n` lanzan `MailDeliveryError` permanente con `header_unsafe` y no se envía nada |
| T5 | **Plantillas**: el bloque `quote`, el pie opcional, `contact-message.ts` y `contact-ack.ts` | `templates-contact.spec.ts`: `<script>`, `"` y `&` del nombre, el asunto y el mensaje salen escapados en el HTML (también en el `<title>`); los saltos de línea se conservan; el acuse no contiene el nombre, el asunto ni ningún fragmento del mensaje; ningún `href` apunta fuera de `PUBLIC_WEB_URL` |
| T6 | ***Outbox***, ***worker*** y resolver: `enqueueContact`, `claim` con la referencia, la resolución de §4.2 y `notified_at` | Integración con `MemoryMailer`: tras `drain()`, el mensaje llega a `contacto@example.com` con `replyTo` y `notified_at` queda puesto; si el mensaje se borra antes de `drain()`, `skipped: 1` y no se envía nada; con un fallo transitorio, se reintenta y `notified_at` sigue a `NULL` hasta que se envía |
| T7 | **Módulo `contact`**: controlador, servicio y barrido, registrados en `AppModule` | Los escenarios C1–C14 de §12 que son de la API, en `test/contact.int.spec.ts` y `test/contact-retention.int.spec.ts` |
| T8 | **Borrado de cuentas**: `AND contact_message_id IS NULL` en los tres `DELETE` del *outbox* (§9) | Escenario C15 |
| T9 | **Web, `/legal/privacy`**: el componente del texto, la ruta y el pie | La página enseña «Versión 2026-11-borrador» y el aviso de borrador; el pie enlaza Privacidad y Contacto en todas las páginas |
| T10 | **Web, `/contact` y `/contact/sent`**: `parseContactForm`, `PrivacyCheckbox`, `HoneypotField`, `api-client`, los mensajes y los textos | Unitarios de `parseContactForm` (teléfono vacío eliminado, casilla, trampa tal cual) y de `errorMessages.contact` (cubre todos los códigos que puede dar la ruta). E2E con Mailpit: C1, C2, C9 y C16 |
| T11 | **Documentación**: en `README.md`, una fila del índice para este documento y una línea en el estado. En `apps/api/README.md`, las variables nuevas si las enumera. La sección de privacidad ya la añade este diseño | Los enlaces funcionan |

---

## 12. Criterios de aceptación para QA

Datos comunes: `TEST_NOW` = 2026-11-22T10:00:00Z. `CONTACT_TO_ADDRESS` = `contacto@example.com` y `CONTACT_ACK_EMAIL` = `false`, salvo que se diga otra cosa. Lucía escribe desde la IP 203.0.113.7 con este formulario válido: nombre «Lucía Pérez», correo `Lucia@Example.com`, sin teléfono, asunto «Duda sobre mi cuenta», mensaje «Hola,\r\nno me llega el correo.» y la casilla marcada. Los escenarios marcados **(QA)** se comprueban a mano y los demás son pruebas automáticas.

| # | Dado | Cuando | Entonces |
|---|---|---|---|
| C1 | El formulario válido de Lucía | Lo envía | La web redirige a `/contact/sent`. Hay **una** fila en `contact_messages` con `email = lucia@example.com`, `phone` a `NULL`, `message = "Hola,\nno me llega el correo."` y `privacy_policy_version = '2026-11-borrador'`. Llega **un** correo a `contacto@example.com`, con `From` = `MAIL_FROM`, `Reply-To: lucia@example.com`, el asunto «Contacto web: Duda sobre mi cuenta» y el nombre, el mensaje y «No indicado» en el cuerpo. `notified_at` queda puesto. Nada llega a `lucia@example.com` |
| C2 | Lo mismo con `CONTACT_ACK_EMAIL=true` | Lo envía | Además llega a `lucia@example.com` un correo con el asunto «Hemos recibido tu mensaje» y la referencia, que **no** contiene «Lucía», «Duda sobre mi cuenta» ni «no me llega». `/contact/sent` enseña la frase del acuse |
| C3 | Lucía envía 3 mensajes válidos distintos en 10 minutos | Se entregan los correos | `contacto@example.com` recibe **3** correos y hay 3 filas. No se colapsan |
| C4 | El formulario con el teléfono «+34 600  11 22 33» | Lo envía | Se guarda `+34 600 11 22 33`. Con «600-ABC» → 400 `phone: invalid_format` y no se guarda nada |
| C5 | Falta cada uno de los campos obligatorios, de uno en uno (nombre, correo, asunto, mensaje, casilla) | Lo envía | 400 con el campo y `required`. La página enseña el error junto a su campo y en el resumen, conserva lo escrito y no hay filas ni correos |
| C6 | Un mensaje de 3000 caracteres «😀» y otro de 3001 | Los envía | El primero se guarda (`char_length = 3000`); el segundo da `message: too_long` |
| C7 | Un asunto «Hola\r\nBcc: victima@example.net» enviado directamente a la API | `POST /contact` | 400 `subject: invalid_format`. No se guarda nada, Mailpit no recibe nada y nada llega a `victima@example.net` |
| C8 | Un mensaje con `<script>alert(1)</script> & "x"` y un nombre `<b>Eve</b>` | Se entrega | En el HTML del correo aparecen escapados (`&lt;script&gt;…`) y en el texto plano, literales. **(QA)** En Mailpit no se ejecuta nada y el texto se ve tal cual |
| C9 | El formulario válido con el campo `website` relleno («http://spam.example») | Lo envía | La web redirige a `/contact/sent`, igual que en C1. La API ha respondido `202`. No hay filas ni correos, y el log tiene `contact_honeypot_triggered` y ningún dato del formulario |
| C10 | `privacyPolicyVersion = '2026-10-vieja'` | `POST /contact` | 409 `PRIVACY_VERSION_OUTDATED`, sin filas. En la web, el error está en la casilla y la casilla aparece desmarcada |
| C11 | La IP 203.0.113.7 ha enviado 3 mensajes válidos esta hora (con 3 correos distintos) | Envía el 4.º | 429 `RATE_LIMITED` con `Retry-After`, sin filas nuevas. La web enseña `contacto.error.limite` |
| C12 | `lucia@example.com` ha enviado 3 mensajes hoy desde 3 IP distintas | Envía el 4.º desde otra IP | 429. Con `Lucia@EXAMPLE.com` también: el cubo es el del correo normalizado |
| C13 | El SMTP falla de forma transitoria 2 veces | Se drena 3 veces | El tercer intento entrega el correo. Mientras tanto la fila sigue en `contact_messages` con `notified_at` a `NULL`, y la respuesta HTTP fue `202` sin esperar |
| C14 | Un mensaje con `created_at` = 2026-05-25T10:00:00Z (181 días antes) y otro de hace 179 días, el primero con un correo fallido en el *outbox* | Corre `sweep()` | Se borra el de hace 181 días, y con él su fila del *outbox*. El de hace 179 sigue. El log dice `contact_messages_deleted` con `count: 1` |
| C15 | Ana (`ana@example.com`) tiene cuenta y un acuse pendiente en el *outbox* por un mensaje suyo, y hay una cuenta cuyo correo es `contacto@example.com` con un `contact_message` pendiente | Ana borra su cuenta, y se borra también la otra | Las dos filas de contacto siguen en el *outbox* y los mensajes siguen en `contact_messages` |
| C16 | **(QA)** Sin JavaScript, solo con teclado y con un lector de pantalla | Se rellena y se envía | Funciona. El campo trampa no se ve, no se alcanza con Tab y el lector no lo anuncia. El enlace de privacidad abre `/legal/privacy` en una pestaña nueva y la etiqueta de la casilla no lo incluye |
| C17 | `NODE_ENV=production` con `CONTACT_TO_ADDRESS` sin poner, con `contacto@example.com` o con la dirección de `MAIL_FROM` | Arranca la API | No arranca y el error nombra `CONTACT_TO_ADDRESS`. Con `contacto@cupidilla.es` (y el resto de la configuración de producción válida), arranca |
| C18 | Cualquiera de los escenarios anteriores | Se revisan los logs de la API y de la web | No aparecen el nombre, el correo, el teléfono, el asunto, el mensaje, la referencia ni la IP |
| C19 | Con sesión de Ana | Abre `/contact` | El correo viene rellenado con `ana@example.com` y se puede cambiar. Al enviar, la fila no guarda ninguna referencia a la cuenta |
| C20 | Las cinco filas de los correos de cuenta (registro, reenvío y recuperación) | Se repiten las pruebas de correo actuales | Todas siguen en verde: la deduplicación por `(kind, to_email)` no ha cambiado |

---

## Preguntas para el CTO

1. **Plazo de retención**: propongo 180 días para `contact_messages` y la misma regla para el buzón de `CONTACT_TO_ADDRESS`. ¿Lo confirmas, o prefieres otro plazo hasta que lo diga la revisión jurídica?
2. **Textos**: no hay diseño UX de esta página. ¿Pasa por UX antes de implementarla, o se aceptan los textos provisionales de §8.4 y de las plantillas, y UX los revisa después?
3. **El registro y la política de privacidad**: hoy el alta solo enlaza las condiciones de uso. ¿El alta también debe enlazar `/legal/privacy` (y guardar su versión)? Lo he dejado fuera de alcance.
4. **El buzón de `CONTACT_TO_ADDRESS`**: ¿en qué proveedor estará y quién lo lee? Hace falta para aplicar ahí la retención y para declararlo como encargado en la política.
