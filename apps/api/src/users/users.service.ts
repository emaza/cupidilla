import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AccountResponse, PublicUser } from '@cupidilla/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import { assertRecent, markSessionAuthenticated } from '../auth/recent-auth.js';
import { ApiException } from '../common/errors/api.exception.js';
import { Clock } from '../common/clock.js';
import type { ActiveSession } from '../common/decorators/current-session.decorator.js';
import { ConsentsService } from '../consents/consents.service.js';
import { DB, type Database, type Executor } from '../database/database.types.js';
import { isUniqueViolation } from '../database/pg-errors.js';
import { users } from '../database/schema/index.js';
import { IdentitiesService } from '../oauth/identities.service.js';
import { PasswordService } from './password.service.js';

export interface NewUser {
  email: string;
  /** `null` en una cuenta creada con un proveedor (§5.1). */
  passwordHash: string | null;
  birthDate: string;
}

export interface UserCredentials {
  user: PublicUser;
  /** `null` en una cuenta creada con un proveedor que todavía no tiene contraseña. */
  passwordHash: string | null;
}

type UserRow = typeof users.$inferSelect;

export const toPublicUser = (row: Pick<UserRow, 'id' | 'email' | 'createdAt'>): PublicUser => ({
  id: row.id,
  email: row.email,
  createdAt: row.createdAt.toISOString(),
});

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly passwords: PasswordService,
    private readonly consents: ConsentsService,
    private readonly identities: IdentitiesService,
    private readonly clock: Clock,
  ) {}

  /** Inserta sin consulta previa: la restricción UNIQUE decide si el correo está en uso. */
  async create(db: Executor, data: NewUser): Promise<PublicUser> {
    const now = this.clock.now();
    try {
      const [row] = await db
        .insert(users)
        .values({ ...data, createdAt: now, updatedAt: now })
        .returning();
      if (!row) throw new Error('INSERT de users sin fila devuelta');
      return toPublicUser(row);
    } catch (error) {
      if (isUniqueViolation(error, 'users_email_unique')) {
        throw new ApiException('EMAIL_TAKEN', 409, undefined, 'Email already registered');
      }
      throw error;
    }
  }

  async findCredentialsByEmail(email: string): Promise<UserCredentials | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return row ? { user: toPublicUser(row), passwordHash: row.passwordHash } : undefined;
  }

  async findPublicById(userId: string): Promise<PublicUser | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    return row ? toPublicUser(row) : undefined;
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.db
      .update(users)
      .set({ passwordHash, updatedAt: this.clock.now() })
      .where(eq(users.id, userId));
  }

  async getAccount(
    userId: string,
    session: Pick<ActiveSession, 'authenticatedAt'>,
  ): Promise<AccountResponse> {
    const [row] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!row) throw new ApiException('UNAUTHENTICATED', 401);
    const linked = await this.identities.listForUser(userId);
    return {
      user: { ...toPublicUser(row), birthDate: row.birthDate },
      consents: await this.consents.listForUser(userId),
      signInMethods: {
        password: row.passwordHash !== null,
        identities: linked.map(({ provider, linkedAt }) => ({
          provider,
          linkedAt: linkedAt.toISOString(),
        })),
      },
      session: { authenticatedAt: session.authenticatedAt.toISOString() },
    };
  }

  /**
   * POST /users/me/password (§9.5): crea la contraseña de una cuenta que no tiene. Una sola
   * sentencia atómica: si ya había contraseña (otra pestaña), 409. No cierra otras sesiones ni
   * cambia `authenticated_at` (T17).
   */
  async createPassword(session: ActiveSession, password: string): Promise<void> {
    assertRecent(session, this.clock.now());
    // El hash va fuera de cualquier transacción.
    const passwordHash = await this.passwords.hash(password);
    const updated = await this.db
      .update(users)
      .set({ passwordHash, updatedAt: this.clock.now() })
      .where(and(eq(users.id, session.userId), isNull(users.passwordHash)))
      .returning({ id: users.id });
    if (updated.length === 0) {
      throw new ApiException('PASSWORD_ALREADY_SET', 409, undefined, 'Password already set');
    }
    this.logger.log({ event: 'password_created' });
  }

  /**
   * POST /users/me/reauthentication (§9.1, T16): renueva `authenticated_at` con la contraseña.
   * Una cuenta sin contraseña no tiene nada que comprobar aquí: 404.
   */
  async reauthenticateWithPassword(
    session: Pick<ActiveSession, 'userId' | 'tokenHash'>,
    password: string,
  ): Promise<void> {
    const [row] = await this.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);
    if (!row) throw new ApiException('UNAUTHENTICATED', 401);
    if (row.passwordHash === null) {
      throw new ApiException('NOT_FOUND', 404, undefined, 'Account has no password');
    }
    if (!(await this.passwords.verify(row.passwordHash, password))) {
      throw new ApiException('PASSWORD_INCORRECT', 403, undefined, 'Password does not match');
    }
    await markSessionAuthenticated(this.db, session.tokenHash, this.clock.now());
    this.logger.log({ event: 'session_reauthenticated', method: 'password' });
  }

  /**
   * Borrado real (§10). Un único DELETE: ON DELETE CASCADE elimina en la misma sentencia
   * todas las sesiones y todos los consentimientos del usuario.
   */
  async deleteAccount(
    session: Pick<ActiveSession, 'userId' | 'authenticatedAt'>,
    password: string | undefined,
  ): Promise<void> {
    const userId = session.userId;
    const [row] = await this.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) throw new ApiException('UNAUTHENTICATED', 401);
    if (row.passwordHash === null) {
      // Sin contraseña (§9.2): basta una sesión reciente. La palabra «ELIMINAR» la valida la web:
      // es una confirmación de intención, no de identidad.
      assertRecent(session, this.clock.now());
      await this.db.delete(users).where(eq(users.id, userId));
      this.logger.log({ event: 'account_deleted' });
      return;
    }
    if (password === undefined) {
      // Con contraseña en la cuenta, H0 sin cambios: el campo es obligatorio.
      throw new ApiException(
        'VALIDATION_FAILED',
        400,
        [{ path: 'password', issue: 'required' }],
        'Request validation failed',
      );
    }
    if (!(await this.passwords.verify(row.passwordHash, password))) {
      throw new ApiException('PASSWORD_INCORRECT', 403, undefined, 'Password does not match');
    }
    await this.db.delete(users).where(eq(users.id, userId));
    this.logger.log({ event: 'account_deleted' });
  }
}
