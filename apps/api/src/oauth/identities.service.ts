import { Inject, Injectable, Logger, Module } from '@nestjs/common';
import { OAUTH_PROVIDERS, type OAuthProvider } from '@cupidilla/contracts';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { ApiException } from '../common/errors/api.exception.js';
import { Clock } from '../common/clock.js';
import { DB, type Database, type Tx } from '../database/database.types.js';
import { lockEmail, normalizeEmail } from '../database/email-lock.js';
import { identities, users } from '../database/schema/index.js';
import { Transactions } from '../database/transactions.js';

export type IdentityRow = typeof identities.$inferSelect;

/**
 * `provider_email` igual a este correo, en minúsculas y sin espacios. Usa el índice
 * `identities_provider_email_normalized_idx`, que tiene la misma expresión.
 */
export const providerEmailIs = (email: string) =>
  eq(sql`lower(btrim(${identities.providerEmail}))`, normalizeEmail(email));

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

  /**
   * Cuenta dueña de la identidad cuyo `provider_email` verificado es este correo (R7b),
   * comparando en minúsculas y sin espacios. Si hay varias, la de la identidad usada más
   * recientemente. Una fila no verificada (dato antiguo) no cuenta (decisión 21).
   */
  async findUserIdByProviderEmail(email: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ userId: identities.userId })
      .from(identities)
      .where(and(providerEmailIs(email), eq(identities.emailVerified, true)))
      .orderBy(desc(identities.lastUsedAt))
      .limit(1);
    return row?.userId;
  }

  /**
   * Inserta sin consulta previa: las UNIQUE deciden (`identities_*_unique`). Toma antes el
   * bloqueo del correo del proveedor (`lockEmail`) para no cruzarse con un alta con contraseña de
   * ese correo (R7), así que va dentro de una transacción.
   */
  async create(tx: Tx, identity: NewIdentity): Promise<void> {
    if (identity.providerEmail !== null) await lockEmail(tx, identity.providerEmail);
    const now = this.clock.now();
    await tx.insert(identities).values({ ...identity, createdAt: now, lastUsedAt: now });
  }

  /**
   * Añadir un proveedor desde /account (§9.3, decisión 21). El correo, ya verificado, no puede
   * ser el `users.email` de otra cuenta ni el `provider_email` verificado de una identidad de otra
   * cuenta: entonces no se une nada. Comprobación e inserción van en una transacción con el
   * bloqueo del correo, así que un alta simultánea con ese correo va antes o después, nunca a la
   * vez. Las violaciones UNIQUE de `create` llegan tal cual a quien llama.
   */
  async createForConnect(
    userId: string,
    identity: {
      provider: OAuthProvider;
      subject: string;
      providerEmail: string;
      emailVerified: true;
    },
  ): Promise<'created' | 'email_in_other_account'> {
    return this.transactions.run(async (tx) => {
      await lockEmail(tx, identity.providerEmail);
      const [account] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, normalizeEmail(identity.providerEmail)), ne(users.id, userId)))
        .limit(1);
      if (account) return 'email_in_other_account';
      const [other] = await tx
        .select({ id: identities.id })
        .from(identities)
        .where(
          and(
            providerEmailIs(identity.providerEmail),
            eq(identities.emailVerified, true),
            ne(identities.userId, userId),
          ),
        )
        .limit(1);
      if (other) return 'email_in_other_account';
      // `create` vuelve a tomar el bloqueo: en la misma transacción no espera a nadie.
      await this.create(tx, { userId, ...identity });
      return 'created';
    });
  }

  /**
   * Entrada con una identidad ya unida: guarda el último correo del proveedor (T10), con el mismo
   * bloqueo del correo que `create`.
   */
  async touch(
    id: string,
    data: { providerEmail: string | null; emailVerified: boolean },
  ): Promise<void> {
    await this.transactions.run(async (tx) => {
      if (data.providerEmail !== null) await lockEmail(tx, data.providerEmail);
      await tx
        .update(identities)
        .set({ ...data, lastUsedAt: this.clock.now() })
        .where(eq(identities.id, id));
    });
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
