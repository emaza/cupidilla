import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

/**
 * Fallo que el proxy simula en una ruta:
 * - `hang`: recibe la petición y no responde nunca (la web agota su plazo de 5 s). La API no la ve.
 * - `cut`: la pasa a la API, espera su respuesta entera y corta la conexión sin devolverla.
 *   La API sí la ha procesado.
 */
export type ProxyFault = 'hang' | 'cut';

export interface ApiProxy {
  url: string;
  /** API a la que se reenvía todo lo que no tiene fallo. */
  setTarget(url: string): void;
  /** Fallo para una petición `MÉTODO /ruta`, o `null` para quitarlo. */
  setFault(route: string, fault: ProxyFault | null): void;
  /** Cuántas peticiones `MÉTODO /ruta` han llegado al proxy. */
  count(route: string): number;
  close(): Promise<void>;
}

/** Proxy HTTP entre la web y la API para simular respuestas que no llegan (criterios 60 a 65). */
export async function startApiProxy(): Promise<ApiProxy> {
  let target = '';
  const faults = new Map<string, ProxyFault>();
  const counts = new Map<string, number>();
  const sockets = new Set<Socket>();

  const forward = (req: IncomingMessage, body: Buffer): Promise<IncomingMessage> =>
    new Promise((resolveResponse, reject) => {
      const upstream = request(new URL(req.url ?? '/', target), {
        method: req.method,
        headers: { ...req.headers, host: new URL(target).host },
      });
      upstream.once('response', resolveResponse);
      upstream.once('error', reject);
      upstream.end(body);
    });

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const route = `${req.method} ${new URL(req.url ?? '/', 'http://proxy').pathname}`;
    counts.set(route, (counts.get(route) ?? 0) + 1);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const fault = faults.get(route);
    if (fault === 'hang') return;

    const upstream = await forward(req, Buffer.concat(chunks));
    if (fault === 'cut') {
      upstream.resume();
      upstream.once('end', () => req.socket.destroy());
      return;
    }
    res.writeHead(upstream.statusCode ?? 502, upstream.headers);
    upstream.pipe(res);
  };

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(502).end();
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    setTarget: (url) => {
      target = url;
    },
    setFault: (route, fault) => {
      if (fault) faults.set(route, fault);
      else faults.delete(route);
    },
    count: (route) => counts.get(route) ?? 0,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((done) => server.close(done));
    },
  };
}
