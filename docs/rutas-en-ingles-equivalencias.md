# Equivalencias: rutas y nombres internos de la web en inglés

[← Plan](plan-rutas-en-ingles.md) · [Decisiones](decisiones.md) (decisión 18) · [Diseño técnico](h0-diseno-tecnico.md)

Tabla exacta «antes → después» para el PR `rutas-en-ingles`. Sale de recorrer `apps/web/src` y `apps/web/tests` tal como están tras fusionar H0. El programador la aplica tal cual: si encuentra un identificador en español que no está aquí, lo consulta antes de inventar un nombre.

**Regla general.** Pasan a inglés las URL y todo lo que el código usa como identificador: carpetas, parámetros y sus valores, acciones, `name` e `id` del HTML, atributos ARIA que apuntan a ids, claves de objetos, uniones de tipos, clases CSS, atributos `data-`, variables y nombres de archivo. Se quedan en español los textos, sus claves, los tokens de diseño y los comentarios (§13). Los nombres en inglés son los del contrato de la API cuando existe uno (`email`, `password`, `birthDate`, `acceptTerms`, `termsVersion`).

**No vale un buscar y reemplazar global.** Las mismas palabras aparecen dentro de claves de texto que no cambian: `registro.error.correo_vacio`, `eliminar.error.contrasena`, `cuenta.datos.condiciones`, `registro.error.anio`, `comun.nav.entrar`… Cada cambio se hace en el archivo y la línea que indica la columna «Dónde».

---

## 1. Carpetas de rutas (`git mv`)

| # | Antes | Después |
|---|---|---|
| 1 | `src/routes/(invitado)/` | `src/routes/(guest)/` |
| 2 | `src/routes/(privado)/` | `src/routes/(private)/` |
| 3 | `(invitado)/registro/` | `(guest)/register/` |
| 4 | `(invitado)/entrar/` | `(guest)/login/` |
| 5 | `(privado)/cuenta/` | `(private)/account/` |
| 6 | `(privado)/cuenta/eliminar/` | `(private)/account/delete/` |
| 7 | `legal/condiciones/` | `legal/terms/` |

Resultado:

```
src/routes/
├─ +layout.svelte | +layout.server.ts | +page.svelte | +error.svelte
├─ (guest)/register/+page.svelte | +page.server.ts
├─ (guest)/login/+page.svelte | +page.server.ts
├─ (private)/account/+page.svelte | +page.server.ts          # acción «logout»
├─ (private)/account/delete/+page.svelte | +page.server.ts
└─ legal/terms/+page.svelte
```

Hecho con `git mv` (para conservar el historial), seguido de `npm run typecheck`, que regenera `.svelte-kit` con `svelte-kit sync`.

## 2. URL y prefijos de `route.id` escritos como cadena

Ninguna de estas cadenas la comprueba `typecheck`: hay que cambiarlas una a una.

| # | Antes | Después | Dónde |
|---|---|---|---|
| 8 | `routeId.startsWith('/(privado)')` | `routeId.startsWith('/(private)')` | `src/hooks.server.ts` (`guardRoutes`) |
| 9 | `routeId.startsWith('/(invitado)')` | `routeId.startsWith('/(guest)')` | `src/hooks.server.ts` (`guardRoutes`) |
| 10 | `` redirect(303, `/entrar?siguiente=${next}`) `` | `` redirect(303, `/login?next=${next}`) `` | `src/hooks.server.ts` |
| 11 | `redirect(303, '/cuenta')` | `redirect(303, '/account')` | `src/hooks.server.ts`, `(guest)/register/+page.server.ts` |
| 12 | `redirect(303, '/entrar?siguiente=/cuenta')` | `redirect(303, '/login?next=/account')` | `(private)/account/+page.server.ts`, `(private)/account/delete/+page.server.ts` |
| 13 | `redirect(303, '/?aviso=sesion-cerrada')` | `redirect(303, '/?notice=signed-out')` | `(private)/account/+page.server.ts` |
| 14 | `redirect(303, '/?aviso=cuenta-eliminada')` | `redirect(303, '/?notice=account-deleted')` | `(private)/account/delete/+page.server.ts` |
| 15 | `action="/cuenta?/salir"` | `action="/account?/logout"` | `(private)/account/+page.svelte` |

## 3. Argumentos de `resolve()` y enlaces tipados

`resolve()` está tipado: `typecheck` falla si queda alguno sin cambiar.

| # | Antes | Después | Dónde |
|---|---|---|---|
| 16 | `resolve('registro')` | `resolve('register')` | `+layout.svelte`, `+page.svelte`, `(guest)/login/+page.svelte` |
| 17 | `resolve('entrar')` | `resolve('login')` | `+layout.svelte`, `+page.svelte`, `(guest)/register/+page.svelte` (dos: enlace del pie de la tarjeta y el del fragmento `emailTaken`) |
| 18 | `resolve('cuenta')` | `resolve('account')` | `+layout.svelte`, `+page.svelte`, `(private)/account/delete/+page.svelte` |
| 19 | `resolve('cuenta/eliminar')` | `resolve('account/delete')` | `(private)/account/+page.svelte` |
| 20 | `resolve('legal/condiciones')` | `resolve('legal/terms')` | `+layout.svelte`, `(guest)/register/+page.svelte` |
| 21 | `route: 'entrar' \| 'cuenta'` (tipo de `GeneralLink`) | `route: 'login' \| 'account'` | `lib/components/ErrorSummary.svelte` |
| 22 | `{ route: 'entrar', … }` | `{ route: 'login', … }` | `(guest)/register/+page.svelte` (`generalLink`) |
| 23 | `{ route: 'cuenta', … }` | `{ route: 'account', … }` | `(private)/account/delete/+page.svelte` (`generalLink`) |

## 4. Parámetros de consulta y sus valores

### 4.1 `?siguiente=` → `?next=` (acuerdo A6)

| # | Antes | Después | Dónde |
|---|---|---|---|
| 24 | parámetro `siguiente` | `next` | `url.searchParams.get('siguiente')` en `(guest)/login/+page.server.ts` (`load`) |
| 25 | campo oculto `name="siguiente"` | `name="next"` | `(guest)/login/+page.svelte` |
| 26 | `textField(data, 'siguiente')` | `textField(data, 'next')` | `(guest)/login/+page.server.ts` (acción) |
| 27 | `RETURN_PATHS = ['/cuenta', '/cuenta/eliminar']` | `RETURN_PATHS = ['/account', '/account/delete']` | `lib/server/return-path.ts` |
| 28 | `DEFAULT_RETURN_PATH = '/cuenta'` | `DEFAULT_RETURN_PATH = '/account'` | `lib/server/return-path.ts` |

Valores de la lista cerrada, completa: `/account` y `/account/delete`. Cualquier otro (incluidos los antiguos `/cuenta` y `/cuenta/eliminar`) se ignora y lleva a `/account`. La comparación sigue siendo exacta: `/account/` y `/account?x=1` no valen.

### 4.2 `?aviso=` → `?notice=` (acuerdo A7)

| # | Antes | Después | Dónde |
|---|---|---|---|
| 29 | parámetro `aviso` | `notice` | `page.url.searchParams.get('aviso')` en `src/routes/+page.svelte` |
| 30 | valor `sesion-cerrada` | `signed-out` | clave del `Map` `NOTICES` en `+page.svelte`; redirección n.º 13 |
| 31 | valor `cuenta-eliminada` | `account-deleted` | clave del `Map` `NOTICES` en `+page.svelte`; redirección n.º 14 |

Valores de la lista cerrada, completa: `signed-out` y `account-deleted`. Las claves de texto a las que apuntan no cambian (`portada.aviso.sesion_cerrada`, `portada.aviso.cuenta_eliminada`). `signed-out` y no `logged-out`: describe un estado, como `account-deleted`, y casa con `data.signedIn` del layout.

## 5. Acciones de formulario

| # | Antes | Después | Dónde |
|---|---|---|---|
| 32 | acción con nombre `salir` (`actions = { salir: … }`) | `logout` | `(private)/account/+page.server.ts` |

Las otras tres acciones (registro, entrar, eliminar) son `default` y no tienen nombre: no cambian.

## 6. Campos de formulario: `name`, `id`, `for` y clave en los objetos

En los tres formularios el `id` del control es igual a su `name`, y esa misma cadena es la clave en `FormErrors.fields`, en `values` y el `target` del resumen de errores (`href="#…"`). Por eso cambian juntos.

| # | Antes | Después | Formularios | Dónde |
|---|---|---|---|---|
| 33 | `correo` | `email` | registro, entrar | `EmailField.svelte` (`for`, `id`, `name`); `login.ts`, `register.ts` (`textField`, `LoginValues`, `RegisterValues`, `errors.fields`); `targets` del resumen en las páginas de registro y entrar; `fields.correo`, `values?.correo`, `form?.values?.correo` en esas páginas; `onlyField({ correo: … })` en `(guest)/register/+page.server.ts` |
| 34 | `contrasena` | `password` | registro, entrar, eliminar | `PasswordField.svelte` (`for`, `id`, `name`, `aria-controls`); `login.ts`, `register.ts`, `delete-account.ts` (`textField`, `errors.fields`); páginas de registro, entrar y eliminar (`fields.contrasena`, `form?.errors?.fields?.contrasena`, `target: 'contrasena'`); `{ fields: { contrasena: message } }` en `(private)/account/delete/+page.server.ts` |
| 35 | `dia` | `day` | registro | `DatePart`, `PART_PROBLEM`, `parts`, `valid`, listas `['dia', 'mes', 'anio']` en `birth-date.ts`; `RegisterValues` y `dateParts` en `register.ts`; `dateParts` (id) e `invalidParts[0] ?? 'dia'` en `(guest)/register/+page.svelte` |
| 36 | `mes` | `month` | registro | ídem |
| 37 | `anio` | `year` | registro | ídem; además `part.id === 'anio'` en `(guest)/register/+page.svelte` |
| 38 | `condiciones` (casilla) | `acceptTerms` | registro | `(guest)/register/+page.svelte` (`id`, `name`, `fields.condiciones`, `values?.condiciones`, `target`); `register.ts` (`textField(data, 'condiciones')`, `RegisterValues.condiciones`, `errors.fields.condiciones`); `{ ...values, condiciones: false }` y `onlyField({ condiciones: … })` en `(guest)/register/+page.server.ts` |
| 39 | `version_condiciones` (campo oculto) | `termsVersion` | registro | `(guest)/register/+page.svelte` (`name`); `register.ts` (`textField`) |
| 40 | `siguiente` (campo oculto) | `next` | entrar | ver n.º 25 y 26 |
| 41 | `fecha` (clave de error del grupo de fecha, sin control propio) | `birthDate` | registro | `RegisterField`; `errors.fields.fecha` en `register.ts`; `fields.fecha` en `(guest)/register/+page.svelte` |

El `id` y el `name` de la casilla van en camelCase (`acceptTerms`) porque son la misma cadena que la clave del contrato y de `fields`. Los ids auxiliares de §8 van en kebab-case.

Notas sobre los tipos de `lib/forms/`:

- `birth-date.ts`: `PART_PROBLEM` queda `{ day: 'day', month: 'month', year: 'year' }`. Se conserva: `DatePart` (nombre del campo) y `BirthDateProblem` (motivo) son tipos distintos aunque ahora coincidan tres valores.
- `(guest)/register/+page.svelte` usa `values?.[part.id]`: funciona porque las claves de `RegisterValues` para la fecha son exactamente los valores de `DatePart`. Al renombrar, siguen coincidiendo (`day`, `month`, `year`).

## 7. Tipos, uniones y claves de los mapas de mensajes

| # | Antes | Después | Dónde |
|---|---|---|---|
| 42 | `FormName = 'registro' \| 'entrar' \| 'eliminar' \| 'salir'` | `FormName = 'register' \| 'login' \| 'delete' \| 'logout'` | `lib/errors/messages.ts` |
| 43 | claves de `errorMessages`: `registro`, `entrar`, `eliminar`, `salir` | `register`, `login`, `delete`, `logout` | `lib/errors/messages.ts`; usos `errorMessages.registro[…]` (`(guest)/register/+page.server.ts`), `.entrar[…]` (`(guest)/login/+page.server.ts`), `.eliminar[…]` (`(private)/account/delete/+page.server.ts`), `.salir[…]` (`(private)/account/+page.server.ts`) |
| 44 | claves de `fieldMessages`: `registro`, `entrar`, `eliminar` | `register`, `login`, `delete` | `lib/errors/messages.ts`; usos `fieldMessages.registro` (`register.ts`), `.entrar` (`login.ts`), `.eliminar` (`delete-account.ts`) |
| 45 | `LoginField = 'correo' \| 'contrasena'` | `LoginField = 'email' \| 'password'` | `lib/forms/login.ts` |
| 46 | `LoginValues { correo }` | `LoginValues { email }` | `lib/forms/login.ts` |
| 47 | `RegisterField = 'correo' \| 'contrasena' \| 'fecha' \| 'condiciones'` | `RegisterField = 'email' \| 'password' \| 'birthDate' \| 'acceptTerms'` | `lib/forms/register.ts` |
| 48 | `RegisterValues { correo, dia, mes, anio, condiciones }` | `RegisterValues { email, day, month, year, acceptTerms }` | `lib/forms/register.ts` |
| 49 | `DeleteAccountField = 'contrasena'` | `DeleteAccountField = 'password'` | `lib/forms/delete-account.ts` |
| 50 | `DatePart = 'dia' \| 'mes' \| 'anio'` | `DatePart = 'day' \| 'month' \| 'year'` | `lib/forms/birth-date.ts` |
| 51 | `Notice` prop `tone: 'exito' \| 'info'` | `tone: 'success' \| 'info'` | `lib/components/Notice.svelte`; uso `tone="exito"` en `src/routes/+page.svelte` |
| 52 | `SubmitButton` prop `variant?: 'primario' \| 'peligro'` (por defecto `'primario'`) | `variant?: 'primary' \| 'danger'` (por defecto `'primary'`) | `lib/components/SubmitButton.svelte`; uso `variant="peligro"` en `(private)/account/delete/+page.svelte` |

`delete` es palabra reservada de JavaScript. Como clave de objeto es válida (`errorMessages.delete`, `fieldMessages.delete.password`), pero no como nombre de variable: ver n.º 104.

`tone` y `variant` componen clases CSS (`aviso-{tone}`, `boton-{variant}`): cambian a la vez que las clases n.º 68 a 76.

## 8. Ids auxiliares, atributos ARIA y atributos `data-`

| # | Antes | Después | Dónde |
|---|---|---|---|
| 53 | `id="error-correo"` / `aria-describedby="error-correo"` | `email-error` | `EmailField.svelte` |
| 54 | `id="error-contrasena"` | `password-error` | `PasswordField.svelte` (`FieldError` y `describedBy`) |
| 55 | `id="ayuda-contrasena"` | `password-help` | `PasswordField.svelte` (`<p>` y `describedBy`) |
| 56 | `id="ayuda-nacimiento"` | `birth-date-help` | `(guest)/register/+page.svelte` (`<p>` y `aria-describedby` del `fieldset`) |
| 57 | `id="error-fecha"` | `birth-date-error` | `(guest)/register/+page.svelte` (`FieldError`, `aria-describedby` del `fieldset` y de cada parte) |
| 58 | `id="ayuda-condiciones"` | `accept-terms-help` | `(guest)/register/+page.svelte` |
| 59 | `id="error-condiciones"` | `accept-terms-error` | `(guest)/register/+page.svelte` |
| 60 | `id="resumen-errores-titulo"` / `aria-labelledby` | `error-summary-title` | `ErrorSummary.svelte` |
| 61 | `id="contenido"` y `href="#contenido"` | `content` / `#content` | `+layout.svelte` (`<main>` y enlace «Saltar al contenido») |
| 62 | `id="cuenta-datos"` / `aria-labelledby` | `account-details` | `(private)/account/+page.svelte` |
| 63 | `id="cuenta-cupidilla"` / `aria-labelledby` | `account-cupidilla` | `(private)/account/+page.svelte` |
| 64 | `id="cuenta-sesion"` / `aria-labelledby` | `account-session` | `(private)/account/+page.svelte` |
| 65 | `id="cuenta-eliminar"` / `aria-labelledby` | `account-delete` | `(private)/account/+page.svelte` |
| 66 | `data-foco-resultado` | `data-result-focus` | `submission.svelte.ts` (selector `[data-foco-resultado]`), `ErrorSummary.svelte`, `(guest)/register/+page.svelte` (`<h1>` de menor), `(private)/account/+page.svelte` |

Los atributos de SvelteKit (`data-sveltekit-reload`, `data-sveltekit-preload-data`) no son nuestros y no cambian.

## 9. Clases CSS

Se renombran en `src/app.css` (selector) y en cada `.svelte` que las usa, incluidas las que se componen con una variable y la directiva `class:`.

| # | Antes | Después |
|---|---|---|
| 67 | `acciones` | `actions` |
| 68 | `aviso` | `notice` |
| 69 | `aviso-exito` (desde `aviso-{tone}`) | `notice-success` (desde `notice-{tone}`) |
| 70 | `aviso-info` (desde `aviso-{tone}`) | `notice-info` (desde `notice-{tone}`) |
| 71 | `boton` | `button` |
| 72 | `boton-primario` (también desde `boton-{variant}`) | `button-primary` (desde `button-{variant}`) |
| 73 | `boton-secundario` | `button-secondary` |
| 74 | `boton-peligro` (desde `boton-{variant}`) | `button-danger` |
| 75 | `boton-peligro-secundario` | `button-danger-secondary` |
| 76 | `boton-texto` | `button-text` |
| 77 | `ayuda` | `help` |
| 78 | `borrador` | `draft` |
| 79 | `cabecera` | `site-header` |
| 80 | `marca` | `brand` |
| 81 | `navegacion` | `site-nav` |
| 82 | `pie` | `site-footer` |
| 83 | `campo` | `field` |
| 84 | `casilla` | `checkbox` |
| 85 | `casilla-bloque` | `checkbox-block` |
| 86 | `control-contrasena` | `password-control` |
| 87 | `datos` | `data-list` |
| 88 | `enlace-bloque` | `block-link` |
| 89 | `error-campo` | `field-error` |
| 90 | `fecha` | `birth-date` |
| 91 | `fecha-partes` | `birth-date-parts` |
| 92 | `parte` | `date-part` |
| 93 | `parte-anio` (`class:parte-anio={part.id === 'anio'}`) | `date-part-year` (`class:date-part-year={part.id === 'year'}`) |
| 94 | `icono` | `icon` |
| 95 | `lectura` | `prose` |
| 96 | `pequeno` | `small-print` |
| 97 | `resumen-errores` | `error-summary` |
| 98 | `saltar` | `skip-link` |
| 99 | `seccion` | `section` |
| 100 | `tarjeta` | `card` |
| 101 | `visualmente-oculto` | `visually-hidden` |

`app` (en `app.html`) ya está en inglés. Las propiedades personalizadas (`--color-texto`, `--ancho-dia`, `--foco-anillo`…) **no** cambian (§13).

## 10. Archivos, funciones y variables de `apps/web/src`

Los archivos y las funciones de `lib/` (`forms/`, `server/`, `errors/`, `components/`) ya tienen nombres en inglés: no se renombra ninguno. Lo que está en español dentro de ellos son las claves y los valores ya listados en §6 a §9. El único archivo de `lib/` con una palabra en español es `legal/terms-2026-11-borrador.svelte`, y se queda así (§13).

## 11. Tests (`src/**/*.spec.ts` y `tests/e2e/`)

Los tests aplican todo lo anterior: URL, parámetros y valores, nombres de campo en los `FormData`, ids en los selectores (`#correo` → `#email`, `#error-fecha` → `#birth-date-error`…), clases (`.resumen-errores` → `.error-summary`…) y claves de `errorMessages`/`fieldMessages`. Además, estos identificadores propios de los tests:

| # | Antes | Después | Dónde |
|---|---|---|---|
| 102 | `const registro = await import('./(invitado)/registro/+page.server.ts')` | `const registerPage = await import('./(guest)/register/+page.server.ts')` | `src/routes/actions.spec.ts` |
| 103 | `const entrar = await import('./(invitado)/entrar/+page.server.ts')` | `const loginPage = await import('./(guest)/login/+page.server.ts')` | `src/routes/actions.spec.ts` |
| 104 | `const cuenta = …('./(privado)/cuenta/+page.server.ts')` y `const eliminar = …('./(privado)/cuenta/eliminar/+page.server.ts')` | `const accountPage = …('./(private)/account/+page.server.ts')` y `const deletePage = …('./(private)/account/delete/+page.server.ts')` | `src/routes/actions.spec.ts` |
| 105 | `const salir = () => …cuenta.actions.salir(…)` | `const submitLogout = () => …accountPage.actions.logout(…)` | `src/routes/actions.spec.ts` |
| 106 | parámetro `siguiente` de `it.each(…)('siguiente=%j → …', async (siguiente, expected) => … submit({ siguiente }))` | `next` (`'next=%j → …'`, `async (next, expected)`, `submit({ next })`) | `src/routes/actions.spec.ts` |
| 107 | `for (const correo of [...])` | `for (const email of [...])` (y `form({ email })`) | `src/lib/forms/register.spec.ts` |
| 108 | `for (const aviso of …)` | `for (const notice of …)` | `tests/e2e/segunda-revision.e2e.ts`, `tests/e2e/ux-flows.e2e.ts` |
| 109 | `registroConErrores` | `registerErrorCases` | `tests/e2e/segunda-revision.e2e.ts` |
| 110 | `SERVIDOR_REGISTRO`, `SERVIDOR_ENTRAR`, `SERVIDOR_SALIR`, `SERVIDOR_ELIMINAR` | `REGISTER_SERVER_ERROR`, `LOGIN_SERVER_ERROR`, `LOGOUT_SERVER_ERROR`, `DELETE_SERVER_ERROR` | `tests/e2e/resilience.e2e.ts`; `SERVIDOR_ENTRAR` y `SERVIDOR_SALIR` también en `tests/e2e/outcome-unknown.e2e.ts` |
| 111 | `LIMITE` | `RATE_LIMIT_TEXT` | `tests/e2e/resilience.e2e.ts` |
| 112 | `INCIERTO_REGISTRO`, `INCIERTO_ELIMINAR` | `REGISTER_UNCERTAIN`, `DELETE_UNCERTAIN` | `tests/e2e/outcome-unknown.e2e.ts` |
| 113 | `COMPROBAR_ENTRADA`, `COMPROBAR_CUENTA` | `CHECK_LOGIN_LINK`, `CHECK_ACCOUNT_LINK` | `tests/e2e/outcome-unknown.e2e.ts` |
| 114 | `CORREO_EXISTENTE` | `EMAIL_TAKEN_TEXT` | `tests/e2e/outcome-unknown.e2e.ts` |
| 115 | archivo `tests/e2e/segunda-revision.e2e.ts` | `tests/e2e/second-review.e2e.ts` (`git mv`) | — |
| 116 | archivo `tests/e2e/tercera-revision.e2e.ts` | `tests/e2e/third-review.e2e.ts` (`git mv`) | — |
| 117 | proyecto de Playwright `chromium-sin-js` | `chromium-no-js` | `playwright.config.ts` (y el comentario de `account-lifecycle.e2e.ts`) |

Puntos de los tests que no son un simple cambio de cadena:

- **Valores de aviso desconocidos** (`segunda-revision` → `second-review`, test BUG-QA-1, y `ux-flows`, test C18): las variantes se rehacen sobre el valor nuevo: `sesion-cerrada%20` → `signed-out%20`, `%20sesion-cerrada` → `%20signed-out`, `SESION-CERRADA` → `SIGNED-OUT`, `sesion_cerrada` → `signed_out`; `/?aviso[]=sesion-cerrada` → `/?notice[]=signed-out`; `/?aviso=constructor&aviso=sesion-cerrada` → `/?notice=constructor&notice=signed-out`. Se añaden a las listas de valores desconocidos de esos dos tests `/?aviso=sesion-cerrada` (parámetro viejo) y `?notice=sesion-cerrada` y `?notice=cuenta-eliminada` (valores viejos): no muestran nada. Son iteraciones dentro de tests existentes, así que el número de tests no cambia.
- **Glob y expresiones regulares con la ruta**: `page.route('**/registro', …)` (`ux-a11y`, C30) → `'**/register'`; `/entrar$/` (`ux-flows`) → `/login$/`; `/\/registro$/` (`resilience`) → `/\/register$/`; `/\/entrar/` (`tercera-revision`, `outcome-unknown`) → `/\/login/`; `/aviso=sesion-cerrada/`, `/\/\?aviso=sesion-cerrada$/` y `/aviso=cuenta-eliminada/` → `/notice=signed-out/`, `/\/\?notice=signed-out$/` y `/notice=account-deleted/`; `/#contenido$/` (`ux-a11y`, C38/C40) → `/#content$/`; `/#contrasena$/` (`ux-a11y`) → `/#password$/`.
- **Selectores de atributo**: `form[action="/cuenta?/salir"]` → `form[action="/account?/logout"]` y `a[href*="salir"]` → `a[href*="logout"]` (`ux-flows`, C58); `page.goto('/cuenta?/salir')` → `page.goto('/account?/logout')`.
- **Nombre de clase exacto**: `ux-a11y` (C34) y `outcome-unknown` comparan `firstElementChild.className` con `toBe('resumen-errores')` → `toBe('error-summary')`.
- **`actionStatus(page, path, …)`** (`outcome-unknown`) filtra con `r.url().includes(path)`: `'/registro'` → `'/register'` y `'/cuenta/eliminar'` → `'/account/delete'`. El navegador nunca ve `/auth/register` (eso va de SvelteKit a la API), así que `'/register'` no coincide con otra petición.
- **Fallos del proxy** (`proxy.setFault('POST /auth/register', …)`, `REGISTER`, `DELETION`): son rutas de la API y no cambian.
- **Títulos de los tests y etiquetas de `measure()` / `expectNoHorizontalScroll()`**: el texto sigue en español; solo se cambia la ruta que citan (`'E-8: … en /, /registro ni /cuenta'` → `'… en /, /register ni /account'`, `'/cuenta/eliminar: contraseña vacía'` → `'/account/delete: contraseña vacía'`…). Los títulos generados con `%s` a partir de `errorMessages` dirán `register`, `login`… en lugar de `registro`, `entrar`…: es esperado.

## 12. Comentarios que citan una ruta, un parámetro o un campo

Los comentarios siguen en español; solo se cambia el identificador citado. Hoy hay estos:

- `src/hooks.server.ts` («se vuelve a /cuenta»).
- `src/lib/server/return-path.ts` («si no, `/cuenta`»).
- `src/lib/forms/login.ts` (/entrar), `register.ts` (/registro), `delete-account.ts` (/cuenta/eliminar).
- `src/lib/texts.ts` y `src/lib/legal/terms-2026-11-borrador.svelte` (/legal/condiciones).
- `src/routes/(guest)/register/+page.svelte` («“entra” enlaza a /entrar»), `(guest)/login/+page.server.ts` («`siguiente` solo se conserva…»).
- Comentarios de los tests (`tercera-revision`, `outcome-unknown`, `ux-a11y`, `forms.ts`, `account-lifecycle`…).
- Fuera de la web: `packages/contracts/src/consents.ts` («Versión vigente del texto de /legal/condiciones»). `dist/` se regenera con `npm run build:contracts`.

## 13. Lo que NO se renombra, y por qué

| Qué | Ejemplos | Por qué |
|---|---|---|
| Claves de texto y sus espacios de nombres | `registro.error.servidor`, `entrar.campo.correo`, `eliminar.error.contrasena`, `cuenta.datos.condiciones`, `comun.nav.entrar`, `portada.aviso.sesion_cerrada`, `condiciones.meta.titulo` | Son los identificadores del documento de UX (unas 190 claves) y `texts.spec.ts` las compara con su §5. Decisión 18 |
| Marcadores dentro de los textos | `{version}`, `{fecha}` en `fill('cuenta.datos.condiciones_valor', { version, fecha })` | Forman parte del texto de UX §5; la clave `fecha` de ese objeto tiene que coincidir con el marcador |
| Textos visibles | «Entrar», «Crear cuenta», «Saltar al contenido», la búsqueda de `'entra;'` y `'entra'.length` en `(guest)/register/+page.svelte` | Son interfaz en español. La búsqueda de «entra» localiza la palabra dentro del texto para enlazarla, no es una ruta |
| Nombres accesibles en los tests | `getByLabel('Correo electrónico')`, `getByRole('button', { name: 'Entrar' })`, `'(cuerpo)'` de `focusedLabel` | Buscan texto visible o son etiquetas de diagnóstico, no identificadores |
| Comentarios y documentación | — | Siguen en español; solo cambian las rutas que citan (§12) |
| Tokens de diseño (propiedades CSS personalizadas) | `--color-texto`, `--color-exito`, `--ancho-dia`, `--ancho-anio`, `--foco-anillo`, `--casilla` | Son el vocabulario de UX §7, como las claves de texto, y `tokens.spec.ts` los cita. Renombrar solo los que UX no nombra dejaría `:root` en dos idiomas |
| Cookie de sesión | `cupidilla_session` | Ya está en inglés |
| Versión de las condiciones y su archivo | `SERVICE_TERMS_VERSION = '2026-11-borrador'`, `lib/legal/terms-2026-11-borrador.svelte` | Es un dato: se guarda en `consents.policy_version` y lo comparte la API. El archivo lleva la versión en el nombre, y `texts.spec.ts` lo lee por esa ruta |
| Rutas y contrato de la API | `/auth/login`, `/users/me/deletion`, `email`, `birthDate`… | Ya están en inglés |
| Idioma y zona | `lang="es"`, `'es-ES'`, `Europe/Madrid` | Son configuración regional, no nombres |
| Atributos de SvelteKit y del HTML | `data-sveltekit-reload`, `autocomplete="bday-day"`… | No son nuestros |
| Ids de criterios y casos de prueba | `C58`, `E-2`, `BUG-QA-1`, `W-3` | Son referencias a los documentos de diseño y QA |

## 14. Comprobación final (para el programador y tester-qa)

```bash
cd apps/web
# URL, parámetros, valores, acciones y grupos en español: debe salir vacío
grep -rnE "/(entrar|registro|cuenta)\b|legal/condiciones|\(invitado\)|\(privado\)|siguiente|aviso=|\?/salir|sesion-cerrada|cuenta-eliminada" src tests
# Nombres de campo, ids y atributos en español (fuera de claves de texto): debe salir vacío
grep -rnE "(name|id|for|aria-controls|aria-describedby|aria-labelledby)=[\"'{][^\"'}]*\b(correo|contrasena|dia|mes|anio|condiciones|version_condiciones|siguiente|ayuda-|error-(correo|contrasena|fecha|condiciones)|contenido|cuenta-)" src
grep -rnE "#(correo|contrasena|dia|mes|anio|condiciones|contenido|error-|ayuda-)" src tests
grep -rnE "textField\(data, '(correo|contrasena|dia|mes|anio|condiciones|version_condiciones|siguiente)'\)" src
# Clases CSS: cada clase de app.css se usa en algún .svelte y al revés.
# Solo deben salir `app` (está en app.html) y las que se componen: notice-success, notice-info, button-danger
comm -3 <(grep -oE "\.[a-z][a-z-]*" src/app.css | tr -d . | sort -u) \
        <(grep -rhoE "class(:|=\")[a-z][a-z{} -]*" src --include=*.svelte | sed -E 's/class[:=]"?//' | tr ' ' '\n' | grep -v '{' | grep . | sort -u)
```

El `grep` del plan con `contrasena` o `salir` a secas da falsos positivos en claves de texto (`eliminar.error.contrasena`) y en prosa: usar los de arriba. El primero tiene un falso positivo conocido, el comentario «el siguiente test» de `src/lib/server/api-client.spec.ts`, que se queda como está. Comprobado sobre el código actual: los tres primeros `grep` dan hoy 225, 29 y 56 líneas, y la comparación de clases da `app`, `aviso-exito`, `aviso-info` y `boton-peligro`.

Después, desde `npm run db:reset`: `lint`, `typecheck`, `npm test` y `npm run test:e2e` en verde con el mismo número de tests (318 unitarios y de integración; 144 e2e que pasan). Y a mano, con y sin JavaScript, el recorrido de la verificación del plan.

## 15. Riesgos

1. **La guardia de rutas puede quedar abierta sin que falle la compilación.** `guardRoutes` decide con `routeId.startsWith('/(privado)')` y `'/(invitado)'`, dos cadenas que `typecheck` no comprueba. Si se mueven las carpetas y no se cambian (n.º 8 y 9), la guardia deja de proteger nada: `/account/delete` se pintaría a quien no tiene sesión, y quien ya tiene sesión podría volver a `/login` y `/register`. La acción de borrar sigue sin hacer nada sin token, pero la página se ve. Lo detecta E-2 (`/account` y `/account/delete` sin sesión llevan a `/login?next=…`). Conviene revisar estas dos líneas a mano antes de nada.
2. **`next` y la validación de la ruta de retorno.** El nombre aparece en cuatro sitios que nada enlaza entre sí: la redirección de `hooks.server.ts`, `searchParams.get` en el `load` de `/login`, el `name` del campo oculto y `textField` en la acción. Si uno se queda en `siguiente`, no hay error: se pierde la ruta pedida y se va siempre a `/account`. El test E-2 lo detecta solo porque pide `/account/delete`. La seguridad no cambia: `safeReturnPath` sigue comparando con la lista cerrada (n.º 27), los valores viejos `/cuenta…` se tratan como desconocidos, y `next` no choca con ningún parámetro reservado de SvelteKit. La redirección compone la URL sin codificar porque el valor sale siempre de la lista cerrada; si algún día la lista admite parámetros, habrá que usar `encodeURIComponent`.
3. **Muchas cadenas no las comprueba `typecheck`.** `resolve()`, `FormName`, los tipos de campo y `route` de `ErrorSummary` sí fallan al compilar. No fallan: los `name` del HTML frente a `textField(data, '…')` (un desajuste lee el campo vacío y da «obligatorio»), los ids y los atributos ARIA (un `aria-describedby` roto no da error), las URL de `redirect()` y de `action=`, los parámetros de consulta, el atributo `data-result-focus` y las clases CSS. Los cubren los unitarios de acciones y los e2e de accesibilidad (C23 a C37 en `ux-a11y`), y los `grep` de §14.
4. **Las clases CSS se pierden en silencio.** `svelte-check` no avisa de clases que no existen en el `app.css` global. Una clase mal renombrada deja el elemento sin estilo y solo la detectan algunos e2e de maquetación (`ux-a11y`, `second-review`). Las clases que se componen (`notice-{tone}`, `button-{variant}`) dependen de que se cambien a la vez la prop y el selector (n.º 51 y 52). Usar la comparación de §14 y revisar a mano las cinco pantallas.
5. **Buscar y reemplazar global rompe claves de texto.** Ver la regla del principio. Un `sed` de `registro` o `correo` cambiaría `registro.error.correo_vacio`, que existe en `texts.ts` y en UX §5, y `texts.spec.ts` fallaría (o, peor, `TextKey` dejaría de compilar en decenas de sitios).
6. **Tests que buscan texto con la ruta.** Están todos en §11: un glob de `page.route`, expresiones regulares sobre la URL, `a[href*="salir"]`, la comparación exacta de `className`, `actionStatus` con `includes(path)` y el fragmento `#contenido` en la URL. Ninguno busca rutas dentro de los textos de la interfaz: ningún texto de UX §5 contiene una ruta.
7. **CSP, robots.txt y CSRF no citan rutas.** La CSP de `vite.config.ts` usa `'self'` en `form-action` y no nombra ninguna ruta. `static/robots.txt` solo tiene `User-agent: *` y `Disallow:` vacío. `csrf.trustedOrigins` está vacío. No hay que tocar ninguno.
8. **`texts.spec.ts` lee `docs/h0-diseno-ux.md`.** Toma la tabla entre `## 5. Textos de interfaz` y `## 6. Accesibilidad`. Mientras el diseñador de UX cambia rutas y campos en ese documento, no debe tocar esos dos títulos ni las filas de claves, o fallarán los unitarios de textos aunque el código esté bien.
9. **`delete` como identificador.** Es válido como clave (`FormName`, `errorMessages.delete`), pero no como nombre de variable: en `actions.spec.ts` se usa `deletePage` (n.º 104).
10. **Restos de compilación.** Tras `git mv`, `.svelte-kit/` y `build/` conservan las rutas viejas hasta regenerarse. `npm run typecheck` (`svelte-kit sync`) y el `build` de los e2e los rehacen; si el editor marca errores en `./$types`, basta con ejecutar `svelte-kit sync`.
11. **Las URL antiguas dan 404.** Es lo acordado (no hay nada publicado y no se ponen redirecciones). Un marcador o una pestaña abierta en `/entrar` durante el desarrollo llevará a la página 404.
