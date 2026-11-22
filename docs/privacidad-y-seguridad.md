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

## Correo

Desde el hito de correo (decisión 22, [diseño técnico](correo-diseno-tecnico.md)) Cupidilla envía correos automáticos: confirmar el correo, recordatorio antes de borrar una cuenta sin confirmar, restablecer la contraseña, aviso de que alguien intentó registrarse con tu correo y aviso de contraseña cambiada. Los enlaces llevan un token de un solo uso del que solo se guarda el hash; ningún correo lleva rastreadores.

**Retención** ([técnico §3.5](correo-diseno-tecnico.md#35-retención)):

| Dato | Cuánto vive |
|---|---|
| Fila del *outbox* enviada o descartada | Se borra en el acto |
| Fila del *outbox* fallida | 7 días (para diagnosticar), luego la limpieza |
| Fila del *outbox* pendiente | Hasta enviarse; como mucho unas 8 h de reintentos |
| Tokens de los enlaces (`email_tokens`, solo el hash) | Hasta usarse, caducar (24 h para confirmar, 1 h para restablecer) o borrarse la cuenta |
| Cuenta sin confirmar el correo | 7 días desde su creación; después se borra con todos sus datos |

Al borrar una cuenta se borran también, en la misma operación, las filas del *outbox* con su correo, salvo las del formulario de contacto (ver [Formulario de contacto](#formulario-de-contacto)). El *outbox* guarda el correo de destino y el tipo de mensaje, nunca un token ni un enlace. Los correos de contacto llevan además una referencia al mensaje, y su contenido se queda en `contact_messages`.

**Proveedor SMTP**: el servicio que envíe los correos en producción será **encargado del tratamiento** (recibe el correo de cada persona y el contenido de los mensajes). **Pendiente de elegir** antes del despliegue, junto a «Marca y dominio» (ver [decisiones](decisiones.md#antes-de-la-beta)): tiene que tener servidores en la UE y un contrato de encargo, y el dominio remitente necesita SPF, DKIM y DMARC. En local y en las pruebas se usa Mailpit, que no sale de la máquina.

## Formulario de contacto

La página pública `/contact` ([diseño técnico](contacto-diseno-tecnico.md)) recoge el nombre, el correo, el teléfono si se da, el asunto y el mensaje, y la casilla «He leído y acepto la política de privacidad», que enlaza a un borrador en `/legal/privacy`. Cada mensaje se guarda en `contact_messages` con la versión de la política aceptada y se envía por correo al buzón `CONTACT_TO_ADDRESS`. Si se activa `CONTACT_ACK_EMAIL`, quien escribe recibe además un acuse sin nada de lo que escribió.

- **Minimización**: no se guarda la IP, ni en claro ni con hash. Solo vive en el contador en memoria del límite de envíos. Tampoco se guarda el *user agent* ni se enlaza el mensaje con la cuenta aunque haya sesión.
- **Logs**: nunca contienen el nombre, el correo, el teléfono, el asunto ni el mensaje.
- **Base jurídica y texto de la política**: pendientes de la revisión jurídica. La aceptación se guarda como «ha leído y acepta», con su versión.

**Retención** ([técnico §9](contacto-diseno-tecnico.md#9-retención-y-borrado)). El plazo de 180 días es una **propuesta**, pendiente de que la confirmen el CTO y la revisión jurídica:

| Dato | Cuánto vive |
|---|---|
| Mensaje de contacto (`contact_messages`) | 180 días desde el envío; después lo borra un barrido horario |
| Fila del *outbox* de un mensaje de contacto | Como las demás (se borra al enviarse; si falla, a los 7 días) y, en todo caso, cuando se borra su mensaje |
| Mensajes de una persona que pide la supresión | Se borran en el momento, todos los de su dirección, junto con sus correos pendientes |
| Copia en el buzón de `CONTACT_TO_ADDRESS` y las respuestas | Fuera de la aplicación: el mismo plazo de 180 días, con una regla del proveedor o a mano. **Pendiente** de configurar |
| IP de quien escribe | No se guarda |

Borrar una cuenta **no** borra los mensajes de contacto de esa dirección, porque no están enlazados con ella. Se borran por su plazo o a petición, y la política de privacidad lo tiene que decir. El proveedor SMTP también trata el contenido de estos mensajes como encargado (ver [Correo](#correo)).

## Protección antibots (ALTCHA)

Los formularios `/register`, `/forgot-password` y `/contact` llevan una comprobación antibots con ALTCHA ([diseño técnico](captcha-diseno-tecnico.md)). Es una prueba de trabajo: el navegador hace un cálculo breve y la API lo verifica. Se controla con `CAPTCHA_ENABLED`, que está activada por defecto. El login y OAuth no la llevan.

- **Sin terceros**: ALTCHA está alojado en nuestros servidores. No se usa ALTCHA Sentinel ni su nube, y el widget no enlaza a altcha.org. El navegador solo habla con nuestra web.
- **Sin cookies ni seguimiento**: el widget no pone cookies ni guarda nada en el navegador. La firma de interacción humana (cómo se usan el teclado y el puntero) está desactivada.
- **Minimización**: el reto no contiene ningún dato de la persona. La API solo recuerda en memoria el identificador aleatorio (`nonce`) de cada reto usado, hasta que caduca (10 minutos) o hasta que se reinicia. La IP solo vive en el contador en memoria del límite de intentos, como en el resto de rutas. En los logs nunca aparecen el reto, la solución ni la IP.
- **Accesibilidad**: no hay puzles ni pruebas cognitivas (WCAG 3.3.8). Sin JavaScript, estos formularios no se pueden enviar mientras la comprobación esté activada: se avisa antes de empezar y se ofrece otra vía.
- **Política de privacidad**: tiene que decir que estos formularios hacen una comprobación automática en el navegador, sin cookies ni terceros. **Para la revisión jurídica**: si este cálculo entra en el artículo 5.3 de la Directiva ePrivacy. En principio es estrictamente necesario y no lee ni guarda nada que identifique a la persona.

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
- [ ] Política de retención y borrado (incluye confirmar los 180 días de los mensajes de contacto).
- [ ] Política de privacidad definitiva en `/legal/privacy` (hoy es un borrador, versión `2026-11-borrador`).
- [ ] La política de privacidad explica la comprobación antibots y la revisión jurídica confirma el encaje con ePrivacy (ver [Protección antibots](#protección-antibots-altcha)).
- [ ] Buzón de `CONTACT_TO_ADDRESS` elegido, con acceso restringido y la retención configurada (ver [Formulario de contacto](#formulario-de-contacto)).
- [ ] Mecanismo de verificación de edad (ver [decisiones](decisiones.md#abiertas)).
- [ ] Procedimiento de denuncias, revisión y apelación.
- [ ] Condiciones del proveedor del modelo revisadas.
- [ ] Proveedor SMTP de producción elegido, con contrato de encargo y servidores en la UE (ver [Correo](#correo)).
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
