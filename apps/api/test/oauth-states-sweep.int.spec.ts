import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OAuthFlowService } from '../src/oauth/oauth-flow.service.js';
import {
  countRows,
  createTestApp,
  TEST_NOW,
  truncateAll,
  type TestApp,
} from './helpers/test-app.js';

/** Limpieza periódica de `oauth_states` caducadas (sin timers: se llama al método con el reloj falso). */
describe('Limpieza de oauth_states caducadas', () => {
  let t: TestApp;
  let flow: OAuthFlowService;

  beforeAll(async () => {
    t = await createTestApp();
    flow = t.app.get(OAuthFlowService);
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await truncateAll(t.db);
    t.clock.set(TEST_NOW);
  });

  const insert = (hash: string, expiresAt: string) => sql`
    insert into oauth_states (token_hash, provider, purpose, entry_point, state, code_verifier,
      nonce, created_at, expires_at)
    values (${hash}, 'google', 'sign_in', 'login', 's', 'v', 'n', ${TEST_NOW}, ${expiresAt})`;

  it('borra las caducadas según el Clock y conserva las vigentes', async () => {
    await t.db.execute(insert('a'.repeat(64), '2026-11-11T10:05:00.000Z'));
    await t.db.execute(insert('b'.repeat(64), '2026-11-11T10:20:00.000Z'));

    await flow.sweepExpiredStates();
    expect(await countRows(t.db, 'oauth_states')).toBe(2);

    t.clock.set('2026-11-11T10:10:00.000Z');
    await flow.sweepExpiredStates();
    expect(await countRows(t.db, 'oauth_states')).toBe(1);

    t.clock.set('2026-11-11T10:30:00.000Z');
    await flow.sweepExpiredStates();
    expect(await countRows(t.db, 'oauth_states')).toBe(0);
  });

  it('no arranca ningún timer con NODE_ENV=test y onModuleDestroy es inocuo', () => {
    expect(flow['sweepTimer']).toBeUndefined();
    expect(() => flow.onModuleDestroy()).not.toThrow();
  });
});
