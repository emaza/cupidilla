# Producto

[← Índice](../README.md)

## La idea en una frase

Cupidilla no es otra web de citas con un chatbot añadido: es una **celestina**. Conoce a cada persona conversando, le propone pocas personas compatibles explicando por qué, y hace de intermediaria para pasar de «me interesa esta persona» a «tenemos una razón para conocernos y una forma natural de empezar a hablar».

## El problema que ataca

Son hipótesis; ninguna está validada todavía (ver [validación](mvp.md#validación)).

- Desplazamiento infinito por perfiles poco relevantes.
- Decisiones basadas casi solo en fotografías y filtros.
- Conversaciones que empiezan y terminan en un «hola».
- Desconfianza: perfiles falsos, estafas, miedo al primer encuentro.

## Los cuatro pilares

| Pilar | Qué hace Cupidilla |
|---|---|
| **Conocerte de verdad** | Una conversación para entender valores, estilo de vida, personalidad, expectativas y preferencias, en lugar de depender de fotos y filtros |
| **Compatibilidad explicada** | Recomienda personas y explica por qué podrían encajar y en qué se complementan, sin presentarlo como una predicción infalible |
| **Ayuda para romper el hielo** | Sugiere preguntas, temas y formas naturales de empezar; el usuario elige qué enviar |
| **Confianza y seguridad** | Verificación de perfiles, detección de posibles estafas, controles de privacidad y recomendaciones para encuentros seguros |

## Quién es Cupidilla

**Tu cómplice para conectar.** Una asistente cercana, ingeniosa y con un toque pícaro, siempre respetuosa.

| Es | No es |
|---|---|
| Una interlocutora reconocible que acompaña todo el proceso | Una pareja virtual |
| Quien ayuda a conectar a personas reales | Alguien que finge sentimientos propios |
| Quien propone y explica | Quien decide por el usuario o actúa sin su permiso |
| Transparente: siempre queda claro que es una IA | Un agente autónomo que negocia citas |

Lemas candidatos: «Menos deslizar. Más conectar» (principal), «Conocer a alguien empieza por conocerte», «El azar, con un poquito de ayuda».

Sigue abierto si Cupidilla tendrá forma de personaje ilustrado o será solo una conversación (ver [decisiones](decisiones.md#abiertas)).

## Qué tipo de contactos

Todo tipo: relaciones románticas, citas casuales y contactos sociales o de amistad.

- Cada usuario elige qué busca y puede cambiarlo cuando quiera.
- La compatibilidad se calcula **respecto a un objetivo concreto**: dos personas pueden encajar para una amistad y no para una relación sentimental.

## Cómo funciona una presentación

1. **Ana conversa con Cupidilla.** Define qué busca, qué le interesa y qué límites tiene.
2. **El sistema encuentra a Marcos.** Los filtros obligatorios encajan y la compatibilidad es suficiente.
3. **Ana autoriza la presentación.** Decide qué información puede compartir Cupidilla con Marcos.
4. **Marcos acepta o rechaza.** No se revela el perfil completo ni se abre un chat sin su consentimiento.
5. **Presentación mutua.** Se abre el chat y Cupidilla puede proponer una forma natural de empezar.

La autorización para compartir información con otra persona es **independiente** del consentimiento general de uso del servicio. Se registra quién autorizó qué información, para qué presentación y cuándo (detalle en [privacidad y seguridad](privacidad-y-seguridad.md#tres-consentimientos-distintos)).

## Propuesta de valor

- **Para el usuario**: menos desplazamiento infinito y más oportunidades de conocer a personas que encajan con lo que busca.
- **Para la experiencia social**: presentaciones con contexto, preguntas para romper el hielo y menos conversaciones muertas.
- **Para el negocio**: suscripción por herramientas avanzadas, no por vender la atención emocional de la IA ni por prometer resultados sentimentales.

## Modelo freemium

El riesgo de toda plataforma de contactos es que el usuario sienta que tiene que pagar para tener oportunidades reales. Por eso **la función central —presentaciones mutuas y chat— es gratuita**.

| | Gratis | Cupidilla Plus |
|---|---|---|
| Precio | 0 € | 7,99–12,99 €/mes (hipótesis, sin validar) |
| Para qué | Captar usuarios y generar conexiones | Quien quiere profundizar |
| Incluye | Perfil completo · entrevista inicial · recomendaciones limitadas por día o semana · presentaciones mutuas y chat básico · bloqueo, denuncia y privacidad | Más recomendaciones y filtros avanzados · análisis de compatibilidad más detallado · entrevistas de actualización del perfil · más ayuda para preparar conversaciones · estadísticas personales |

**Lo que no se vende nunca**: ignorar un rechazo, escribir a quien no ha aceptado, obtener información privada de otras personas. La seguridad es idéntica en ambos planes.

Los pagos no forman parte de los primeros hitos: la conversión a pago se mide después de demostrar valor recurrente (ver [MVP](mvp.md#fuera-del-mvp)).

## Economía unitaria

La variable crítica es el margen por usuario activo:

```
Margen = ingreso neto − coste de IA − infraestructura − pagos − moderación variable
```

- El coste de la IA probablemente **no** sea el mayor gasto. Pesan más la captación de usuarios, la moderación y mantener suficiente densidad de perfiles compatibles.
- Con el modelo elegido, una entrevista completa cuesta en torno a 0,30 $ (estimación; desglose en [arquitectura](arquitectura.md#coste-estimado)). En una beta de 50–100 personas son decenas de dólares en total.
- Controles previstos: límites de uso razonables, prompts compactos y no enviar el historial completo de todas las conversaciones en cada petición.

## El riesgo que decide el negocio

**Liquidez.** Si en una zona hay pocas personas compatibles, la IA no puede inventarlas. La decisión estratégica más importante no es qué modelo usar, sino cómo conseguir una comunidad suficientemente activa para que las recomendaciones tengan valor.

Consecuencias de diseño:

- Empezar por un mercado pequeño y denso (por ejemplo, una zona metropolitana con objetivos de contacto claros). La marca no se limita a esa zona; el primer experimento sí.
- Si no hay suficientes personas compatibles, **decirlo** en lugar de rellenar con recomendaciones irrelevantes.
