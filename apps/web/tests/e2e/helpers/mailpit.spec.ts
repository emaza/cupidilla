import { createServer, type AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { assertMailpitUp } from './mailpit.ts';

/** Un puerto en el que no escucha nadie. */
function closedPort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolvePort(port));
    });
  });
}

describe('assertMailpitUp', () => {
  it('A6-1: sin Mailpit, el globalSetup falla con «levanta Mailpit: npm run mail:up»', async () => {
    const port = await closedPort();
    await expect(assertMailpitUp(`http://127.0.0.1:${port}`)).rejects.toThrow(
      'levanta Mailpit: npm run mail:up',
    );
  });
});
