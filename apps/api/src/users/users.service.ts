import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AccountResponse, PublicUser } from '@cupidilla/contracts';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { listOpenSessions } from '../auth/open-sessions.js';
import { markSessionAuthenticated } from '../auth/recent-auth.js';
import { ApiException } from '../common/errors/api.exception.js';
import { Clock } from '../common/clock.js';
import type { ActiveSession } from '../common/decorators/current-session.decorator.js';
import { ConsentsService } from '../consents/consents.service.js';
import { DB, type Database, type Executor, type Tx } from '../database/database.types.js';
import { lockEmail } from '../database/email-lock.js';
import { isUniqueViolation } from '../database/pg-errors.js';
import { emailOutbox, emailTokens, identities, users } from '../database/schema/index.js';
import { IdentitiesService, providerEmailIs } from '../oauth/identities.service.js';
import { PasswordService } from './password.service.js';
import { unverifiedDeletionAt } from './unverified-deletion.js';

export interface NewUser {
  email: string;
  /** `null` en una cuenta creada con un proveedor (§5.1). */
  passwordHash: string | null;
  birthDate: string;
  /**
   * Las cuentas creadas con un proveedor nacen con el correo verificado (correo §5.10); las del
   * registro con contraseña, sin verificar.
   */
  emailVerified?: boolean;
}

export interface UserCredentials {
  user: PublicUser;
  /** `null` en una cuenta creada con un proveedor que todavía no tiene contraseña. */
  passwordHash: string | null;
}

type UserRow = typeof users.$inferSelect;

export const toPublicUser = (
  row: Pick<UserRow, 'id' | 'email' | 'createdAt' | 'emailVerifiedAt'>,
): PublicUser => ({
  id: row.id,
  email: row.email,
  createdAt: row.createdAt.toISOString(),
  emailVerified: row.emailVerifiedAt !== null,
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

  /**
   * Inserta sin consulta previa: la restricción UNIQUE decide si el correo está en uso en
   * `users`. Antes toma el bloqueo del correo (`lockEmail`), así que va dentro de una transacción.
   */
  async create(tx: Tx, data: NewUser): Promise<PublicUser> {
    await lockEmail(tx, data.email);
    const now = this.clock.now();
    const { emailVerified = false, ...values } = data;
    try {
      const [row] = await tx
        .insert(users)
        .values({
          ...values,
          emailVerifiedAt: emailVerified ? now : null,
          createdAt: now,
          updatedAt: now,
        })
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

  /**
   * Alta con contraseña (R7): el correo tampoco puede ser el `provider_email` verificado de
   * ninguna identidad (una fila antigua sin verificar no bloquea a nadie, decisión 21). Da el
   * mismo `EMAIL_TAKEN` que `users_email_unique`, para no revelar de dónde viene el correo. Toma
   * el bloqueo del correo: una identidad creada a la vez espera o ya se ve aquí.
   */
  async assertEmailNotInIdentities(tx: Tx, email: string): Promise<void> {
    await lockEmail(tx, email);
    const [row] = await tx
      .select({ id: identities.id })
      .from(identities)
      .where(and(providerEmailIs(email), eq(identities.emailVerified, true)))
      .limit(1);
    if (row) throw new ApiException('EMAIL_TAKEN', 409, undefined, 'Email already registered');
  }

  /**
   * Registro uniforme (correo §5.1): ¿el correo ya es de alguien, en `users` (verificado o no) o
   * como `provider_email` verificado de una identidad? La misma consulta que
   * `assertEmailNotInIdentities`, sin lanzar. Toma el bloqueo del correo.
   */
  async isEmailTaken(tx: Tx, email: string): Promise<boolean> {
    await lockEmail(tx, email);
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    const [identity] = await tx
      .select({ id: identities.id })
      .from(identities)
      .where(and(providerEmailIs(email), eq(identities.emailVerified, true)))
      .limit(1);
    return user !== undefined || identity !== undefined;
  }

  /**
   * Marca el correo como verificado (correo §5.4) y borra lo que ya no sirve: los enlaces de
   * verificación del usuario y los correos `verify_email` y `verify_reminder` pendientes para esa
   * dirección. Lo usan la verificación, la unión y (fase C) la recuperación. Devuelve si la cuenta
   * pasó de no verificada a verificada.
   */
  async markEmailVerified(tx: Tx, userId: string, email: string): Promise<boolean> {
    const updated = await tx
      .update(users)
      .set({ emailVerifiedAt: this.clock.now() })
      .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)))
      .returning({ id: users.id });
    await tx
      .delete(emailTokens)
      .where(and(eq(emailTokens.userId, userId), eq(emailTokens.purpose, 'verify_email')));
    await tx
      .delete(emailOutbox)
      .where(
        and(
          eq(emailOutbox.toEmail, email),
          inArray(emailOutbox.kind, ['verify_email', 'verify_reminder']),
          isNull(emailOutbox.failedAt),
        ),
      );
    return updated.length > 0;
  }

  /**
   * Bloquea la fila de la cuenta hasta el COMMIT, antes de tocar sus enlaces: así una confirmación
   * y el borrado de §6.3 se ordenan sin interbloqueo. `false` si la cuenta ya no existe.
   */
  async lockUser(tx: Tx, userId: string): Promise<boolean> {
    const locked = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .for('update');
    return locked.length > 0;
  }

  /**
   * Correo §5.7 (K10): dentro de la transacción que crea la sesión, comprueba que el hash que se
   * acaba de verificar sigue siendo el de la cuenta, y lo bloquea hasta el COMMIT. Si un
   * restablecimiento lo cambió entre medias, `false`: la sesión no se crea. Con `rehash`, sustituye
   * el hash en la misma sentencia.
   */
  async lockUnchangedPassword(
    tx: Tx,
    userId: string,
    verifiedHash: string,
    rehash?: string,
  ): Promise<boolean> {
    if (rehash !== undefined) {
      const updated = await tx
        .update(users)
        .set({ passwordHash: rehash, updatedAt: this.clock.now() })
        .where(and(eq(users.id, userId), eq(users.passwordHash, verifiedHash)))
        .returning({ id: users.id });
      return updated.length > 0;
    }
    const locked = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.passwordHash, verifiedHash)))
      .for('share');
    return locked.length > 0;
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
    session: Pick<ActiveSession, 'userId' | 'tokenHash' | 'authenticatedAt'>,
  ): Promise<AccountResponse> {
    const userId = session.userId;
    const [row] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!row) throw new ApiException('UNAUTHENTICATED', 401);
    const linked = await this.identities.listForUser(userId);
    const open = await listOpenSessions(this.db, userId, session.tokenHash, this.clock.now());
    return {
      user: {
        ...toPublicUser(row),
        birthDate: row.birthDate,
        emailVerifiedAt: row.emailVerifiedAt?.toISOString() ?? null,
        unverifiedDeletionAt:
          row.emailVerifiedAt === null ? unverifiedDeletionAt(row.createdAt).toISOString() : null,
      },
      consents: await this.consents.listForUser(userId),
      signInMethods: {
        password: row.passwordHash !== null,
        identities: linked.map(({ provider, linkedAt, lastUsedAt }) => ({
          provider,
          linkedAt: linkedAt.toISOString(),
          lastUsedAt: lastUsedAt.toISOString(),
        })),
      },
      session: { authenticatedAt: session.authenticatedAt.toISOString() },
      // Campo a campo, sin spread: lo que no se nombra aquí no sale en la respuesta.
      sessions: open.map((item) => ({
        createdAt: item.createdAt.toISOString(),
        authenticatedAt: item.authenticatedAt.toISOString(),
        expiresAt: item.expiresAt.toISOString(),
        current: item.current,
      })),
    };
  }

  /**
   * Confirmación de un cambio en la cuenta (decisión 20): si la cuenta tiene contraseña, hay que
   * escribirla (400 si falta, 403 si no es correcta). Devuelve si la cuenta tiene contraseña: si
   * no la tiene, cada cambio decide qué pide (§9).
   */
  async confirmPassword(userId: string, password: string | undefined): Promise<boolean> {
    const [row] = await this.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) throw new ApiException('UNAUTHENTICATED', 401);
    if (row.passwordHash === null) return false;
    if (password === undefined) {
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
    return true;
  }

  /**
   * Crea la contraseña de una cuenta que no tiene (§9.5, decisión 21), al volver de la
   * reautenticación con un proveedor unido. Una sola sentencia atómica: devuelve `false` si ya
   * había contraseña (otra pestaña). No cierra otras sesiones ni cambia `authenticated_at` (T17).
   * `db`: la transacción de quien llama, que tiene bloqueada la sesión que lo pidió.
   */
  async setPasswordHashIfMissing(
    userId: string,
    passwordHash: string,
    db: Executor = this.db,
  ): Promise<boolean> {
    const updated = await db
      .update(users)
      .set({ passwordHash, updatedAt: this.clock.now() })
      .where(and(eq(users.id, userId), isNull(users.passwordHash)))
      .returning({ id: users.id });
    return updated.length > 0;
  }

  /**
   * Sin contraseña en la cuenta (decisión 21): las acciones que dan acceso permanente se confirman
   * con un proveedor unido. 409 si ya tiene una.
   */
  async assertHasNoPassword(userId: string): Promise<void> {
    const [row] = await this.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) throw new ApiException('UNAUTHENTICATED', 401);
    if (row.passwordHash !== null) {
      throw new ApiException('PASSWORD_ALREADY_SET', 409, undefined, 'Password already set');
    }
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
   * Borrado real (§10). ON DELETE CASCADE elimina con la fila de `users` todas sus sesiones,
   * consentimientos, identidades y tokens de correo. En la misma transacción se borran las filas
   * del *outbox* con su correo, pendientes o fallidas (correo §3.5): SQL directo sobre la tabla,
   * sin `MailModule`, en la misma sentencia.
   */
  async deleteAccount(
    session: Pick<ActiveSession, 'userId'>,
    password: string | undefined,
  ): Promise<void> {
    const userId = session.userId;
    const [row] = await this.db
      .select({ passwordHash: users.passwordHash, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) throw new ApiException('UNAUTHENTICATED', 401);
    if (row.passwordHash === null) {
      // Sin contraseña (§9.2, decisión 20): no hay nada que pedir. La palabra «ELIMINAR» la valida
      // la web: es una confirmación de intención, no de identidad.
      await this.deleteUserAndMail(userId, row.email);
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
    await this.deleteUserAndMail(userId, row.email);
    this.logger.log({ event: 'account_deleted' });
  }

  /**
   * Una sola sentencia, atómica y sin transacción explícita: si se pierde su respuesta, el
   * resultado es incierto como en H0 (OUTCOME_UNKNOWN), nunca a medias.
   */
  private async deleteUserAndMail(userId: string, email: string): Promise<void> {
    await this.db.execute(sql`
      with deleted_mail as (delete from ${emailOutbox} where ${emailOutbox.toEmail} = ${email})
      delete from ${users} where ${users.id} = ${userId}`);
  }
}
