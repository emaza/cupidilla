import { WEB_URL } from './oauth-env.ts';

/**
 * Mailpit de `docker compose` (correo §11.2), compartido con `npm run dev`. Las pruebas no se
 * pisan porque cada una escribe a un destinatario único (`e2e+<uuid>@example.com`) y busca solo
 * ese.
 */
export const mailpitUrl = (): string =>
  `http://127.0.0.1:${process.env.MAILPIT_HTTP_PORT || '8025'}`;
/** Funciones y no constantes: `playwright.config.ts` carga el .env después de importar esto. */
export const mailpitSmtpUrl = (): string =>
  `smtp://127.0.0.1:${process.env.MAILPIT_SMTP_PORT || '1025'}`;

export interface MailpitMessage {
  ID: string;
  Subject: string;
  To: { Name: string; Address: string }[];
  Created: string;
}

/** `globalSetup`: sin Mailpit no tiene sentido arrancar los e2e. */
export async function assertMailpitUp(baseUrl = mailpitUrl()): Promise<void> {
  let ok = false;
  try {
    ok = (await fetch(`${baseUrl}/api/v1/info`, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    // No escucha nadie.
  }
  if (!ok) throw new Error(`Mailpit no responde en ${baseUrl}: levanta Mailpit: npm run mail:up`);
}

const searchUrl = (to: string) =>
  `${mailpitUrl()}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`;

/** Mensajes a ese destinatario, del más reciente al más antiguo. */
export async function mailTo(to: string): Promise<MailpitMessage[]> {
  const response = await fetch(searchUrl(to));
  if (!response.ok) throw new Error(`Mailpit respondió ${response.status} al buscar`);
  const body = (await response.json()) as { messages: MailpitMessage[] | null };
  return body.messages ?? [];
}

/**
 * Espera al correo más reciente a `to` (con ese asunto, si se da). Sondea cada 200 ms y falla
 * pasado `timeoutMs`.
 */
export async function waitForMail(
  to: string,
  options: { subject?: string; timeoutMs?: number } = {},
): Promise<MailpitMessage> {
  const { subject, timeoutMs = 10_000 } = options;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = (await mailTo(to)).find(
      (message) => subject === undefined || message.Subject === subject,
    );
    if (found) return found;
    if (Date.now() > deadline) {
      throw new Error(`No ha llegado ningún correo${subject ? ` «${subject}»` : ''} a ${to}`);
    }
    await new Promise((done) => setTimeout(done, 200));
  }
}

/** Texto plano del mensaje, tal cual. */
export async function textOf(message: MailpitMessage): Promise<string> {
  const response = await fetch(`${mailpitUrl()}/view/${message.ID}.txt`);
  if (!response.ok) throw new Error(`Mailpit respondió ${response.status} al leer el mensaje`);
  return response.text();
}

/** El enlace `http://localhost:4173<path>?token=…` del texto plano del mensaje. */
export async function linkIn(message: MailpitMessage, path: string): Promise<string> {
  const text = await textOf(message);
  const escaped = `${WEB_URL}${path}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const link = new RegExp(`${escaped}\\?token=[A-Za-z0-9_-]+`).exec(text)?.[0];
  if (!link) throw new Error(`El correo no tiene ningún enlace a ${path}`);
  return link;
}

/** Borra de Mailpit los correos a ese destinatario, y solo esos. */
export async function clearMailTo(to: string): Promise<void> {
  const response = await fetch(searchUrl(to), { method: 'DELETE' });
  if (!response.ok) throw new Error(`Mailpit respondió ${response.status} al borrar`);
}

/** Espera a que haya al menos `count` correos a `to` y los devuelve, del más reciente al más antiguo. */
export async function waitForMailCount(
  to: string,
  count: number,
  { timeoutMs = 10_000 }: { timeoutMs?: number } = {},
): Promise<MailpitMessage[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const messages = await mailTo(to);
    if (messages.length >= count) return messages;
    if (Date.now() > deadline) throw new Error(`No han llegado ${count} correos a ${to}`);
    await new Promise((done) => setTimeout(done, 200));
  }
}

/**
 * El enlace `<path>?token=…` del texto plano, sin el origen: así sirve también en las pilas
 * propias de algunos e2e, cuyo `PUBLIC_WEB_URL` es otro puerto. Se abre con `page.goto` relativo.
 */
export async function pathIn(message: MailpitMessage, path: string): Promise<string> {
  const text = await textOf(message);
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = new RegExp(`https?://[^/\\s]+(${escaped}\\?token=[A-Za-z0-9_-]+)`).exec(text)?.[1];
  if (!found) throw new Error(`El correo no tiene ningún enlace a ${path}`);
  return found;
}
