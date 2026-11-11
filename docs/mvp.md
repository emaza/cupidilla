# MVP

[← Índice](../README.md)

## Qué queremos comprobar

El MVP no existe para demostrar que se puede integrar un modelo de lenguaje. Existe para comprobar tres cosas:

1. Que las personas **confían** en la propuesta.
2. Que **aceptan ser presentadas** por una IA.
3. Que llegan a mantener **conversaciones reales**.

**Métrica principal**: proporción de usuarios que consiguen una presentación mutua que consideran satisfactoria. No el número de registros ni el tiempo hablando con Cupidilla.

## Dentro del MVP

| Función | Qué incluye |
|---|---|
| **Registro y perfil estructurado** | Edad, zona aproximada, intereses, preferencias, objetivos de contacto, límites personales y disponibilidad. Verificación de edad y controles básicos contra perfiles falsos |
| **Entrevista con Cupidilla** | Conversación guiada que convierte las respuestas en preferencias estructuradas. El usuario revisa, corrige y elimina lo que la IA haya interpretado |
| **Recomendaciones de compatibilidad** | Un conjunto pequeño de perfiles relevantes, con explicaciones basadas en preferencias declaradas y criterios comprensibles |
| **Presentación bilateral con consentimiento** | Cupidilla pide permiso para transmitir una presentación; solo cuando ambas partes aceptan se abre el contacto |
| **Chat y ayuda para romper el hielo** | Mensajería básica y sugerencias opcionales. Cupidilla propone; el usuario decide qué enviar |
| **Seguridad y administración** | Bloquear, denunciar, retirar el consentimiento, eliminar la cuenta, moderar contenido y gestionar usuarios desde un panel |

## Fuera del MVP

- Aplicaciones nativas para Android e iOS.
- Videollamadas y llamadas de voz.
- Un agente que negocie citas de forma autónoma.
- Un algoritmo de compatibilidad con entrenamiento propio.
- Reconocimiento facial complejo.
- Integraciones con redes sociales y calendarios.
- Pagos con múltiples planes y complementos. La suscripción Plus se añade después de la beta, cuando haya valor recurrente demostrado.
- Búsqueda semántica con pgvector, hasta que las pruebas demuestren que aporta valor.

## Hitos

> **Ajuste sobre la propuesta de ChatGPT:** su hoja de ruta construía primero toda la base técnica y dejaba la IA para la semana 5. Aquí la entrevista va primero, porque es lo que diferencia el producto y lo más incierto técnicamente.

### H0 — Base mínima

Lo imprescindible para que la entrevista tenga dónde vivir.

- Monorepo con web y API, base de datos y entorno local reproducible.
- Registro e inicio de sesión.
- Fecha de nacimiento declarada (solo mayores de edad) y consentimiento de uso del servicio.
- Eliminar la cuenta.

**Hecho cuando**: una persona puede registrarse, entrar, salir y borrar su cuenta; un menor no puede registrarse; el consentimiento queda registrado con fecha y versión.

### H1 — Entrevista y perfil privado

Especificación completa en [entrevista con Cupidilla](entrevista-cupidilla.md).

**Hecho cuando**:

- [ ] Cupidilla conduce la entrevista por fases, con una pregunta principal por turno, y la cierra cuando tiene información suficiente (hipótesis inicial: 8–15 preguntas adaptativas).
- [ ] No repite preguntas ya respondidas y se salta fases cuando el usuario ya ha dado la información.
- [ ] El usuario puede pausar, retomar más tarde y terminar cuando quiera.
- [ ] Ante una desviación, Cupidilla responde con brevedad y reconduce sin reprender; si se repite, lo explica; si el usuario insiste, le deja salir.
- [ ] Cada observación guardada lleva procedencia (declarada o inferida) y la evidencia en la que se apoya.
- [ ] Lo inferido se guarda como **propuesta** y no se usa para nada hasta que el usuario lo confirma.
- [ ] Hay una pantalla de perfil privado donde el usuario ve, confirma, corrige y elimina cada observación.
- [ ] No se infieren atributos sensibles ni se presiona para obtener información íntima.
- [ ] Siempre es visible que se habla con una IA.
- [ ] Si el modelo falla, rechaza o devuelve una salida que no valida, no se guarda nada y la conversación puede continuar.
- [ ] Queda registrado el consumo (tokens y coste) de cada entrevista.

### H2 — Matching y recomendaciones explicadas

- Filtros obligatorios deterministas: edad, zona, objetivo de contacto, límites y bloqueos.
- Puntuación de compatibilidad explicable, calculada por objetivo.
- Pocas recomendaciones, cada una con su explicación generada a partir de datos **confirmados y autorizados**.

**Hecho cuando**: dos usuarios compatibles se ven recomendados mutuamente con una explicación coherente; dos incompatibles por un filtro obligatorio no se ven nunca; cuando no hay candidatos, el sistema lo dice en lugar de rellenar.

### H3 — Presentaciones y chat

- Flujo de presentación bilateral con registro de cada autorización.
- Chat básico entre las dos personas y notificaciones.
- Sugerencias opcionales para romper el hielo.
- Bloquear, denunciar y retirar el consentimiento (imprescindibles antes de que dos usuarios puedan escribirse).

**Hecho cuando**: no existe ninguna forma de abrir un chat o ver un perfil completo sin la aceptación de ambas partes; un rechazo es definitivo; bloquear corta el contacto de inmediato; cada autorización es consultable (quién, qué, para qué presentación, cuándo).

### H4 — Administración y beta cerrada

- Panel de administración: gestión de usuarios y revisión de denuncias.
- Moderación de contenido con procedimiento de revisión y apelación.
- Límites de uso.
- Pruebas funcionales y de seguridad, evaluación de la calidad de la IA y preparación de la beta.

**Hecho cuando**: se cumplen las comprobaciones previas de [privacidad y seguridad](privacidad-y-seguridad.md#antes-de-tener-usuarios-reales) y la beta puede abrirse a 50–100 personas.

### Referencia temporal

ChatGPT estimó una beta funcional en **10–12 semanas** para un desarrollador con experiencia, en solitario y a tiempo parcial, con alcance disciplinado. Es una estimación orientativa suya, no un compromiso, y no cubre revisiones de privacidad, mecanismos antifraude ni captación de comunidad.

## Validación

### Fases

| Fase | Qué se hace |
|---|---|
| **A — Validar el problema** | Entrevistar a 15–25 personas adultas que usen o hayan usado webs de contactos. Averiguar qué les frustra. Preguntar por comportamientos reales y disposición a pagar, no por si la idea «les parece interesante» |
| **B — MVP asistido** | Prueba cerrada con 50–100 participantes, perfiles reales y consentimiento explícito. Si hay pocos usuarios activos, algunas recomendaciones se pueden gestionar a mano para probar el proceso antes de automatizarlo |
| **C — Medición** | Seguir las métricas de la tabla siguiente por cohortes |
| **D — Liquidez** | Empezar por un mercado pequeño y denso; ver [producto](producto.md#el-riesgo-que-decide-el-negocio) |

> **Ajuste sobre la propuesta de ChatGPT:** recomendaba hacer la fase A antes de programar. Has decidido empezar a construir ya; la recomendación es hacer esas entrevistas **en paralelo** a H0 y H1, que no dependen de ellas. La comparación de marcas «Celestina» frente a «Cupidilla» que proponía ya no aplica: la marca está decidida.

Una prueba con amigos o conocidos no valida el mercado: hace falta observar a personas sin compromiso personal contigo.

### Métricas

Objetivos iniciales orientativos para decidir si continuar; no son referencias universales.

| Métrica | Objetivo experimental |
|---|---|
| Usuarios que completan el perfil | ≥ 60 % de los registrados |
| Usuarios que aceptan al menos una recomendación | ≥ 30 % de los perfiles completados |
| Presentaciones aceptadas por ambas partes | Medir y mejorar por cohorte |
| Usuarios que vuelven en 7 días | ≥ 25 % |
| Usuarios que valoran positivamente una presentación | ≥ 70 % de quienes responden |
| Conversión a pago | Medir después de demostrar valor recurrente |
| Incidentes graves de seguridad | Cero |

**Cuidado con el denominador** de las presentaciones mutuas: no es lo mismo contar todas las recomendaciones mostradas que contar solo aquellas en las que ambas personas tuvieron oportunidad real de responder.

También conviene medir: presentaciones que se convierten en conversación, tiempo hasta la primera conexión satisfactoria, denuncias, bloqueos y diferencias de resultados entre grupos.
