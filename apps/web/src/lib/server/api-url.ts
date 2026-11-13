const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * La web manda a la API la clave interna y los tokens de sesión: `API_URL` tiene que ser
 * `https:`, salvo en loopback (127.0.0.1, localhost, ::1) o si `API_URL_ALLOW_HTTP` lo permite
 * de forma explícita (red privada de contenedores). Lanza un error que no muestra la URL.
 */
export function assertApiUrlTransport(apiUrl: string, allowHttp: boolean): void {
  // Sin `new URL` directo: su TypeError lleva la URL en `input`.
  if (!URL.canParse(apiUrl)) throw new Error('API_URL no es una URL válida.');
  const url = new URL(apiUrl);
  if (url.protocol === 'https:') return;
  if (url.protocol !== 'http:') {
    throw new Error('API_URL debe usar https: (o http: en loopback).');
  }
  if (allowHttp || LOOPBACK_HOSTS.has(url.hostname)) return;
  throw new Error(
    'API_URL usa http: fuera de loopback. Usa https:, o pon API_URL_ALLOW_HTTP=true solo si la API está en una red privada.',
  );
}
