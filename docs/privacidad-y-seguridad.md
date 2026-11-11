# Privacidad y seguridad

[← Índice](../README.md)

Este documento ordena lo que se habló sobre privacidad, seguridad y regulación. **No es asesoramiento jurídico**: antes de operar con usuarios reales hace falta una revisión especializada.

## Por qué es delicado

Las preferencias y los mensajes de una web de contactos pueden revelar orientación sexual, vida sexual, religión o salud. Son categorías especiales de datos, con protección reforzada en el artículo 9 del RGPD. Cuando la base jurídica sea el consentimiento, tiene que ser explícito.

## Principios

| Principio | Qué significa aquí |
|---|---|
| **Minimización** | Preguntar solo lo necesario. No se exige información íntima para completar el perfil |
| **Consentimiento granular** | Separar el uso del servicio, el tratamiento de datos sensibles y la autorización de cada presentación |
| **Privacidad por diseño** | Perfiles privados por defecto hasta que el usuario elige qué publicar. Zona aproximada, nunca coordenadas exactas |
| **Retención limitada** | Políticas para eliminar conversaciones, perfiles e inferencias cuando corresponda |
| **Protección frente a abusos** | Bloqueo, denuncia, detección de spam, revisión de casos y protección frente al acoso |
| **Transparencia de la IA** | Siempre queda claro cuándo se habla con Cupidilla y cuándo un texto lo ha generado una IA |
| **Igualdad de seguridad** | Las herramientas de seguridad son las mismas en el plan gratuito y en Plus |

## Tres consentimientos distintos

1. **Uso del servicio.** Se da al registrarse.
2. **Tratamiento de datos sensibles**, cuando proceda. Explícito y separado del anterior.
3. **Cada presentación.** Independiente de los dos anteriores: autoriza a compartir una información concreta con una persona concreta.

De cada autorización de presentación se registra:

- quién la dio,
- qué información permite compartir,
- para qué presentación,
- cuándo,
- y, si se retira, cuándo se retiró.

De los consentimientos generales se guarda además la finalidad y la versión del texto aceptado.

## Qué implica en cada hito

| Hito | Requisitos |
|---|---|
| **H0** | Pedir solo los datos mínimos · registrar el consentimiento de uso con fecha y versión · poder eliminar la cuenta |
| **H1** | No presionar para obtener información íntima · no inferir atributos sensibles · perfil privado por defecto · poder eliminar cualquier observación · aviso visible de que Cupidilla es una IA |
| **H2** | Zona aproximada · las explicaciones de compatibilidad usan solo datos confirmados y autorizados |
| **H3** | Registro de autorizaciones por presentación · bloquear, denunciar y retirar el consentimiento · un rechazo no se puede saltar pagando |
| **H4** | Moderación con revisión humana y apelación · detección de spam y posibles estafas · recomendaciones para encuentros seguros |

## La IA

### Transparencia

El artículo 50 del Reglamento europeo de IA establece obligaciones de transparencia para sistemas que interactúan con personas y para contenidos generados. Cupidilla se identifica siempre como IA, y las sugerencias de mensajes se presentan como generadas por ella.

### El proveedor del modelo

Las conversaciones de la entrevista se envían a un proveedor externo y pueden contener datos de categoría especial. Antes de tener usuarios reales hay que revisar:

- las condiciones de tratamiento de datos y el contrato de encargo,
- cuánto tiempo conserva el proveedor lo que recibe,
- en qué región se ejecuta la inferencia y si hay transferencias internacionales.

Regla de diseño desde el primer día: enviar al modelo lo mínimo necesario para cada tarea.

## Antes de tener usuarios reales

- [ ] Revisión jurídica especializada: bases legales, obligaciones aplicables y transferencias de datos.
- [ ] Determinar si procede una evaluación de impacto relativa a la protección de datos.
- [ ] Política de privacidad y términos de uso.
- [ ] Política de retención y borrado.
- [ ] Mecanismo de verificación de edad (ver [decisiones](decisiones.md#abiertas)).
- [ ] Procedimiento de denuncias, revisión y apelación.
- [ ] Condiciones del proveedor del modelo revisadas.
- [ ] Comprobación de la marca y del dominio.

No se debe asumir que toda plataforma de contactos tiene las mismas obligaciones: dependen de las funciones, los datos y el tratamiento concretos.

## Por comprobar

Afirmaciones que aparecieron en la conversación con ChatGPT y que nadie ha verificado todavía. Los enlaces son los que aportó ChatGPT.

| Afirmación | Estado |
|---|---|
| Hay directrices europeas publicadas en julio de 2026 que interpretan el artículo 50 del Reglamento de IA | Sin verificar · [ficha del artículo 50](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-50) |
| Requisitos de la AEPD para el consentimiento explícito | Sin verificar · consultar en [aepd.es](https://www.aepd.es/) |
| Existen plataformas con nombres parecidos (Cupid.com, CupidDates) que podrían chocar con «Cupidilla» | Sin verificar · buscar en [OEPM](https://consultas2.oepm.es/LocalizadorWeb/busquedaDenominacion) y [EUIPO](https://www.euipo.europa.eu/es/search-ip) |
| Disponibilidad de `cupidilla.com` y `cupidilla.es` | Sin verificar · [ICANN Lookup](https://lookup.icann.org/) |

Texto del RGPD: [Reglamento (UE) 2016/679](https://eur-lex.europa.eu/legal-content/ES/TXT/?uri=CELEX:32016R0679).
