import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthResponse, PasswordResetRequest } from '@cupidilla/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import { Clock } from '../common/clock.js';
import { ApiException } from '../common/errors/api.exception.js';
import type { Env } from '../config/env.schema.js';
import { DB, type Database } from '../database/database.types.js';
import { emailOutbox, users } from '../database/schema/index.js';
import { Transactions } from '../database/transactions.js';
import { EmailTokensService } from '../mail/email-tokens.service.js';
import { OutboxService } from '../mail/outbox.service.js';
import { PasswordService } from '../users/password.service.js';
import { toPublicUser, UsersService } from '../users/users.service.js';
import { SessionsService } from './sessions.service.js';

/** Enlace inexistente, caducado, usado, de otro propósito o de un correo que ya no es el de la cuenta. */
const tokenInvalid = (): ApiException =>
  new ApiException('TOKEN_INVALID_OR_EXPIRED', 400, undefined, 'Token invalid or expired');

/**
 * Recuperación de la contraseña (correo §5.5, §5.6): pedir el enlace y fijar con él la contraseña
 * (o crearla, si la cuenta solo tenía proveedor). Restablecer verifica el correo, cierra todas las
 * sesiones de la cuenta y abre una nueva.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly passwordChangedNotice: boolean;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly clock: Clock,
    private readonly transactions: Transactions,
    private readonly tokens: EmailTokensService,
    private readonly outbox: OutboxService,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionsService,
    config: ConfigService<Env, true>,
  ) {
    this.passwordChangedNotice = config.get('EMAIL_PASSWORD_CHANGED_NOTICE', { infer: true });
  }

  /**
   * POST /auth/password-reset/request (correo §5.2, §5.5): encola y nada más. No consulta `users`,
   * así que la petición hace lo mismo exista o no la cuenta; el *worker* decide después si hay a
   * quién enviar (decisión 6: sin cuenta, nada).
   */
  async request(email: string): Promise<void> {
    await this.outbox.enqueue(this.db, 'reset_password', email);
    this.outbox.kick();
  }

  /** POST /auth/password-reset (correo §5.6). */
  async reset(request: PasswordResetRequest): Promise<AuthResponse> {
    // Sin escribir nada: un enlace que no sirve no gasta un argon2. Da la cuenta del enlace, para
    // bloquear su fila antes de consumirlo (el mismo orden que la confirmación y el borrado de §6.3).
    const live = await this.tokens.findLiveForAccount(this.db, request.token, 'reset_password');
    if (!live) throw tokenInvalid();
    // argon2 fuera de la transacción: no la alarga.
    const passwordHash = await this.passwords.hash(request.password);

    const result = await this.transactions.run(async (tx) => {
      // FOR UPDATE: un login que ya verificó la contraseña vieja espera aquí y, tras el COMMIT, no
      // encuentra su hash (K10, §5.7). Con el correo del enlace: si cambió, el enlace no vale.
      const [account] = await tx
        .select()
        .from(users)
        .where(and(eq(users.id, live.user.id), eq(users.email, live.token.email)))
        .for('update');
      if (!account) throw tokenInvalid();
      if (!(await this.tokens.consume(tx, request.token, 'reset_password'))) throw tokenInvalid();

      const wasUnverified = account.emailVerifiedAt === null;
      const now = this.clock.now();
      // Abrir el enlace demuestra que el correo es suyo. Antes que la marca de revisión, que exige
      // el correo verificado (`users_review_requires_verified`).
      await this.users.markEmailVerified(tx, account.id, account.email);
      const [updated] = await tx
        .update(users)
        .set({
          passwordHash,
          updatedAt: now,
          // Quien recupera una cuenta sin verificar revisa los datos que escribió quien la creó (§5.11).
          ...(wasUnverified ? { dataReviewRequiredAt: now } : {}),
        })
        .where(eq(users.id, account.id))
        .returning();
      if (!updated) throw tokenInvalid();
      // Un correo de recuperación atrasado traería otro enlace válido.
      await tx
        .delete(emailOutbox)
        .where(
          and(
            eq(emailOutbox.toEmail, account.email),
            eq(emailOutbox.kind, 'reset_password'),
            isNull(emailOutbox.failedAt),
          ),
        );
      // Todas las sesiones, y en cascada sus reautenticaciones y uniones a medias.
      await this.sessions.revokeAllForUser(tx, account.id);
      const session = await this.sessions.create(tx, account.id);
      // En esta misma transacción: llega aunque no se termine la revisión de datos (UX §10.1).
      if (this.passwordChangedNotice) {
        await this.outbox.enqueue(tx, 'password_changed', account.email);
      }
      return { user: updated, session, wasUnverified };
    });
    this.outbox.kick();
    if (result.wasUnverified) {
      this.logger.log({ event: 'email_verified', method: 'password_reset' });
    }
    this.logger.log({ event: 'password_reset_completed', wasUnverified: result.wasUnverified });
    return {
      user: toPublicUser(result.user),
      session: {
        token: result.session.token,
        expiresAt: result.session.expiresAt.toISOString(),
      },
    };
  }
}
