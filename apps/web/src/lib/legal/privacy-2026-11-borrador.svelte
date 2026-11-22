<script lang="ts">
  import { resolve } from '$app/paths';
  // El mismo plazo que aplica el barrido de la API (técnico de contacto §9).
  import { CONTACT_MESSAGE_RETENTION_DAYS } from '@cupidilla/contracts';

  /** Edad mínima configurada en la instalación (viene de la API). */
  let { minAge }: { minAge: number } = $props();
</script>

<!--
  Borrador de /legal/privacy, versión 2026-11-borrador (PRIVACY_POLICY_VERSION). Texto de la §2.3
  del diseño UX de contacto, palabra por palabra; texts.spec.ts lo compara con esa tabla. Los
  [PENDIENTE] se muestran tal cual: los rellena quien tenga la información.
  Una versión nueva del texto es un archivo nuevo y un cambio de PRIVACY_POLICY_VERSION. El
  archivo anterior se conserva sin enlazar: es lo que aceptaron los mensajes de contacto guardados.
-->
<svelte:head>
  <title>Política de privacidad (borrador) — Cupidilla</title>
</svelte:head>

<article class="prose">
  <div class="draft">
    <p>Borrador pendiente de revisión jurídica. No es el texto definitivo y puede cambiar.</p>
  </div>

  <h1>Política de privacidad</h1>
  <p>Versión 2026-11-borrador</p>

  <h2>1. Quién es el responsable</h2>
  <p>
    [PENDIENTE: nombre o razón social, NIF, domicilio y correo de contacto del responsable del
    tratamiento. Debe coincidir con la sección 1 de las condiciones de uso.]
  </p>

  <h2>2. Qué datos tratamos y para qué</h2>
  <p>
    Tu cuenta: tu correo, tu contraseña (que no guardamos en claro), tu fecha de nacimiento y qué
    versión de las condiciones aceptaste y cuándo, para que puedas entrar y para comprobar que eres
    mayor de edad. Si entras con Google o Facebook: un identificador tuyo en ese servicio y tu
    correo. Correos del servicio: te escribimos para confirmar tu correo, ayudarte a recuperar tu
    contraseña y avisarte de cambios en tu cuenta. Formulario de contacto: tu nombre, tu correo, tu
    teléfono si lo escribes, el asunto y el mensaje, y qué versión de esta política aceptaste y
    cuándo, para atender tu mensaje y responderte. Seguridad: datos técnicos mínimos, como la
    dirección IP, para proteger el servicio y limitar abusos. [PENDIENTE: confirmar la lista con lo
    que guarda realmente el sistema.]
  </p>

  <h2>3. Por qué podemos tratarlos</h2>
  <p>
    [PENDIENTE: base jurídica de cada finalidad. Propuesta: cuenta y correos del servicio, ejecución
    de las condiciones de uso; formulario de contacto, tu consentimiento al marcar la casilla;
    seguridad y límites de uso, interés legítimo; comprobación de edad, cumplimiento de las
    condiciones de uso.]
  </p>

  <h2>4. Cuánto tiempo los conservamos</h2>
  <p>
    Los datos de tu cuenta, hasta que la elimines. Los mensajes de contacto, {CONTACT_MESSAGE_RETENTION_DAYS}
    días desde que los recibimos; después se borran automáticamente. Los datos técnicos de seguridad,
    [PENDIENTE: plazo].
  </p>

  <h2>5. Con quién los compartimos</h2>
  <p>
    No vendemos tus datos ni los cedemos a terceros para sus propios fines. Usamos proveedores que
    tratan datos por nuestra cuenta: [PENDIENTE: alojamiento, envío de correo y cualquier otro
    encargado, con su país]. Si entras con Google o Facebook, esos servicios tratan tus datos según
    sus propias políticas. Podemos comunicar datos a las autoridades cuando una ley nos obligue.
  </p>

  <h2>6. Transferencias fuera de la Unión Europea</h2>
  <p>[PENDIENTE: indicar si hay transferencias y con qué garantías.]</p>

  <h2>7. Tus derechos y cómo ejercerlos</h2>
  <p>
    Puedes pedirnos acceder a tus datos, rectificarlos, suprimirlos, limitar su tratamiento,
    oponerte a él y recibirlos en un formato reutilizable. Si el tratamiento se basa en tu
    consentimiento, puedes retirarlo en cualquier momento, sin que afecte a lo ya hecho. Puedes
    eliminar tu cuenta tú mismo desde «Tu cuenta». Para cualquier otro derecho, escríbenos desde la
    <a href={resolve('contact')}>página de contacto</a> indicando «Derechos de protección de datos» en
    el asunto, o a [PENDIENTE: correo]. Si crees que no tratamos bien tus datos, puedes reclamar ante
    la Agencia Española de Protección de Datos (www.aepd.es).
  </p>

  <h2>8. Menores de edad</h2>
  <p>
    Cupidilla es solo para personas de {minAge} años o más. No queremos datos de menores: si descubrimos
    que los tenemos, los borraremos.
  </p>

  <h2>9. Seguridad</h2>
  <p>
    [PENDIENTE: resumen de las medidas técnicas y organizativas, revisado por quien las conozca.]
  </p>

  <h2>10. Cookies y almacenamiento en tu navegador</h2>
  <p>
    Usamos solo cookies técnicas necesarias para el funcionamiento (mantener tu sesión y recordar un
    aviso de un solo uso). No usamos cookies de publicidad ni de seguimiento. [PENDIENTE: comprobar
    al desplegar que es cierto.]
  </p>

  <h2>11. Cambios</h2>
  <p>
    Si cambiamos esta política publicaremos una nueva versión y la fecha. [PENDIENTE: criterio para
    avisar de los cambios importantes.]
  </p>
</article>
