import { Inject, Injectable } from '@nestjs/common';
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
import { ConsentsService } from '../consents/consents.service.js';
import { DB, type Database } from '../database/database.types.js';
import { Transactions } from '../database/transactions.js';
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
    @Inject(DB) private readonly db: Database,
    private readonly clock: Clock,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly consents: ConsentsService,
    private readonly sessions: SessionsService,
    private readonly transactions: Transactions,
  ) {}

  async register(request: RegisterRequest): Promise<AuthResponse> {
    // La fecha se comprueba antes de cualquier consulta: con un menor no se escribe nada.
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
      throw new ApiException('UNDERAGE', 422, undefined, 'Minimum age not reached');
    }
    if (request.termsVersion !== SERVICE_TERMS_VERSION) {
      throw new ApiException('TERMS_VERSION_OUTDATED', 409, undefined, 'Terms version outdated');
    }

    // El hash va fuera de la transacción: no la alarga y el tiempo no depende del correo.
    const passwordHash = await this.passwords.hash(request.password);
    return this.transactions.run(async (tx) => {
      await this.users.assertEmailNotInIdentities(tx, request.email);
      const user = await this.users.create(tx, {
        email: request.email,
        passwordHash,
        birthDate: request.birthDate,
      });
      await this.consents.grant(tx, user.id, 'service_use', request.termsVersion);
      const session = await this.sessions.create(tx, user.id);
      return toAuthResponse(user, session);
    });
  }

  async login(request: LoginRequest): Promise<AuthResponse> {
    const credentials = await this.users.findCredentialsByEmail(request.email);
    // Sin cuenta o sin contraseña (cuenta creada con un proveedor, §9.6): el mismo argon2 con un
    // hash ficticio y la misma respuesta, para no revelar si la cuenta existe ni cómo se creó.
    if (!credentials || credentials.passwordHash === null) {
      await this.passwords.verifyDummy(request.password);
      throw invalidCredentials();
    }
    if (!(await this.passwords.verify(credentials.passwordHash, request.password))) {
      throw invalidCredentials();
    }
    if (this.passwords.needsRehash(credentials.passwordHash)) {
      await this.users.updatePasswordHash(
        credentials.user.id,
        await this.passwords.hash(request.password),
      );
    }
    await this.sessions.deleteExpiredForUser(credentials.user.id);
    const session = await this.sessions.create(this.db, credentials.user.id);
    return toAuthResponse(credentials.user, session);
  }

  logout(tokenHash: string): Promise<void> {
    return this.sessions.revoke(tokenHash);
  }
}

/** Misma respuesta para correo inexistente, cuenta sin contraseña y contraseña errónea. */
const invalidCredentials = (): ApiException =>
  new ApiException('INVALID_CREDENTIALS', 401, undefined, 'Invalid credentials');
