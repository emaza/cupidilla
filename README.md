# Cupidilla

Web de contactos con una celestina de IA. Cupidilla conversa con cada persona para entender qué busca, le propone pocas personas compatibles explicando por qué, y media en la presentación **solo cuando ambas partes consienten**.

> «Menos deslizar. Más conectar.»

## Estado

Fase de definición (11 de noviembre de 2026). Todavía no hay código: este repositorio contiene únicamente las ideas ordenadas para empezar el desarrollo del MVP.

## Documentos

| Documento | Para qué sirve |
|---|---|
| [Producto](docs/producto.md) | Qué es Cupidilla, para quién, cómo funciona una presentación y cómo gana dinero |
| [MVP](docs/mvp.md) | Qué se construye primero, qué queda fuera, hitos con criterios de aceptación y cómo se valida |
| [Arquitectura](docs/arquitectura.md) | Stack, módulos, modelo de datos y cómo se integra el modelo de lenguaje |
| [Entrevista con Cupidilla](docs/entrevista-cupidilla.md) | Especificación del primer hito: la conversación que construye el perfil privado |
| [Privacidad y seguridad](docs/privacidad-y-seguridad.md) | Datos sensibles, consentimientos y lo que hay que resolver antes de tener usuarios reales |
| [Decisiones](docs/decisiones.md) | Qué está decidido, qué sigue abierto y quién debería resolverlo |

## Decisiones clave

- **Una sola marca**: la web y la asistente se llaman Cupidilla.
- **Arquitectura**: monorepo con SvelteKit sobre **Svelte 5 estable** (web) + NestJS (API) + PostgreSQL, como monolito modular.
- **Modelo de lenguaje**: Claude Opus 5.5 detrás de una interfaz propia intercambiable.
- **Primer hito**: entrevista con Cupidilla y perfil privado editable.
- **Regla de oro**: el modelo propone; el backend valida. El consentimiento se implementa en código, nunca en un prompt.

## Origen de estos documentos

Ordenan una conversación de ideación con ChatGPT (18–19 de octubre de 2026) y las decisiones tomadas el 11 de noviembre de 2026. No son una transcripción: donde el contenido se aparta de lo que propuso ChatGPT aparece marcado como **Ajuste**, y lo que nadie ha comprobado todavía aparece como **Por comprobar**.
