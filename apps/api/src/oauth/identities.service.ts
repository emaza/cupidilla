import { Inject, Injectable, Logger, Module } from '@nestjs/common';
import { OAUTH_PROVIDERS, type OAuthProvider } from '@cupidilla/contracts';
import { and, asc, eq } from 'drizzle-orm';
import { ApiException } from '../common/errors/api.exception.js';
import { Clock } from '../common/clock.js';
import { DB, type Database, type Executor } from '../database/database.types.js';
import { identities, users } from '../database/schema/index.js';
import { Transactions } from '../database/transactions.js';

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
  private readonly logger = new Logger(IdentitiesService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly clock: Clock,
    private readonly transactions: Transactions,
  ) {}

  /**
   * Quita un proveedor (§9.4). Bloquea la fila de `users` (`FOR UPDATE`) para que dos peticiones
   * a la vez no quiten las dos últimas formas de entrar (T9). No cierra sesiones ni revoca nada
   * en el proveedor: no se guarda ningún token.
   */
  async remove(userId: string, provider: OAuthProvider): Promise<void> {
    await this.transactions.run(async (tx) => {
      const [account] = await tx
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, userId))
        .for('update');
      if (!account) throw new ApiException('UNAUTHENTICATED', 401);
      const linked = await tx
        .select({ provider: identities.provider })
        .from(identities)
        .where(eq(identities.userId, userId));
      if (!linked.some((row) => row.provider === provider)) {
        throw new ApiException('NOT_FOUND', 404, undefined, 'Provider not linked');
      }
      if (account.passwordHash === null && linked.length <= 1) {
        throw new ApiException('LAST_SIGN_IN_METHOD', 409, undefined, 'Last sign-in method');
      }
      await tx
        .delete(identities)
        .where(and(eq(identities.userId, userId), eq(identities.provider, provider)));
    });
    this.logger.log({ event: 'identity_removed', provider });
  }

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

  async listRowsForUser(userId: string): Promise<IdentityRow[]> {
    return this.db.select().from(identities).where(eq(identities.userId, userId));
  }

  async listForUser(
    userId: string,
  ): Promise<{ provider: OAuthProvider; linkedAt: Date; lastUsedAt: Date }[]> {
    const rows = await this.db
      .select({
        provider: identities.provider,
        linkedAt: identities.createdAt,
        lastUsedAt: identities.lastUsedAt,
      })
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
