# Decisiones

[← Índice](../README.md)

Registro de lo que está decidido y de lo que sigue abierto. Cuando una decisión abierta se cierre, se mueve a la primera tabla con su fecha.

## Cerradas

| # | Decisión | Origen |
|---|---|---|
| 1 | **Una sola marca.** La web y la asistente se llaman Cupidilla; «Celestina» se descarta como marca | Conversación con ChatGPT, octubre de 2026 |
| 2 | **Todo tipo de contactos**: románticos, casuales y sociales. Cada usuario elige su objetivo y la compatibilidad se calcula por objetivo | Conversación con ChatGPT |
| 3 | **La IA es una celestina conversacional** que media con consentimiento. No es un agente autónomo ni una pareja virtual | Conversación con ChatGPT |
| 4 | **Freemium.** Las presentaciones mutuas y el chat básico son gratuitos; la seguridad es igual en ambos planes | Conversación con ChatGPT |
| 5 | **Web primero.** Sin aplicaciones nativas en el MVP | Conversación con ChatGPT |
| 6 | **Matching determinista.** El modelo explica la compatibilidad; no la calcula | Conversación con ChatGPT |
| 7 | **El consentimiento se implementa en código**, no en un prompt | Conversación con ChatGPT |
| 8 | **Lo inferido se guarda como propuesta** y no se usa hasta que el usuario lo confirma | Conversación con ChatGPT |
| 9 | **Arquitectura**: monorepo SvelteKit + NestJS + PostgreSQL, monolito modular | 11 de noviembre de 2026 |
| 10 | **Modelo**: Claude Opus 5.5 detrás de una interfaz propia intercambiable | 11 de noviembre de 2026 |
| 11 | **Primer hito**: entrevista con Cupidilla y perfil privado editable | 11 de noviembre de 2026 |
| 12 | **Se empieza a construir ya**, sin esperar a las entrevistas de validación del problema | 11 de noviembre de 2026 |
| 13 | **Svelte 5 estable, con runas.** No se usa sintaxis de Svelte 3 o 4 ni bibliotecas que no sean compatibles con Svelte 5 ([detalle](arquitectura.md#svelte-5-no-versiones-anteriores)) | 11 de noviembre de 2026 |
| 14 | **ORM: Drizzle.** Esquema en TypeScript y SQL explícito. Se usa la 0.45 estable, no la 1.0 candidata ([detalle](h0-diseno-tecnico.md#2-versiones-fijadas)) | 11 de noviembre de 2026, CTO con el arquitecto |
| 15 | **Autenticación: correo y contraseña.** Sesiones opacas guardadas en PostgreSQL y cookie `httpOnly`, sin JWT. H0 no envía correo: sin verificación de correo ni recuperación de contraseña ([detalle](h0-diseno-tecnico.md#8-sesión-y-seguridad)) | 11 de noviembre de 2026, CTO con el arquitecto |
| 16 | **Base técnica de H0**: npm workspaces, Node 24, todo en ESM, TypeScript 6.0 y PostgreSQL 18 en Docker. El navegador solo habla con SvelteKit, y SvelteKit con la API ([diseño técnico](h0-diseno-tecnico.md), [diseño UX](h0-diseno-ux.md)) | 11 de noviembre de 2026, CTO con el arquitecto |

## Abiertas

Ordenadas por cuándo bloquean. La recomendación es mía; quien decide aparece en la última columna.

### Antes de H0

| Decisión | Opciones | Recomendación | Decide |
|---|---|---|---|
| **Marca y dominio** | Comprobar OEPM, EUIPO y dominios | Hacerlo cuanto antes: cuesta poco y condiciona cualquier inversión en identidad | Tú |

### Antes de diseñar H1

| Decisión | Opciones | Recomendación | Decide |
|---|---|---|---|
| **Aspecto de Cupidilla** | Personaje ilustrado · interfaz minimalista solo conversación | Minimalista con un avatar sencillo en H1; la ilustración llega con la identidad visual, cuando la entrevista ya funcione | Tú, con el diseñador UX |
| **Llamadas por turno** | Una (respuesta y extracción juntas) · dos (respuesta en streaming y extracción aparte) | Empezar con una; separar solo si la latencia molesta | Arquitecto |
| **Nivel de esfuerzo del modelo** | `low` · `medium` | Empezar en `low` y confirmar con la evaluación | Lo decide la evaluación |
| **Categorías de observación** | Las cinco de ChatGPT · añadir preferencias sobre la otra persona y límites | Añadirlas; sin ellas la fase 5 no tiene dónde guardar nada | Arquitecto |
| **Confianza numérica** | Guardar `confidence` · no guardarla | No guardarla en el MVP | Arquitecto |
| **Entrevistas de validación** | Hacerlas en paralelo · posponerlas | En paralelo a H0 y H1: 15–25 personas, preguntando por comportamientos reales | Tú |

### Antes de H3

| Decisión | Opciones | Recomendación | Decide |
|---|---|---|---|
| **Chat en tiempo real** | WebSockets propios · servicio gestionado | WebSockets propios en NestJS: para 50–100 personas no hace falta más | Arquitecto |

### Antes de la beta

| Decisión | Opciones | Recomendación | Decide |
|---|---|---|---|
| **Verificación de edad** | Fecha declarada · verificación real | Declarada mientras la beta sea cerrada y por invitación; verificación real antes de abrir al público | Tú, con asesoría legal |
| **Zona y segmento de la beta** | Por definir | Una sola zona metropolitana y objetivos de contacto acotados, para concentrar la liquidez | Tú |
| **Proveedor de despliegue** | Por definir | Docker con PostgreSQL gestionado; el proveedor, el que ya conozcas | Arquitecto |
| **Datos y región del proveedor del modelo** | Revisar condiciones, retención y región de inferencia | Resolverlo dentro de la revisión jurídica | Tú, con asesoría legal |
| **Verificación de correo y recuperación de contraseña** | Añadirlas · seguir sin envío de correo | Añadirlas: sin ellas, quien pierde la contraseña pierde la cuenta, y el registro deja deducir qué correos ya existen | Arquitecto |
| **Registro abierto o por invitación** | Abierto · con invitación | Con invitación en la beta cerrada. H0 lo deja abierto porque todavía no hay usuarios reales | Tú |
| **Prueba del consentimiento tras borrar la cuenta** | No conservar nada · conservar una prueba anonimizada | Resolverlo dentro de la revisión jurídica. H0 lo borra todo y así lo dice la interfaz | Tú, con asesoría legal |
| **Versión de Node en producción** | Node 24 · Node 26 | Pasar a Node 26 antes del primer despliegue; H0 se desarrolla en la 24, que es la instalada | Arquitecto |

### Después de la beta

| Decisión | Opciones | Recomendación | Decide |
|---|---|---|---|
| **Precio de Plus** | 7,99–12,99 €/mes es solo una hipótesis | Fijarlo con datos de disposición a pagar, no antes | Tú |
| **Bajar de modelo** | Seguir en Opus 5.5 · pasar a Sonnet 5.5 o Haiku 5.5 | Lo que diga la evaluación con conversaciones reales | Lo decide la evaluación |
| **Lema** | «Menos deslizar. Más conectar» y dos alternativas | Probarlo con usuarios junto a la identidad visual | Tú |

## Siguiente paso

H0 (base mínima) está implementado y verificado por QA el 11 de noviembre de 2026: ver el [diseño técnico](h0-diseno-tecnico.md), el [diseño UX](h0-diseno-ux.md) y el README para arrancarlo. Lo siguiente es H1, la [entrevista con Cupidilla](entrevista-cupidilla.md); antes de diseñarla hay que cerrar las decisiones de «Antes de diseñar H1».
