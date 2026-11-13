/**
 * Textos de interfaz, copiados palabra por palabra de la tabla de §5 del diseño UX de H0 y de la
 * del diseño UX de la entrada con terceros.
 * Las claves son las de esa tabla. `{x}` es un valor variable (ver `fill`).
 * El texto de /legal/terms (§5.9) vive en `legal/terms-2026-11-borrador.svelte`.
 */
export const texts = {
  // 5.1 Comunes
  'comun.marca': 'Cupidilla',
  'comun.meta.sufijo': ' — Cupidilla',
  'comun.meta.prefijo_error': 'Error: ',
  'comun.saltar': 'Saltar al contenido',
  'comun.nav.etiqueta': 'Principal',
  'comun.nav.entrar': 'Entrar',
  'comun.nav.registro': 'Crear cuenta',
  'comun.nav.cuenta': 'Mi cuenta',
  'comun.pie.condiciones': 'Condiciones de uso',
  'comun.pie.edad': 'Solo para mayores de 18 años',
  'comun.error.prefijo_oculto': 'Error:',
  'comun.error.resumen_titulo': 'Revisa esto antes de seguir',
  'comun.error.limite': 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
  'comun.campos_obligatorios': 'Todos los campos son obligatorios.',
  'comun.contrasena.mostrar': 'Mostrar contraseña',
  'comun.contrasena.ocultar': 'Ocultar contraseña',
  'comun.nueva_pestana': '(se abre en una pestaña nueva)',
  'comun.boton.volver_inicio': 'Volver al inicio',

  // 5.2 Portada
  'portada.meta.titulo': 'Menos deslizar. Más conectar.',
  'portada.titulo': 'Menos deslizar. Más conectar.',
  'portada.texto.intro':
    'Cupidilla es una celestina con inteligencia artificial: te conoce conversando, te propone pocas personas y te presenta solo si las dos partes quieren.',
  'portada.texto.estado':
    'Cupidilla está en construcción. Puedes crear tu cuenta ya; la conversación con ella llegará pronto.',
  'portada.boton.registro': 'Crear cuenta',
  'portada.boton.entrar': 'Entrar',
  'portada.boton.cuenta': 'Ir a mi cuenta',
  'portada.aviso.sesion_cerrada': 'Has cerrado sesión.',
  'portada.aviso.cuenta_eliminada':
    'Tu cuenta se ha eliminado. Hemos borrado tus datos y cerrado tu sesión.',

  // 5.3 Registro
  'registro.meta.titulo': 'Crear cuenta',
  'registro.titulo': 'Crea tu cuenta',
  'registro.campo.correo': 'Correo electrónico',
  'registro.campo.contrasena': 'Contraseña',
  'registro.ayuda.contrasena':
    'Mínimo 10 caracteres, sin más reglas: una frase larga vale. De momento no podemos recuperarla, así que guárdala en un gestor de contraseñas o donde no se te pierda.',
  'registro.campo.nacimiento': 'Fecha de nacimiento',
  'registro.ayuda.nacimiento':
    'La necesitamos para comprobar que tienes 18 años o más. Por ejemplo: 14 3 1990',
  'registro.campo.dia': 'Día',
  'registro.campo.mes': 'Mes',
  'registro.campo.anio': 'Año',
  'registro.campo.condiciones': 'Acepto las condiciones de uso de Cupidilla (versión {version}).',
  'registro.enlace.condiciones': 'Leer las condiciones',
  'registro.ayuda.condiciones':
    'Es el permiso para usar el servicio. Es un texto provisional, pendiente de revisión jurídica. Más adelante, para cualquier otra cosa, te pediremos permiso aparte.',
  'registro.boton.enviar': 'Crear cuenta',
  'registro.boton.enviando': 'Creando cuenta…',
  'registro.estado.enviando': 'Creando tu cuenta…',
  'registro.enlace.entrar': '¿Ya tienes cuenta? Entra',
  'registro.error.correo_vacio': 'Escribe tu correo electrónico.',
  'registro.error.correo_formato':
    'Ese correo no parece válido. Comprueba que tiene el formato nombre@dominio.es.',
  'registro.error.correo_largo': 'Ese correo es demasiado largo.',
  'registro.error.correo_existente':
    'No hemos podido crear la cuenta con ese correo. Si ya tienes una, entra; si no, comprueba que está bien escrito o prueba con otro.',
  'registro.error.contrasena_vacia': 'Elige una contraseña.',
  'registro.error.contrasena_corta': 'La contraseña necesita al menos 10 caracteres.',
  'registro.error.contrasena_larga': 'La contraseña no puede tener más de 128 caracteres.',
  'registro.error.fecha_vacia': 'Escribe tu fecha de nacimiento.',
  'registro.error.dia': 'Escribe el día con uno o dos números, del 1 al 31.',
  'registro.error.mes': 'Escribe el mes con uno o dos números, del 1 al 12.',
  'registro.error.anio': 'Escribe el año con cuatro números.',
  'registro.error.fecha_inexistente': 'Esa fecha no existe. Revisa el día, el mes y el año.',
  'registro.error.fecha_futura': 'La fecha de nacimiento no puede ser posterior a hoy.',
  'registro.error.condiciones': 'Para crear la cuenta tienes que aceptar las condiciones de uso.',
  'registro.error.condiciones_version':
    'Las condiciones han cambiado mientras rellenabas el formulario. Léelas de nuevo y vuelve a marcar la casilla.',
  'registro.error.servidor':
    'Algo ha fallado por nuestra parte y no hemos podido crear tu cuenta. Inténtalo de nuevo en unos minutos.',
  'registro.error.resultado_incierto':
    'No sabemos si tu cuenta se ha creado: se ha perdido la conexión antes de recibir la respuesta. Antes de volver a registrarte, prueba a entrar con este correo y esta contraseña. Si entras, la cuenta ya existe. Si no puedes entrar, pulsa «Crear cuenta» otra vez.',
  'registro.enlace.comprobar_entrada': 'Probar a entrar con este correo',
  'registro.menor.meta.titulo': 'No podemos crear tu cuenta',
  'registro.menor.titulo': 'No podemos crear tu cuenta',
  'registro.menor.texto1':
    'Cupidilla es solo para personas de 18 años o más, así que no hemos creado tu cuenta ni hemos guardado ningún dato.',
  'registro.menor.texto2': 'No es nada personal: es una condición del servicio.',

  // 5.4 Entrar
  'entrar.meta.titulo': 'Entrar',
  'entrar.titulo': 'Entra en tu cuenta',
  'entrar.aviso.necesita_sesion': 'Entra para ver esa página.',
  'entrar.campo.correo': 'Correo electrónico',
  'entrar.campo.contrasena': 'Contraseña',
  'entrar.boton.enviar': 'Entrar',
  'entrar.boton.enviando': 'Entrando…',
  'entrar.estado.enviando': 'Entrando en tu cuenta…',
  'entrar.enlace.registro': '¿No tienes cuenta? Crea una',
  'entrar.error.correo_vacio': 'Escribe tu correo electrónico.',
  'entrar.error.contrasena_vacia': 'Escribe tu contraseña.',
  'entrar.error.credenciales': 'Correo o contraseña incorrectos.',
  'entrar.error.servidor':
    'Algo ha fallado por nuestra parte y no hemos podido iniciar tu sesión. Inténtalo de nuevo en unos minutos.',

  // 5.5 Cuenta
  'cuenta.meta.titulo': 'Tu cuenta',
  'cuenta.titulo': 'Tu cuenta',
  'cuenta.datos.titulo': 'Tus datos',
  'cuenta.datos.correo': 'Correo',
  'cuenta.datos.condiciones': 'Condiciones aceptadas',
  'cuenta.datos.condiciones_valor': 'versión {version}, el {fecha}',
  'cuenta.cupidilla.titulo': 'Cupidilla',
  'cuenta.cupidilla.texto':
    'Cupidilla todavía no conversa. Pronto te hará unas preguntas para conocerte; cuando esté lista, lo verás aquí.',
  'cuenta.sesion.titulo': 'Sesión',
  'cuenta.sesion.boton': 'Cerrar sesión',
  'cuenta.eliminar.titulo': 'Eliminar tu cuenta',
  'cuenta.eliminar.texto': 'Si quieres irte, puedes borrar tu cuenta y tus datos cuando quieras.',
  'cuenta.eliminar.enlace': 'Eliminar mi cuenta',
  'cuenta.error.servidor':
    'Algo ha fallado por nuestra parte y no hemos podido cerrar tu sesión. Inténtalo de nuevo en unos minutos.',

  // 5.6 Eliminar cuenta
  'eliminar.meta.titulo': 'Eliminar tu cuenta',
  'eliminar.titulo': 'Eliminar tu cuenta',
  'eliminar.texto.alcance':
    'Se borrará de inmediato tu cuenta y todo lo que hemos guardado de ti: correo, contraseña, fecha de nacimiento y consentimientos.',
  'eliminar.texto.irreversible':
    'No se puede deshacer. Si más adelante quieres volver, tendrás que crear una cuenta nueva.',
  'eliminar.campo.contrasena': 'Contraseña',
  'eliminar.ayuda.contrasena': 'Escríbela para confirmar que eres tú.',
  'eliminar.boton.enviar': 'Eliminar mi cuenta definitivamente',
  'eliminar.boton.enviando': 'Eliminando…',
  'eliminar.estado.enviando': 'Eliminando tu cuenta…',
  'eliminar.enlace.cancelar': 'Cancelar',
  'eliminar.error.contrasena_vacia': 'Escribe tu contraseña para confirmar.',
  'eliminar.error.contrasena': 'La contraseña no es correcta. No hemos borrado nada.',
  'eliminar.error.servidor':
    'Algo ha fallado por nuestra parte y no hemos podido eliminar tu cuenta. Tu cuenta sigue como estaba. Inténtalo de nuevo en unos minutos.',
  'eliminar.error.resultado_incierto':
    'No sabemos si tu cuenta se ha eliminado: se ha perdido la conexión antes de recibir la respuesta. Para comprobarlo, ve a tu cuenta. Si la ves, sigue activa y puedes volver a intentarlo. Si te pide entrar, entra con tu correo y tu contraseña: si entras, la cuenta sigue activa. Si te dice que el correo o la contraseña son incorrectos y has escrito bien la contraseña, lo más probable es que se haya eliminado. Si te dice que hay demasiados intentos o que algo ha fallado, espera unos minutos y vuelve a intentarlo: eso no dice nada sobre tu cuenta.',
  'eliminar.enlace.comprobar': 'Ir a mi cuenta para comprobarlo',

  // 5.7 Errores de página
  'error404.titulo': 'No encontramos esta página',
  'error404.texto': 'Puede que el enlace esté mal escrito o que la página ya no exista.',
  'error500.titulo': 'Algo ha fallado',
  'error500.texto': 'Ha sido cosa nuestra. Inténtalo de nuevo en unos minutos.',
  'error.boton.inicio': 'Ir al inicio',

  // Entrada con Google y Facebook (login-terceros-diseno-ux.md §5)
  'proveedor.grupo.etiqueta': 'Continuar con otro servicio',
  'proveedor.boton.google': 'Continuar con Google',
  'proveedor.boton.facebook': 'Continuar con Facebook',
  'proveedor.estado.conectando': 'Conectando con {proveedor}…',
  'proveedor.separador.entrar': 'O entra con tu correo y contraseña',
  'proveedor.separador.registro': 'O crea tu cuenta con tu correo',
  'proveedor.ayuda.registro':
    'Si es la primera vez, te pediremos tu fecha de nacimiento y que aceptes las condiciones antes de crear tu cuenta. De Google o Facebook solo guardamos tu correo y un identificador.',
  'proveedor.aviso.cancelado':
    'No has continuado con {proveedor}, así que no hemos hecho ningún cambio. Puedes volver a intentarlo o seguir con tu correo.',
  'proveedor.error.fallo':
    '{proveedor} no ha respondido como esperábamos y no hemos podido completar el proceso. No hemos hecho ningún cambio. Inténtalo de nuevo en unos minutos o sigue con tu correo.',
  'proveedor.error.sin_correo':
    '{proveedor} no nos ha enviado tu correo y lo necesitamos para crear tu cuenta. Comprueba en {proveedor} que tu cuenta tiene un correo y que has dado permiso para compartirlo, e inténtalo de nuevo. También puedes seguir con tu correo en Cupidilla.',
  'proveedor.error.correo_sin_verificar':
    'El correo de tu cuenta de {proveedor} todavía no está verificado y no podemos usarlo. Verifícalo en {proveedor} e inténtalo de nuevo, o sigue con tu correo en Cupidilla.',
  'proveedor.error.caducado':
    'Ha pasado demasiado tiempo o has vuelto atrás, y por seguridad hemos cancelado el proceso. Pulsa de nuevo el botón del servicio que quieras usar.',
  'proveedor.error.cuenta_con_otro':
    'Ya existe una cuenta con ese correo, pero se creó con {proveedor}. Entra con {proveedor} y, desde Tu cuenta, añade la otra forma de entrar.',
  'entrar.ayuda.proveedor': 'Si creaste tu cuenta con Google o Facebook, usa esos botones.',
  'alta.meta.titulo': 'Termina de crear tu cuenta',
  'alta.titulo': 'Termina de crear tu cuenta',
  'alta.texto.intro':
    'Has entrado con {proveedor}. Antes de crear tu cuenta de Cupidilla necesitamos dos cosas más.',
  'alta.campo.correo': 'Correo de {proveedor}',
  'alta.ayuda.correo':
    'Este será el correo de tu cuenta. Viene de {proveedor} y no se puede cambiar aquí.',
  'alta.texto.acceso': 'Entrarás siempre con {proveedor}: no te pedimos contraseña.',
  'alta.boton.enviar': 'Crear mi cuenta',
  'alta.boton.enviando': 'Creando cuenta…',
  'alta.estado.enviando': 'Creando tu cuenta…',
  'alta.boton.cancelar': 'Cancelar',
  'alta.aviso.cancelada': 'Has cancelado. No hemos creado ninguna cuenta ni guardado tus datos.',
  'alta.texto.caducidad':
    'Por seguridad, tienes {minutos} minutos para terminar. Si se acaba el tiempo, tendrás que empezar de nuevo.',
  'alta.menor.texto3': 'No hemos guardado nada de tu cuenta de {proveedor}.',
  'alta.error.servidor':
    'Algo ha fallado por nuestra parte y no hemos podido crear tu cuenta. Inténtalo de nuevo en unos minutos.',
  'alta.error.resultado_incierto':
    'No sabemos si tu cuenta se ha creado: se ha perdido la conexión antes de recibir la respuesta. Para comprobarlo, entra con {proveedor}: si llegas a tu cuenta, ya está creada. Si Cupidilla te vuelve a pedir la fecha de nacimiento, no se ha creado y puedes completarla otra vez. Si vuelves a enviar este formulario y te dice que ha pasado demasiado tiempo, es que la primera vez sí se creó: entra con {proveedor}.',
  'alta.enlace.comprobar': 'Probar a entrar con {proveedor}',
  'union.aviso.cancelada':
    'No hemos unido las cuentas. Puedes entrar con tu correo y tu contraseña.',
  'union.error.limite':
    'Has fallado varias veces. Por seguridad hemos cancelado la unión. Para volver a intentarlo, empieza de nuevo con tu cuenta de Google o Facebook.',

  // 5.8 Textos para lectores de pantalla
  'a11y.error.prefijo': 'Error:',
  'a11y.nueva_pestana': '(se abre en una pestaña nueva)',
} as const;

export type TextKey = keyof typeof texts;

/** Texto de una clave. */
export function t(key: TextKey): string {
  return texts[key];
}

/** Texto de una clave con sus valores `{x}` sustituidos. */
export function fill(key: TextKey, values: Record<string, string>): string {
  return texts[key].replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

/** `<title>` con el patrón «Título — Cupidilla», y el prefijo «Error: » si la página tiene errores. */
export function pageTitle(key: TextKey, hasErrors = false): string {
  const prefix = hasErrors ? texts['comun.meta.prefijo_error'] : '';
  return `${prefix}${texts[key]}${texts['comun.meta.sufijo']}`;
}
