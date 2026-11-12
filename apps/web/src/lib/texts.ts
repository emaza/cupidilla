/**
 * Textos de interfaz, copiados palabra por palabra de la tabla de §5 del diseño UX.
 * Las claves son las de esa tabla. `{x}` es un valor variable (ver `fill`).
 * El texto de /legal/condiciones (§5.9) vive en `legal/terms-2026-11-borrador.svelte`.
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
    'No sabemos si tu cuenta se ha eliminado: se ha perdido la conexión antes de recibir la respuesta. Para comprobarlo, ve a tu cuenta. Si te lleva a la pantalla de entrada, la cuenta ya no existe. Si ves tu cuenta, sigue activa y puedes volver a intentarlo.',
  'eliminar.enlace.comprobar': 'Comprobar si mi cuenta sigue activa',

  // 5.7 Errores de página
  'error404.titulo': 'No encontramos esta página',
  'error404.texto': 'Puede que el enlace esté mal escrito o que la página ya no exista.',
  'error500.titulo': 'Algo ha fallado',
  'error500.texto': 'Ha sido cosa nuestra. Inténtalo de nuevo en unos minutos.',
  'error.boton.inicio': 'Ir al inicio',

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
