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
  /** Quita el patrón armado sin dispararlo. */
  disarm(): void;
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
  /** Final del trozo anterior de cada conexión: el patrón puede llegar partido entre dos. */
  const tails = new Map<Socket, Buffer>();
  const disarm = (): void => {
    armed = null;
    tails.clear();
  };

  const server: Server = createServer((client) => {
    const upstream = createConnection({ host: target.hostname, port: Number(target.port) });
    let frozen = false;
    sockets.add(client).add(upstream);
    client.on('data', (chunk: Buffer) => {
      if (frozen) return;
      if (armed) {
        const pattern = Buffer.from(armed.pattern);
        const tail = tails.get(client) ?? Buffer.alloc(0);
        const joined = Buffer.concat([tail, chunk]);
        const matched = joined.includes(pattern);
        tails.set(client, joined.subarray(Math.max(0, joined.length - (pattern.length - 1))));
        if (!matched) {
          upstream.write(chunk);
          return;
        }
        const { mode } = armed;
        disarm();
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
      socket.on('close', () => {
        sockets.delete(socket);
        tails.delete(socket);
      });
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
      disarm();
      armed = { pattern, mode };
      fired = false;
    },
    disarm,
    get fired() {
      return fired;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((done) => server.close(done));
    },
  };
}
