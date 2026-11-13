import {
  createConnection,
  createServer,
  type AddressInfo,
  type Server,
  type Socket,
} from 'node:net';

/** Qué hacer con el mensaje del cliente que contiene el patrón armado. */
export type FreezeMode =
  /** No lo reenvía y deja muda esa conexión: el servidor nunca lo ve. */
  | 'drop'
  /** Lo reenvía y después deja muda esa conexión: el servidor lo ejecuta y su respuesta se pierde. */
  | 'after';

export interface TcpRelay {
  /** URL de conexión igual a `databaseUrl`, pero a través del relé. */
  url: string;
  /**
   * La próxima vez que un cliente envíe un mensaje que contenga `pattern`, esa conexión deja de
   * pasar bytes en los dos sentidos, sin cerrarse (como un cortafuegos que descarta paquetes).
   * Las demás conexiones siguen funcionando. Es de un solo uso.
   */
  arm(pattern: string, mode: FreezeMode): void;
  /** ¿Se ha disparado el último `arm`? */
  readonly fired: boolean;
  close(): Promise<void>;
}

/** Relé TCP hacia PostgreSQL para simular una red que deja de responder a mitad de una consulta. */
export async function startTcpRelay(databaseUrl: string): Promise<TcpRelay> {
  const target = new URL(databaseUrl);
  const sockets = new Set<Socket>();
  let armed: { pattern: string; mode: FreezeMode } | null = null;
  let fired = false;

  const server: Server = createServer((client) => {
    const upstream = createConnection({ host: target.hostname, port: Number(target.port) });
    let frozen = false;
    sockets.add(client).add(upstream);
    client.on('data', (chunk: Buffer) => {
      if (frozen) return;
      if (armed && chunk.includes(armed.pattern)) {
        const { mode } = armed;
        armed = null;
        fired = true;
        frozen = true;
        if (mode === 'after') upstream.write(chunk);
        return;
      }
      upstream.write(chunk);
    });
    upstream.on('data', (chunk: Buffer) => {
      if (!frozen) client.write(chunk);
    });
    for (const socket of [client, upstream]) {
      socket.on('error', () => undefined);
      socket.on('close', () => sockets.delete(socket));
    }
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const through = new URL(target);
  through.hostname = '127.0.0.1';
  through.port = String((server.address() as AddressInfo).port);

  return {
    url: through.toString(),
    arm(pattern, mode) {
      armed = { pattern, mode };
      fired = false;
    },
    get fired() {
      return fired;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((done) => server.close(done));
    },
  };
}
