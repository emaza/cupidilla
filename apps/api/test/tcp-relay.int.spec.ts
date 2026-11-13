import { connect, createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTcpRelay, type TcpRelay } from './helpers/tcp-relay.js';

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

describe('helper tcp-relay', () => {
  let target: Server;
  const received: string[] = [];
  const sockets = new Set<Socket>();
  let relay: TcpRelay;

  beforeAll(async () => {
    target = createServer((socket) => {
      sockets.add(socket);
      socket.on('data', (chunk) => received.push(chunk.toString()));
    });
    await new Promise<void>((done) => target.listen(0, '127.0.0.1', done));
    const { port } = target.address() as AddressInfo;
    relay = await startTcpRelay(`postgres://u:p@127.0.0.1:${port}/x`);
  });
  afterAll(async () => {
    for (const socket of sockets) socket.destroy();
    await relay.close();
    await new Promise((done) => target.close(done));
  });

  async function send(parts: string[]): Promise<Socket> {
    const { port } = new URL(relay.url);
    const client = connect(Number(port), '127.0.0.1');
    await new Promise((done) => client.once('connect', done));
    for (const part of parts) {
      client.write(part);
      await pause(50); // trozos TCP separados
    }
    return client;
  }

  it('detecta el patrón aunque llegue partido entre dos trozos', async () => {
    received.length = 0;
    relay.arm('commit', 'drop');
    const client = await send(['select 1; com', 'mit;', 'select 2;']);
    expect(relay.fired).toBe(true);
    // Lo anterior al trozo que completa el patrón pasó; ese trozo y lo siguiente, no.
    expect(received.join('')).toBe('select 1; com');
    client.destroy();
  });

  it('disarm quita el patrón y el resto de trozos guardado', async () => {
    received.length = 0;
    relay.arm('commit', 'drop');
    const client = await send(['com']);
    relay.disarm();
    relay.arm('rollback', 'drop');
    client.write('mit;');
    await pause(50);
    expect(relay.fired).toBe(false);
    expect(received.join('')).toBe('commit;');
    client.destroy();
  });
});
