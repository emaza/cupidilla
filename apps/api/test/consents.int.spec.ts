import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConsentsService } from '../src/consents/consents.service.js';
import { isUniqueViolation } from '../src/database/pg-errors.js';
import { Transactions } from '../src/database/transactions.js';
import {
  createTestApp,
  registerUser,
  TEST_NOW,
  truncateAll,
  type TestApp,
} from './helpers/test-app.js';

describe('ConsentsService (I-18)', () => {
  let t: TestApp;
  let service: ConsentsService;

  beforeAll(async () => {
    t = await createTestApp();
    service = t.app.get(ConsentsService);
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await truncateAll(t.db);
    t.clock.set(TEST_NOW);
  });

  it('impide dos consentimientos activos de la misma finalidad', async () => {
    const user = await registerUser(t.app);
    const error: unknown = await service
      .grant(t.db, user.userId, 'service_use', '2026-11-borrador')
      .catch((caught: unknown) => caught);
    expect(isUniqueViolation(error, 'consents_one_active_per_purpose')).toBe(true);
  });

  it('revocar y volver a conceder conserva el histórico', async () => {
    const user = await registerUser(t.app);
    t.clock.advanceDays(1);
    await t.app.get(Transactions).run(async (tx) => {
      await service.revoke(tx, user.userId, 'service_use');
      await service.grant(tx, user.userId, 'service_use', '2026-12-nueva');
    });
    const history = await service.listForUser(user.userId);
    expect(history).toEqual([
      {
        purpose: 'service_use',
        policyVersion: '2026-11-borrador',
        grantedAt: TEST_NOW,
        revokedAt: t.clock.now().toISOString(),
      },
      {
        purpose: 'service_use',
        policyVersion: '2026-12-nueva',
        grantedAt: t.clock.now().toISOString(),
        revokedAt: null,
      },
    ]);
  });

  it('la base de datos rechaza una finalidad desconocida', async () => {
    const user = await registerUser(t.app);
    const error: unknown = await t.db
      .execute(
        sql`insert into consents (user_id, purpose, policy_version) values (${user.userId}, 'otra', 'v1')`,
      )
      .catch((caught: unknown) => caught);
    const cause = (error as { cause?: { code?: string; constraint?: string } }).cause;
    expect(cause?.code).toBe('23514');
    expect(cause?.constraint).toBe('consents_purpose_known');
  });
});
