import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  checkBirthDate,
  OAUTH_PENDING_TTL_MINUTES,
  referenceToday,
  SERVICE_TERMS_VERSION,
  type OAuthAuthResponse,
  type OAuthEntryPoint,
  type OAuthProvider,
  type OAuthSignupRequest,
  type PendingIdentityResponse,
  type PendingToken,
} from '@cupidilla/contracts';
import { and, eq, gt, lte } from 'drizzle-orm';
import { SessionsService } from '../auth/sessions.service.js';
import { Clock } from '../common/clock.js';
import {
  generateOpaqueToken,
  hashOpaqueToken,
  OPAQUE_TOKEN_PATTERN,
} from '../common/crypto/opaque-token.js';
import { ApiException } from '../common/errors/api.exception.js';
import { ConsentsService } from '../consents/consents.service.js';
import { DB, type Database } from '../database/database.types.js';
import { isUniqueViolation } from '../database/pg-errors.js';
import { pendingIdentities, users } from '../database/schema/index.js';
import { Transactions } from '../database/transactions.js';
import { UsersService } from '../users/users.service.js';
import { IdentitiesService } from './identities.service.js';

const MINUTE_MS = 60_000;

export type PendingRow = typeof pendingIdentities.$inferSelect;

export interface NewPending {
  kind: 'signup' | 'link';
  provider: OAuthProvider;
  subject: string;
  providerEmail: string;
  emailVerified: boolean;
  userId: string | null;
  entryPoint: OAuthEntryPoint;
  returnPath: string | null;
}

/** Error único de todo estado pendiente inexistente, caducado, ya usado o ajeno (§6). */
export const flowInvalid = (): ApiException =>
  new ApiException('OAUTH_FLOW_INVALID', 400, undefined, 'OAuth flow invalid or expired');

/** Hash del token pendiente; un token con otro formato no puede existir. */
export function pendingTokenHash(token: string | undefined): string {
  if (!token || !OPAQUE_TOKEN_PATTERN.test(token)) throw flowInvalid();
  return hashOpaqueToken(token);
}

/** Alta y unión pendientes tras volver del proveedor (§7, §8): un solo uso y 30 minutos. */
@Injectable()
export class PendingIdentitiesService {
  private readonly logger = new Logger(PendingIdentitiesService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly clock: Clock,
    private readonly transactions: Transactions,
    private readonly users: UsersService,
    private readonly identities: IdentitiesService,
    private readonly consents: ConsentsService,
    private readonly sessions: SessionsService,
  ) {}

  /** Borra las filas caducadas (limpieza sin tareas programadas, §4). */
  async deleteExpired(): Promise<void> {
    await this.db
      .delete(pendingIdentities)
      .where(lte(pendingIdentities.expiresAt, this.clock.now()));
  }

  async create(data: NewPending): Promise<PendingToken> {
    await this.deleteExpired();
    const token = generateOpaqueToken();
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + OAUTH_PENDING_TTL_MINUTES * MINUTE_MS);
    await this.db.insert(pendingIdentities).values({
      ...data,
      tokenHash: hashOpaqueToken(token),
      createdAt: now,
      expiresAt,
    });
    return { token, expiresAt: expiresAt.toISOString() };
  }

  /** GET /auth/oauth/pending: lo que necesitan /register/complete y /login/link. */
  async lookup(token: string | undefined): Promise<PendingIdentityResponse> {
    const tokenHash = pendingTokenHash(token);
    const [row] = await this.db
      .select({ pending: pendingIdentities, accountEmail: users.email })
      .from(pendingIdentities)
      .leftJoin(users, eq(users.id, pendingIdentities.userId))
      .where(
        and(
          eq(pendingIdentities.tokenHash, tokenHash),
          gt(pendingIdentities.expiresAt, this.clock.now()),
        ),
      )
      .limit(1);
    if (!row) throw flowInvalid();
    const { pending, accountEmail } = row;
    return {
      kind: pending.kind,
      provider: pending.provider,
      // En una unión, el correo de la cuenta (es el mismo que el del proveedor, normalizado).
      email:
        pending.kind === 'link' ? (accountEmail ?? pending.providerEmail) : pending.providerEmail,
      entryPoint: pending.entryPoint,
      expiresAt: pending.expiresAt.toISOString(),
    };
  }

  /** POST /auth/oauth/pending/cancellation: siempre 204, exista o no (idempotente). */
  async cancel(token: string): Promise<void> {
    await this.db
      .delete(pendingIdentities)
      .where(eq(pendingIdentities.tokenHash, hashOpaqueToken(token)));
  }

  /** POST /auth/oauth/signup, en el orden de H0 §8.5 (§7). */
  async signup(request: OAuthSignupRequest): Promise<OAuthAuthResponse> {
    const tokenHash = hashOpaqueToken(request.pendingToken);

    // La fecha va antes de leer nada. Con un menor se borra en el acto lo recibido del proveedor.
    const check = checkBirthDate(request.birthDate, referenceToday(this.clock.now()));
    if (!check.ok && check.reason === 'IN_FUTURE') {
      throw new ApiException(
        'VALIDATION_FAILED',
        400,
        [{ path: 'birthDate', issue: 'in_future' }],
        'Request validation failed',
      );
    }
    if (!check.ok) {
      await this.db.delete(pendingIdentities).where(eq(pendingIdentities.tokenHash, tokenHash));
      throw new ApiException('UNDERAGE', 422, undefined, 'Minimum age not reached');
    }
    if (request.termsVersion !== SERVICE_TERMS_VERSION) {
      throw new ApiException('TERMS_VERSION_OUTDATED', 409, undefined, 'Terms version outdated');
    }

    try {
      const result = await this.transactions.run(async (tx) => {
        const [pending] = await tx
          .delete(pendingIdentities)
          .where(
            and(
              eq(pendingIdentities.tokenHash, tokenHash),
              eq(pendingIdentities.kind, 'signup'),
              gt(pendingIdentities.expiresAt, this.clock.now()),
            ),
          )
          .returning();
        if (!pending) throw flowInvalid();
        const user = await this.users.create(tx, {
          email: pending.providerEmail,
          passwordHash: null,
          birthDate: request.birthDate,
        });
        await this.identities.create(tx, {
          userId: user.id,
          provider: pending.provider,
          subject: pending.subject,
          providerEmail: pending.providerEmail,
          emailVerified: pending.emailVerified,
        });
        await this.consents.grant(tx, user.id, 'service_use', request.termsVersion);
        const session = await this.sessions.create(tx, user.id);
        return { user, session, returnPath: pending.returnPath };
      });
      this.logger.log({ event: 'oauth_signup_completed' });
      return {
        user: result.user,
        session: { token: result.session.token, expiresAt: result.session.expiresAt.toISOString() },
        returnPath: result.returnPath,
      };
    } catch (error) {
      throw await this.resolveSignupConflict(tokenHash, error);
    }
  }

  /**
   * Carreras del alta (§7, punto 5). La transacción ya se deshizo, así que la fila pendiente
   * sigue ahí:
   * - otra persona creó la cuenta con ese correo: si tiene contraseña, la fila pasa a unión y
   *   409 `EMAIL_TAKEN`; si no, se borra y 409 `ACCOUNT_USES_OTHER_PROVIDER`;
   * - la identidad ya se unió desde otra pestaña (o con dos altas simultáneas del mismo
   *   `subject`, choca antes el correo): se borra y `OAUTH_FLOW_INVALID`.
   */
  private async resolveSignupConflict(tokenHash: string, error: unknown): Promise<unknown> {
    const deleteRow = () =>
      this.db.delete(pendingIdentities).where(eq(pendingIdentities.tokenHash, tokenHash));

    if (error instanceof ApiException && error.code === 'EMAIL_TAKEN') {
      const [pending] = await this.db
        .select()
        .from(pendingIdentities)
        .where(eq(pendingIdentities.tokenHash, tokenHash))
        .limit(1);
      const account = pending
        ? await this.users.findCredentialsByEmail(pending.providerEmail)
        : undefined;
      if (account && account.passwordHash !== null) {
        await this.db
          .update(pendingIdentities)
          .set({ kind: 'link', userId: account.user.id })
          .where(eq(pendingIdentities.tokenHash, tokenHash));
        return error;
      }
      await deleteRow();
      // La cuenta sin contraseña es esta misma identidad, creada desde otra pestaña: el estado
      // ya se usó (T4). Es «caducado», no «entra con otro proveedor».
      if (
        pending &&
        (await this.identities.findByProviderSubject(pending.provider, pending.subject))
      ) {
        return flowInvalid();
      }
      return new ApiException(
        'ACCOUNT_USES_OTHER_PROVIDER',
        409,
        undefined,
        'Account uses another provider',
      );
    }
    if (isUniqueViolation(error, 'identities_provider_subject_unique')) {
      await deleteRow();
      return flowInvalid();
    }
    return error;
  }
}
