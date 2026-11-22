import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { emailOutbox } from '../src/database/schema/index.js';
import { OutboxService, type AccountMailKind } from '../src/mail/outbox.service.js';
import { OutboxWorker } from '../src/mail/outbox.worker.js';
import { ANA, BETO, inbox, seedAna, seedBeto } from './helpers/mail.js';
import {
  countRows,
  createTestApp,
  TEST_NOW,
  truncateAll,
  type TestApp,
} from './helpers/test-app.js';

/**
 * Una fila reclamada que se cancela antes de resolverse (un restablecimiento o una verificación
 * borran los correos pendientes, §5.4 y §5.6) no puede emitir un token ni enviarse.
 */
describe('worker: cancelación de una fila ya reclamada', () => {
  let t: TestApp;
  let worker: OutboxWorker;

  beforeAll(async () => {
    t = await createTestApp();
    worker = t.app.get(OutboxWorker);
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await truncateAll(t.db);
    inbox(t.app).clear();
    t.clock.set(TEST_NOW);
    vi.restoreAllMocks();
  });

  /** Reclama de verdad y, justo después, borra la fila como lo haría la cancelación. */
  function cancelAfterClaim(): void {
    const internals = worker as unknown as { claim(): Promise<unknown[]> };
    const claim = internals.claim.bind(worker);
    vi.spyOn(internals, 'claim').mockImplementationOnce(async () => {
      const rows = await claim();
      await t.db.delete(emailOutbox);
      return rows;
    });
  }

  it.each<[AccountMailKind, string]>([
    ['reset_password', ANA],
    ['verify_email', BETO],
    ['verify_reminder', BETO],
  ])('%s: borrada tras el reclamo, no se envía y no queda ningún token', async (kind, email) => {
    await seedAna(t.db);
    await seedBeto(t.db);
    await t.app.get(OutboxService).enqueue(t.db, kind, email);
    cancelAfterClaim();

    expect(await worker.drain()).toMatchObject({ sent: 0, skipped: 1 });
    expect(inbox(t.app).messages).toEqual([]);
    expect(await countRows(t.db, 'email_tokens')).toBe(0);
    expect(await t.db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, email))).toEqual([]);
  });

  it('sin cancelación, la misma fila se envía con su token (control)', async () => {
    await seedAna(t.db);
    await t.app.get(OutboxService).enqueue(t.db, 'reset_password', ANA);
    expect(await worker.drain()).toMatchObject({ sent: 1 });
    expect(await countRows(t.db, 'email_tokens')).toBe(1);
  });
});
