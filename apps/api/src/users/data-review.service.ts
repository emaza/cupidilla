import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  checkBirthDate,
  birthDateSchema,
  dataReviewAcceptanceSchema,
  dataReviewRequestSchema,
  referenceToday,
  SERVICE_TERMS_VERSION,
  type DataReviewRequest,
} from '@cupidilla/contracts';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { Clock } from '../common/clock.js';
import { ApiException } from '../common/errors/api.exception.js';
import type { Env } from '../config/env.schema.js';
import { validationExceptionFactory } from '../common/errors/validation-exception.factory.js';
import { ConsentsService } from '../consents/consents.service.js';
import { DB, type Database } from '../database/database.types.js';
import { emailOutbox, users } from '../database/schema/index.js';
import { Transactions } from '../database/transactions.js';

/**
 * Revisión de datos tras recuperar una cuenta que tenía el correo sin verificar (correo §5.11,
 * decisión 12 del cliente): la persona escribe de nuevo su fecha de nacimiento y vuelve a aceptar
 * las condiciones. Así nadie hereda los datos ni la aceptación de quien creó la cuenta.
 */
@Injectable()
export class DataReviewService {
  private readonly logger = new Logger(DataReviewService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly clock: Clock,
    private readonly transactions: Transactions,
    private readonly consents: ConsentsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * POST /users/me/data-review (correo §5.11): la edad en cuanto la fecha tiene forma válida (menor,
   * se borra la cuenta y 422, aunque falle la forma de otros campos) → forma del resto (400, fecha
   * futura incluida) → aceptación de las condiciones → versión → revisión pendiente. La edad va
   * antes que la casilla: con un menor no se mira nada más, y nunca se registra una aceptación que
   * no se marcó. El cuerpo llega sin validar (`unknown`): lo valida este método.
   */
  async complete(userId: string, body: unknown): Promise<void> {
    // Antes de leer nada, con la regla y el MIN_AGE vigentes del alta: es una declaración nueva.
    const birthDate = birthDateSchema.safeParse(
      typeof body === 'object' && body !== null
        ? (body as { birthDate?: unknown }).birthDate
        : undefined,
    );
    const minAge = this.config.get('MIN_AGE', { infer: true });
    const today = referenceToday(this.clock.now());
    const first = birthDate.success ? checkBirthDate(birthDate.data, today, minAge) : null;
    if (first && !first.ok && first.reason === 'UNDERAGE') {
      // Como en el alta, un menor no tiene cuenta: se borra en el acto y su fecha no se guarda ni
      // se registra (decisión del CTO). Solo si la revisión sigue pendiente; si no, no borra nada
      // y responde igual. Va antes de la forma de los demás campos: así un 400 siempre significa
      // que la API no ha visto a un menor.
      if (await this.deletePendingAccount(userId)) {
        this.logger.log({ event: 'account_deleted', reason: 'underage_review' });
      }
      throw new ApiException('UNDERAGE', 422, undefined, 'Minimum age not reached');
    }
    const parsed = dataReviewRequestSchema.safeParse(body);
    if (!parsed.success) throw validationExceptionFactory(parsed.error.issues);
    const request: DataReviewRequest = parsed.data;
    if (first && !first.ok) {
      throw new ApiException(
        'VALIDATION_FAILED',
        400,
        [{ path: 'birthDate', issue: 'in_future' }],
        'Request validation failed',
      );
    }
    // Solo un adulto llega aquí: sin la casilla marcada no se cambia nada.
    if (!dataReviewAcceptanceSchema.safeParse(request).success) {
      throw new ApiException(
        'VALIDATION_FAILED',
        400,
        [{ path: 'acceptTerms', issue: 'required' }],
        'Request validation failed',
      );
    }
    if (request.termsVersion !== SERVICE_TERMS_VERSION) {
      throw new ApiException('TERMS_VERSION_OUTDATED', 409, undefined, 'Terms version outdated');
    }

    await this.transactions.run(async (tx) => {
      const [pending] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, userId), isNotNull(users.dataReviewRequiredAt)))
        .for('update');
      // Esta ruta no sirve para cambiar la fecha cuando no hay revisión pendiente.
      if (!pending) throw new ApiException('NOT_FOUND', 404, undefined, 'No data review pending');
      await tx
        .update(users)
        .set({
          birthDate: request.birthDate,
          dataReviewRequiredAt: null,
          updatedAt: this.clock.now(),
        })
        .where(eq(users.id, userId));
      // La aceptación anterior queda como histórico, con su `revoked_at`.
      await this.consents.revoke(tx, userId, 'service_use');
      await this.consents.grant(tx, userId, 'service_use', request.termsVersion);
    });
    this.logger.log({ event: 'data_review_completed' });
  }

  /**
   * Borra la cuenta si sigue pendiente de revisión, con sus correos pendientes (correo §3.5), en
   * una sola sentencia. El resto desaparece en cascada. Devuelve si borró algo.
   */
  private async deletePendingAccount(userId: string): Promise<boolean> {
    const result = await this.db.execute<{ id: string }>(sql`
      with deleted as (
        delete from ${users}
        where ${users.id} = ${userId} and ${users.dataReviewRequiredAt} is not null
        returning ${users.email}
      ), deleted_mail as (
        delete from ${emailOutbox} where ${emailOutbox.toEmail} in (select email from deleted)
      )
      select 1 as id from deleted`);
    return result.rows.length > 0;
  }
}
