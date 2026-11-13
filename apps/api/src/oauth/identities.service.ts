import { Inject, Injectable, Module } from '@nestjs/common';
import { OAUTH_PROVIDERS, type OAuthProvider } from '@cupidilla/contracts';
import { and, asc, eq } from 'drizzle-orm';
import { Clock } from '../common/clock.js';
import { DB, type Database, type Executor } from '../database/database.types.js';
import { identities } from '../database/schema/index.js';

export type IdentityRow = typeof identities.$inferSelect;

export interface NewIdentity {
  userId: string;
  provider: OAuthProvider;
  subject: string;
  providerEmail: string | null;
  emailVerified: boolean;
}

/** Identidades de proveedor unidas a una cuenta (§5.2). */
@Injectable()
export class IdentitiesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  async findByProviderSubject(
    provider: OAuthProvider,
    subject: string,
  ): Promise<IdentityRow | undefined> {
    const [row] = await this.db
      .select()
      .from(identities)
      .where(and(eq(identities.provider, provider), eq(identities.subject, subject)))
      .limit(1);
    return row;
  }

  /** Inserta sin consulta previa: las UNIQUE deciden (`identities_*_unique`). */
  async create(db: Executor, identity: NewIdentity): Promise<void> {
    const now = this.clock.now();
    await db.insert(identities).values({ ...identity, createdAt: now, lastUsedAt: now });
  }

  /** Entrada con una identidad ya unida: guarda el último correo del proveedor (T10). */
  async touch(
    id: string,
    data: { providerEmail: string | null; emailVerified: boolean },
  ): Promise<void> {
    await this.db
      .update(identities)
      .set({ ...data, lastUsedAt: this.clock.now() })
      .where(eq(identities.id, id));
  }

  async listForUser(userId: string): Promise<{ provider: OAuthProvider; linkedAt: Date }[]> {
    const rows = await this.db
      .select({ provider: identities.provider, linkedAt: identities.createdAt })
      .from(identities)
      .where(eq(identities.userId, userId))
      .orderBy(asc(identities.createdAt));
    // Siempre en el orden de OAUTH_PROVIDERS, que es el de la interfaz.
    return rows.sort(
      (a, b) => OAUTH_PROVIDERS.indexOf(a.provider) - OAUTH_PROVIDERS.indexOf(b.provider),
    );
  }
}

/** Módulo propio para que lo usen `UsersModule` y `OAuthModule` sin dependencia circular. */
@Module({ providers: [IdentitiesService], exports: [IdentitiesService] })
export class IdentitiesModule {}
