# Arquitectura

[← Índice](../README.md)

Lo marcado como **Propuesta** es un punto de partida para que lo cierre el arquitecto; no está decidido.

## Principios

1. **Monolito modular.** Módulos bien separados, un solo despliegue de API. Se extraen servicios solo si la carga, el aislamiento o el equipo lo justifican.
2. **El modelo propone; el backend valida.** Nada de lo que devuelve el LLM se persiste sin pasar por validación de esquema y reglas de negocio.
3. **El consentimiento vive en código.** La autorización de una presentación es lógica convencional del backend, nunca un prompt.
4. **La IA no toca la base de datos** ni decide qué información se comparte. Recibe los datos mínimos para una tarea concreta y devuelve una propuesta.
5. **Proveedor intercambiable.** El modelo se usa a través de una interfaz propia.
6. **Declarado, inferido y verificado no son lo mismo.** No se guarda una inferencia del modelo como si fuera una verdad sobre la persona.

## Stack

| Capa | Tecnología | Estado | Motivo |
|---|---|---|---|
| Web | SvelteKit con **Svelte 5 estable** + TypeScript | Decidido | Aprovecha tu experiencia con Svelte; web adaptable. Ver [Svelte 5](#svelte-5-no-versiones-anteriores) |
| API | NestJS + TypeScript | Decidido | Módulos, validación, guards y separación de responsabilidades |
| Base de datos | PostgreSQL | Decidido | Integridad relacional para usuarios, permisos y presentaciones |
| Modelo de lenguaje | Claude Opus 5.5 (`claude-opus-5-5`) | Decidido | Ver [integración](#integración-con-claude) |
| Validación de esquemas | Zod | Decidido | Validar lo que produce el modelo antes de persistirlo |
| ORM | Prisma o Drizzle | Abierto | Uno, no ambos |
| Chat en tiempo real | WebSockets propios o servicio gestionado | Abierto | Hace falta en H3 |
| Redis y trabajos | Redis | Cuando haga falta | Tareas asíncronas, límites de uso y notificaciones |
| Búsqueda semántica | pgvector | Más adelante | Solo si las pruebas demuestran que aporta valor |
| Pagos | Stripe u otro | Después de la beta | Suscripción Plus |
| Despliegue | Docker + PostgreSQL gestionado | Abierto el proveedor | Entorno reproducible con poca carga operativa |

No se introduce Python en el backend ni microservicios.

### Svelte 5, no versiones anteriores

La web se escribe con **Svelte 5 en su versión estable**, usando runas. Svelte 3 y 4 no son compatibles con esa forma de escribir componentes, así que su sintaxis no se usa en ningún archivo del proyecto.

| Para | Svelte 5 (se usa) | Svelte 3 y 4 (no se usa) |
|---|---|---|
| Estado | `let n = $state(0)` | `let n = 0` reactivo |
| Valores derivados | `$derived(...)` | `$: doble = n * 2` |
| Efectos | `$effect(() => { ... })` | `$: { ... }` |
| Propiedades | `let { nombre } = $props()` | `export let nombre` |
| Eventos | `onclick={...}` | `on:click={...}` |
| Contenido anidado | `{#snippet}` y `{@render children()}` | `<slot>` |

Consecuencias prácticas:

- Al crear el proyecto se comprueba que la versión instalada es Svelte 5 estable (no una versión candidata ni anterior) y la versión de SvelteKit que le corresponde.
- Solo se añaden bibliotecas de componentes que declaren compatibilidad con Svelte 5.
- Los ejemplos y tutoriales escritos para Svelte 3 o 4 no sirven como referencia: ante la duda, la documentación oficial de Svelte 5.

## Estructura del repositorio

**Propuesta.**

```
cupidilla/
  apps/
    web/          SvelteKit (Svelte 5): perfiles, entrevista, descubrimiento, chat, cuenta
    api/          NestJS: monolito modular
  packages/
    contracts/    Esquemas Zod compartidos entre web y API
  docs/
  docker-compose.yml
```

El paquete de contratos existe para que la web y la API validen con los mismos esquemas, incluidos los de la salida del modelo.

## Módulos de la API

ChatGPT enumeró: Auth, Usuarios, Matching, Presentaciones, Chat, Pagos y Moderación. **Propuesta** de reparto por hitos, añadiendo los que faltaban para la entrevista:

| Módulo | Responsabilidad | Hito |
|---|---|---|
| `auth` | Registro, sesión, mayoría de edad | H0 |
| `users` | Cuenta, estado, eliminación | H0 |
| `consents` | Permisos, finalidad, versión, fecha y revocación | H0 |
| `interview` | Máquina de estados de la entrevista, turnos y mensajes | H1 |
| `profiles` | Perfil visible y perfil privado (observaciones) | H1 |
| `ai` | Interfaz con el modelo y las tareas de IA | H1 |
| `matching` | Filtros obligatorios, puntuación y recomendaciones | H2 |
| `presentations` | Flujo bilateral y registro de autorizaciones | H3 |
| `chat` | Conversaciones y mensajes entre usuarios | H3 |
| `moderation` | Bloqueos, denuncias y revisión | H3–H4 |
| `admin` | Panel de administración | H4 |
| `billing` | Suscripciones y cuotas | Después de la beta |

## Capa de IA

Tareas explícitas, cada una con entrada y salida acotadas:

| Tarea | Qué hace | Hito |
|---|---|---|
| **Dialogue Manager** | Genera la siguiente intervención de Cupidilla en la entrevista | H1 |
| **Profile Interpreter / Extractor** | Convierte las respuestas en observaciones estructuradas | H1 |
| **Compatibility Explainer** | Explica coincidencias y diferencias a partir de datos autorizados | H2 |
| **Presentation Composer** | Redacta una propuesta de presentación sin enviarla | H3 |
| **Conversation Coach** | Sugiere mensajes que el usuario puede editar o ignorar | H3 |
| **Moderation Service** | Ayuda a detectar contenido abusivo o posible fraude, con revisión y apelación | H4 |

### Flujo de extremo a extremo

```
Entrevista
   ↓
LLM → preferencias estructuradas, validadas
   ↓
PostgreSQL → perfil confirmado por el usuario
   ↓
Matching determinista → candidatos elegibles
   ↓
LLM → explicación de compatibilidad
   ↓
Consentimiento bilateral
   ↓
Backend → creación del chat
```

El modelo interviene en dos puntos y en ninguno decide: en el primero propone un perfil que el usuario confirma; en el segundo explica un resultado que ya calculó el backend.

## Integración con Claude

Comprobado contra la referencia actual de la API el 11 de noviembre de 2026.

> **Ajuste sobre la propuesta de ChatGPT:** recomendaba un modelo de gama económica elegido tras comparar proveedores. Has decidido empezar con Claude Opus 5.5. El argumento: en una beta de 50–100 personas el gasto total es de decenas de dólares con cualquier modelo, así que la primera decisión es de calidad y no de coste. La [evaluación](entrevista-cupidilla.md#evaluación) dirá después si se puede bajar de modelo sin perder calidad.

### Decisiones de integración

| Aspecto | Cómo |
|---|---|
| SDK | `@anthropic-ai/sdk` (oficial, TypeScript) |
| Modelo | `claude-opus-5-5`, leído de configuración para poder cambiarlo sin tocar código |
| Interfaz propia | Un `LlmProvider` con una única implementación al principio. El resto de módulos no importa el SDK |
| Salida estructurada | `client.messages.parse()` con `output_config.format` generado a partir del esquema Zod (`zodOutputFormat`). El resultado puede venir vacío si no valida: hay que comprobarlo siempre |
| Pensamiento | En Opus 5.5 está siempre activo y no se puede desactivar. La profundidad se controla con `output_config.effort`, que hay que fijar de forma explícita (por defecto es `medium`) |
| Esfuerzo de partida | **Propuesta**: `low` en los turnos de conversación, por latencia; se confirma con la evaluación |
| Rechazos | Comprobar `stop_reason` antes de leer la respuesta. Si es `refusal`, Cupidilla da una respuesta neutra y no se guarda nada |
| Errores | Distinguir los reintentables (límite de peticiones, errores del servidor, red) de los que no lo son, con las clases de error del SDK |
| Consumo | Guardar los tokens de `response.usage` de cada llamada en `usage_events` |

### Lo que Opus 5.5 no admite

Conviene saberlo antes de diseñar, porque algunos patrones habituales devuelven error:

- `temperature`, `top_p` y `top_k`.
- Desactivar el pensamiento o fijarle un presupuesto de tokens.
- Forzar una herramienta con `tool_choice`. Para obtener JSON se usa la salida estructurada.
- Rellenar el principio de la respuesta del asistente (*prefill*).

### Caché de prompts

> **Ajuste sobre la propuesta de ChatGPT:** su prompt de sistema incluía el estado del turno (fase, objetivo, información confirmada). La caché funciona por prefijo: cualquier cambio en el prompt la invalida, así que ese diseño no se cachea nunca.

El prompt se separa en dos partes:

- **Parte estable**: identidad de Cupidilla, reglas y formato. Va en `system`, idéntica en todas las peticiones.
- **Estado del turno**: fase, objetivo y lo que falta por saber. Va al final de la conversación, como mensaje de sistema dentro de `messages` (Opus 5.5 lo admite).

Hay un tamaño mínimo para que un prefijo se cachee, que depende del modelo; un prompt corto puede no cachearse. Se verifica mirando `usage.cache_read_input_tokens`.

### Por comprobar al implementar

- Si la opción de reintento automático ante rechazos (`fallbacks`, en beta) es compatible con `messages.parse()`.
- Qué exige Opus 5.5 al reenviar el historial de una conversación: los bloques de pensamiento están ligados a la conversación que los produjo. Hay que decidir si el historial se reenvía íntegro o se reconstruye solo con el texto, y confirmar en la documentación que la opción elegida es válida.
- Si conviene una llamada por turno (respuesta y extracción juntas) o dos (respuesta en streaming y extracción aparte). **Propuesta**: empezar con una y separar solo si la latencia molesta.

### Coste estimado

Estimación propia con precios de lista (tabla con fecha 3 de noviembre de 2026). Supone una entrevista de unos 12 turnos, 40 000 tokens de entrada y 6 000 de salida, sin caché. El pensamiento cuenta como salida y puede subir la cifra.

| Modelo | Entrada / salida por millón de tokens | Coste por entrevista |
|---|---|---|
| Claude Opus 5.5 (elegido) | 4 $ / 20 $ | ≈ 0,30 $ |
| Claude Sonnet 5.5 | 2 $ / 10 $ | ≈ 0,15 $ |
| Claude Haiku 5.5 | 0,10 $ / 0,50 $ | < 0,01 $ |

La cifra real saldrá de `usage_events` en cuanto haya entrevistas de verdad.

### Datos enviados al modelo

Las conversaciones pueden contener datos de categoría especial. Antes de tener usuarios reales hay que revisar las condiciones de tratamiento de datos del proveedor, la retención y la región donde se ejecuta la inferencia (ver [privacidad y seguridad](privacidad-y-seguridad.md#el-proveedor-del-modelo)). Mientras tanto, la regla es enviar lo mínimo: nunca el historial completo de todas las conversaciones, y nunca datos de otros usuarios que no estén autorizados para esa tarea.

## Modelo de datos inicial

| Entidad | Contenido |
|---|---|
| `users` | Cuenta, estado, fecha de nacimiento (verificada o los datos mínimos necesarios) |
| `profiles` | Información visible y biografía |
| `preferences` | Objetivos de contacto, criterios y límites |
| `consents` | Permisos, finalidad, versión, fecha y revocación |
| `recommendations` | Candidatos propuestos, puntuaciones y motivos |
| `presentations` | Participantes, estado y permisos de cada parte |
| `conversations`, `messages` | Chat entre usuarios y metadatos |
| `reports`, `blocks` | Moderación y protección |
| `subscriptions`, `usage_events` | Planes, cuotas y consumo |

**Propuesta** de entidades adicionales para H1, que la lista de ChatGPT no incluía:

| Entidad | Contenido |
|---|---|
| `interview_sessions` | Fase actual, estado (en curso, en pausa, completada), contadores |
| `interview_messages` | Turnos del usuario y de Cupidilla |
| `profile_observations` | Una fila por observación, con procedencia, evidencia y estado (ver [entrevista](entrevista-cupidilla.md#modelo-de-una-observación)) |

Regla transversal: cada dato sobre una persona indica si es una **declaración** suya, una **inferencia** provisional o un dato **verificado**.
