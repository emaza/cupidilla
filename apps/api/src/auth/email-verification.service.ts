import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  EMAIL_TOKEN_MAX_FAILURES,
  type EmailTokenInspectionRequest,
  type EmailTokenInspectionResponse,
  type EmailVerificationRequest,
  type EmailVerificationResponse,
} from '@cupidilla/contracts';
import { hashOpaqueToken, OPAQUE_TOKEN_PATTERN } from '../common/crypto/opaque-token.js';
import type { ActiveSession } from '../common/decorators/current-session.decorator.js';
import { ApiException } from '../common/errors/api.exception.js';
import { DB, type Database } from '../database/database.types.js';
import { Transactions } from '../database/transactions.js';
import { EmailTokensService, emailHint } from '../mail/email-tokens.service.js';
import { OutboxService } from '../mail/outbox.service.js';
import { PasswordService } from '../users/password.service.js';
import { toPublicUser, UsersService } from '../users/users.service.js';
import { SessionsService } from './sessions.service.js';

/** Enlace inexistente, caducado, usado, de otro propósito o de un correo que ya no es el de la cuenta. */
const tokenInvalid = (): ApiException =>
  new ApiException('TOKEN_INVALID_OR_EXPIRED', 400, undefined, 'Token invalid or expired');

const passwordIncorrect = (): ApiException =>
  new ApiException('PASSWORD_INCORRECT', 403, undefined, 'Password does not match');

/**
 * Verificación del correo (correo §5.3, §5.4): pedir el enlace, comprobarlo sin consumirlo y
 * confirmarlo. Un enlace nunca es un inicio de sesión de un clic: sin la sesión de esa cuenta se
 * pide su contraseña (K3).
 */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly transactions: Transactions,
    private readonly tokens: EmailTokensService,
    private readonly outbox: OutboxService,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionsService,
  ) {}

  /**
   * POST /auth/email-verification/request (correo §5.2, §5.3): encola y nada más. No consulta
   * `users`, así que la petición hace lo mismo exista o no la cuenta; el *worker* decide después
   * si hay a quién enviar.
   */
  async request(email: string): Promise<void> {
    await this.outbox.enqueue(this.db, 'verify_email', email);
    this.outbox.kick();
  }

  /** POST /auth/email-tokens/inspection: no escribe nada ni cuenta intentos. */
  async inspect(
    request: EmailTokenInspectionRequest,
    authorization: string | undefined,
  ): Promise<EmailTokenInspectionResponse> {
    const live = await this.tokens.findLiveForAccount(this.db, request.token, request.purpose);
    if (!live) throw tokenInvalid();
    const session = await this.sessionOf(authorization);
    return {
      emailHint: emailHint(live.user.email),
      sessionMatches: session?.userId === live.user.id,
    };
  }

  /** POST /auth/email-verification (correo §5.4). */
  async confirm(
    request: EmailVerificationRequest,
    authorization: string | undefined,
  ): Promise<EmailVerificationResponse> {
    const live = await this.tokens.findLiveForAccount(this.db, request.token, 'verify_email');
    if (!live) throw tokenInvalid();
    const account = live.user;
    const session = await this.sessionOf(authorization);

    // Con la sesión viva de esa misma cuenta basta el botón; la contraseña se ignora.
    if (session?.userId === account.id) {
      await this.transactions.run(async (tx) => {
        // La cuenta primero y después el enlace: el mismo orden que el borrado de §6.3.
        if (!(await this.users.lockUser(tx, account.id))) throw tokenInvalid();
        if (!(await this.tokens.consume(tx, request.token, 'verify_email'))) throw tokenInvalid();
        await this.users.markEmailVerified(tx, account.id, account.email);
      });
      this.logger.log({ event: 'email_verified', method: 'token' });
      return { session: 'same' };
    }

    if (request.password === undefined) {
      throw new ApiException(
        'VALIDATION_FAILED',
        400,
        [{ path: 'password', issue: 'required' }],
        'Request validation failed',
      );
    }
    // Una cuenta sin verificar siempre tiene contraseña (`users_unverified_has_password`).
    const passwordHash = account.passwordHash;
    if (passwordHash === null) throw tokenInvalid();

    // argon2 fuera de la transacción: no la alarga.
    if (!(await this.passwords.verify(passwordHash, request.password))) {
      const failures = await this.tokens.recordFailure(this.db, request.token, 'verify_email');
      if (failures === undefined) throw tokenInvalid();
      if (failures >= EMAIL_TOKEN_MAX_FAILURES) {
        // El tope está en PostgreSQL: sobrevive a un reinicio de la API. La salida es recuperar.
        await this.tokens.delete(this.db, request.token);
        this.logger.log({ event: 'email_verification_locked' });
        throw new ApiException(
          'TOKEN_ATTEMPTS_EXCEEDED',
          403,
          undefined,
          'Token attempts exceeded',
        );
      }
      throw passwordIncorrect();
    }
    const rehash = this.passwords.needsRehash(passwordHash)
      ? await this.passwords.hash(request.password)
      : undefined;

    const opened = await this.transactions.run(async (tx) => {
      // La cuenta primero y después el enlace: el mismo orden que el borrado de §6.3. Si se ha
      // borrado entre medias, el enlace ya no existe.
      if (!(await this.users.lockUser(tx, account.id))) throw tokenInvalid();
      // K10 (§5.7): si la contraseña cambió desde que se verificó, no vale.
      if (!(await this.users.lockUnchangedPassword(tx, account.id, passwordHash, rehash))) {
        throw passwordIncorrect();
      }
      if (!(await this.tokens.consume(tx, request.token, 'verify_email'))) throw tokenInvalid();
      await this.users.markEmailVerified(tx, account.id, account.email);
      // Con la sesión de otra cuenta, esa sesión no cambia (decisión 8 del cliente).
      return session ? null : await this.sessions.create(tx, account.id);
    });
    this.logger.log({ event: 'email_verified', method: 'token' });
    if (!opened) return { session: 'kept-other' };
    return {
      session: 'opened',
      auth: {
        user: toPublicUser({ ...account, emailVerifiedAt: new Date() }),
        session: { token: opened.token, expiresAt: opened.expiresAt.toISOString() },
      },
    };
  }

  /** Sesión viva del `Bearer`, si viene uno válido. Estas rutas son públicas: sin él, `null`. */
  private async sessionOf(authorization: string | undefined): Promise<ActiveSession | null> {
    const [scheme, token, ...rest] = (authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token || rest.length > 0 || !OPAQUE_TOKEN_PATTERN.test(token)) {
      return null;
    }
    return this.sessions.validate(hashOpaqueToken(token));
  }
}
