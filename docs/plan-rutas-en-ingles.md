# Plan archivado: URLs y nombres internos de la web en inglés

[← Decisiones](decisiones.md)

Estado: **aprobado en contenido y aplazado**. Se ejecuta en un PR aparte justo después de fusionar H0 y antes de empezar H1 (decisión 18).


## Contexto

Las rutas de H0 están en español (`/entrar`, `/registro`, `/cuenta`…), y prefieres nombres en inglés. Hoy no hay usuarios ni enlaces publicados, así que el cambio no rompe nada. Lo que decidiste:
- **Nombres:** `/register`, `/login`, `/account`, `/account/delete`, `/legal/terms`.
- **Alcance:** también los nombres internos.
- **Cuándo:** en un PR aparte, justo después de fusionar H0 y antes de empezar H1.

Los textos que ve el usuario siguen en español: solo cambian las URLs y los identificadores del código.

## Requisito previo

Apruebas el PR emaza/cupidilla#1, yo lo fusiono en `dev` y creo la rama `rutas-en-ingles` desde `dev`.

## Qué cambia

| Ahora | Pasa a ser |
|---|---|
| `/registro`, `/entrar`, `/cuenta`, `/cuenta/eliminar`, `/legal/condiciones` | `/register`, `/login`, `/account`, `/account/delete`, `/legal/terms` |
| Grupos de rutas `(invitado)` y `(privado)` | `(guest)` y `(private)` |
| `?siguiente=` y `?aviso=` | `?next=` y `?notice=`. Sus valores también, por ejemplo `cuenta-eliminada` pasa a `account-deleted`. Las listas cerradas de A6 y A7 del diseño técnico se mantienen |
| Acción `?/salir` | `?/logout` |
| Campos de formulario `correo`, `contrasena`, `dia`, `mes`, `anio`, `condiciones` | `email`, `password`, `day`, `month`, `year`, `acceptTerms`, los mismos nombres que ya usa el contrato de la API |
| `FormName` (`'registro' \| 'entrar' \| 'eliminar' \| 'salir'`) en `apps/web/src/lib/errors/messages.ts` y `route: 'entrar' \| 'cuenta'` en `ErrorSummary.svelte` | `'register' \| 'login' \| 'delete' \| 'logout'` y `'login' \| 'account'` |
| Identificadores del código web (variables, funciones y archivos de `lib/forms/`) que estén en español | Inglés |

**Lo que NO cambia, a propósito:**
- **Claves de texto** (`registro.error.servidor`…): son los identificadores del documento de UX, con unas 190 claves y criterios que las citan. Renombrarlas no aporta nada al usuario y multiplicaría el cambio.
- **Comentarios y documentación:** siguen en español.
- **La API:** sus rutas ya están en inglés (`/auth/login`, `/users/me/deletion`).

## Quién hace qué

1. **arquitecto:** actualiza los acuerdos A1, A6 y A7 y las rutas en `docs/h0-diseno-tecnico.md`, y escribe una tabla de equivalencias exacta, incluidos los valores de `?notice=`.
2. **disenador-ux**, al mismo tiempo: cambia las rutas y los nombres de campo en `docs/h0-diseno-ux.md`, en los flujos, las pantallas y los criterios de §9. Me lo devuelve como una lista de cambios y lo aplico yo, porque no tiene la herramienta Edit.
3. **programador:** con esa tabla, renombra carpetas con `git mv`, rutas, `resolve(...)`, cabeceras, `hooks.server.ts` (redirecciones y `next`), acciones, campos, tipos y tests unitarios y e2e. Comprueba también README, `robots.txt` y la CSP. El `resolve()` tipado de SvelteKit hace que `typecheck` detecte cualquier enlace que se quede sin cambiar.
4. **tester-qa:** revisa el cambio y busca menciones que hayan quedado en español con `grep` de `/entrar`, `/registro`, `/cuenta`, `siguiente`, `aviso`, `salir` y `contrasena` en código y tests. Ejecuta toda la batería de pruebas y da el visto bueno.
5. **Yo:** commit como FenixDroide, push y PR `rutas-en-ingles` → `dev`. Espero la revisión de CodeRabbit.

## Verificación

- Desde `npm run db:reset`: `lint`, `typecheck`, `npm test` y `npm run test:e2e` en verde, con el mismo número de tests que antes (318 unitarios y de integración, y 144 e2e que pasan).
- `grep` sin resultados de rutas o parámetros en español en `apps/web/src` y `apps/web/tests`, salvo las claves de texto.
- A mano, con y sin JavaScript: portada → `/register` → `/account` → `/account/delete` → `/?notice=account-deleted`. Además, `/account` sin sesión lleva a `/login?next=/account`.
- Las URLs antiguas (`/entrar`…) dan 404. Como no hay nada publicado, no se ponen redirecciones.
