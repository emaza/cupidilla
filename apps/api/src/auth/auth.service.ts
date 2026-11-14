import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  checkBirthDate,
  referenceToday,
  SERVICE_TERMS_VERSION,
  type AuthResponse,
  type LoginRequest,
  type PublicUser,
  type RegisterRequest,
} from '@cupidilla/contracts';
import { Clock } from '../common/clock.js';
import { ApiException } from '../common/errors/api.exception.js';
import type { Env } from '../config/env.schema.js';
import { ConsentsService } from '../consents/consents.service.js';
import { Transactions } from '../database/transactions.js';
import { OutboxService } from '../mail/outbox.service.js';
import { PasswordService } from '../users/password.service.js';
import { UsersService } from '../users/users.service.js';
import { SessionsService } from './sessions.service.js';

const toAuthResponse = (
  user: PublicUser,
  session: { token: string; expiresAt: Date },
): AuthResponse => ({
  user,
  session: { token: session.token, expiresAt: session.expiresAt.toISOString() },
});

@Injectable()
export class AuthService {
  constructor(
    private readonly clock: Clock,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly consents: ConsentsService,
    private readonly sessions: SessionsService,
    private readonly transactions: Transactions,
    private readonly config: ConfigService<Env, true>,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Registro uniforme (correo §5.1): siempre `202` sin cuerpo y sin sesión, exista o no el correo.
   * Correo nuevo: cuenta sin verificar y «Confirma tu correo». Correo ya registrado (en `users` o
   * como proveedor verificado): no cambia nada y avisa a su dueño.
   */
  async register(request: RegisterRequest): Promise<void> {
    // La fecha se comprueba antes de cualquier consulta: con un menor no se escribe nada.
    const check = checkBirthDate(
      request.birthDate,
      referenceToday(this.clock.now()),
      this.config.get('MIN_AGE', { infer: true }),
    );
    if (!check.ok && check.reason === 'IN_FUTURE') {
      throw new ApiException(
        'VALIDATION_FAILED',
        400,
        [{ path: 'birthDate', issue: 'in_future' }],
        'Request validation failed',
      );
    }
    if (!check.ok) {
      throw new ApiException('UNDERAGE', 422, undefined, 'Minimum age not reached');
    }
    if (request.termsVersion !== SERVICE_TERMS_VERSION) {
      throw new ApiException('TERMS_VERSION_OUTDATED', 409, undefined, 'Terms version outdated');
    }

    // El hash va siempre y fuera de la transacción: no la alarga y el tiempo no depende del correo.
    const passwordHash = await this.passwords.hash(request.password);
    await this.transactions.run(async (tx) => {
      if (await this.users.isEmailTaken(tx, request.email)) {
        // Ni contraseña, ni fecha, ni consentimiento: solo el aviso a quien ya tiene el correo.
        await this.outbox.enqueue(tx, 'signup_notice', request.email);
        return;
      }
      const user = await this.users.create(tx, {
        email: request.email,
        passwordHash,
        birthDate: request.birthDate,
      });
      await this.consents.grant(tx, user.id, 'service_use', request.termsVersion);
      await this.outbox.enqueue(tx, 'verify_email', request.email);
    });
    this.outbox.kick();
  }

  async login(request: LoginRequest): Promise<AuthResponse> {
    const credentials = await this.users.findCredentialsByEmail(request.email);
    // Sin cuenta o sin contraseña (cuenta creada con un proveedor, §9.6): el mismo argon2 con un
    // hash ficticio y la misma respuesta, para no revelar si la cuenta existe ni cómo se creó.
    if (!credentials || credentials.passwordHash === null) {
      await this.passwords.verifyDummy(request.password);
      throw invalidCredentials();
    }
    const verifiedHash = credentials.passwordHash;
    if (!(await this.passwords.verify(verifiedHash, request.password))) {
      throw invalidCredentials();
    }
    const rehash = this.passwords.needsRehash(verifiedHash)
      ? await this.passwords.hash(request.password)
      : undefined;
    await this.sessions.deleteExpiredForUser(credentials.user.id);
    const session = await this.transactions.run(async (tx) => {
      // Correo §5.7 (K10): si un restablecimiento cambió la contraseña mientras se verificaba,
      // la contraseña vieja ya no abre sesión.
      if (
        !(await this.users.lockUnchangedPassword(tx, credentials.user.id, verifiedHash, rehash))
      ) {
        throw invalidCredentials();
      }
      return this.sessions.create(tx, credentials.user.id);
    });
    return toAuthResponse(credentials.user, session);
  }

  logout(tokenHash: string): Promise<void> {
    return this.sessions.revoke(tokenHash);
  }
}

/** Misma respuesta para correo inexistente, cuenta sin contraseña y contraseña errónea. */
const invalidCredentials = (): ApiException =>
  new ApiException('INVALID_CREDENTIALS', 401, undefined, 'Invalid credentials');
