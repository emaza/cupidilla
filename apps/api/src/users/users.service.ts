import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AccountResponse, PublicUser } from '@cupidilla/contracts';
import { eq } from 'drizzle-orm';
import { ApiException } from '../common/errors/api.exception.js';
import { Clock } from '../common/clock.js';
import { ConsentsService } from '../consents/consents.service.js';
import { DB, type Database, type Executor } from '../database/database.types.js';
import { isUniqueViolation } from '../database/pg-errors.js';
import { users } from '../database/schema/index.js';
import { PasswordService } from './password.service.js';

export interface NewUser {
  email: string;
  passwordHash: string;
  birthDate: string;
}

export interface UserCredentials {
  user: PublicUser;
  passwordHash: string;
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

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.db
      .update(users)
      .set({ passwordHash, updatedAt: this.clock.now() })
      .where(eq(users.id, userId));
  }

  async getAccount(userId: string): Promise<AccountResponse> {
    const [row] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!row) throw new ApiException('UNAUTHENTICATED', 401);
    return {
      user: { ...toPublicUser(row), birthDate: row.birthDate },
      consents: await this.consents.listForUser(userId),
    };
  }

  /**
   * Borrado real (§10). Un único DELETE: ON DELETE CASCADE elimina en la misma sentencia
   * todas las sesiones y todos los consentimientos del usuario.
   */
  async deleteAccount(userId: string, password: string): Promise<void> {
    const [row] = await this.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) throw new ApiException('UNAUTHENTICATED', 401);
    if (!(await this.passwords.verify(row.passwordHash, password))) {
      throw new ApiException('PASSWORD_INCORRECT', 403, undefined, 'Password does not match');
    }
    await this.db.delete(users).where(eq(users.id, userId));
    this.logger.log({ event: 'account_deleted' });
  }
}
