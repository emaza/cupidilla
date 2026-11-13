import { Inject, Injectable } from '@nestjs/common';
import type { Consent, ConsentPurpose } from '@cupidilla/contracts';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { Clock } from '../common/clock.js';
import { DB, type Database, type Executor } from '../database/database.types.js';
import { consents } from '../database/schema/index.js';

@Injectable()
export class ConsentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  /** Registra un consentimiento activo con la fecha del `Clock` y la versión aceptada. */
  async grant(
    db: Executor,
    userId: string,
    purpose: ConsentPurpose,
    policyVersion: string,
  ): Promise<void> {
    await db
      .insert(consents)
      .values({ userId, purpose, policyVersion, grantedAt: this.clock.now() });
  }

  /** Revoca el consentimiento activo de esa finalidad. La fila se conserva como histórico. */
  async revoke(db: Executor, userId: string, purpose: ConsentPurpose): Promise<void> {
    await db
      .update(consents)
      .set({ revokedAt: this.clock.now() })
      .where(
        and(eq(consents.userId, userId), eq(consents.purpose, purpose), isNull(consents.revokedAt)),
      );
  }

  async listForUser(userId: string): Promise<Consent[]> {
    const rows = await this.db
      .select()
      .from(consents)
      .where(eq(consents.userId, userId))
      .orderBy(asc(consents.grantedAt));
    return rows.map((row) => ({
      purpose: row.purpose,
      policyVersion: row.policyVersion,
      grantedAt: row.grantedAt.toISOString(),
      revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    }));
  }
}
