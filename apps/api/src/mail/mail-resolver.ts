import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EMAIL_VERIFICATION_TTL_HOURS,
  PASSWORD_RESET_TTL_MINUTES,
  type EmailTokenPurpose,
} from '@cupidilla/contracts';
import { eq } from 'drizzle-orm';
import type { Env } from '../config/env.schema.js';
import type { Tx } from '../database/database.types.js';
import { users } from '../database/schema/index.js';
import { IdentitiesService } from '../oauth/identities.service.js';
import { unverifiedDeletionAt } from '../users/unverified-deletion.js';
import { EmailTokensService } from './email-tokens.service.js';
import type { MailMessage } from './mailer.js';
import type { MailKind } from './outbox.service.js';
import type { MailContext, RenderedMail } from './templates/layout.js';
import { renderPasswordChanged } from './templates/password-changed.js';
import { renderResetPassword } from './templates/reset-password.js';
import { renderSignupNotice } from './templates/signup-notice.js';
import { renderVerifyEmail } from './templates/verify-email.js';
import { renderVerifyReminder } from './templates/verify-reminder.js';

const HOUR_MS = 60 * 60 * 1000;

/** Ruta de la web de cada propósito de token. */
const TOKEN_PATHS: Record<EmailTokenPurpose, string> = {
  verify_email: '/verify-email',
  reset_password: '/reset-password',
};

type UserRow = Pick<typeof users.$inferSelect, 'id' | 'email' | 'emailVerifiedAt' | 'createdAt'>;

/**
 * Decide, al enviar y siempre por `to_email`, a quién va un correo, qué variante toca y, si lleva
 * enlace, emite su token (correo §4.3). `null`: no hay a quién enviar y la fila se descarta.
 */
@Injectable()
export class MailResolver {
  private readonly context: MailContext;

  constructor(
    private readonly identities: IdentitiesService,
    private readonly tokens: EmailTokensService,
    config: ConfigService<Env, true>,
  ) {
    this.context = {
      webUrl: config.get('PUBLIC_WEB_URL', { infer: true }),
      supportAddress: config.get('MAIL_SUPPORT_ADDRESS', { infer: true }),
    };
  }

  async resolve(tx: Tx, kind: MailKind, toEmail: string): Promise<MailMessage | null> {
    const user = await this.findUser(tx, toEmail);
    const rendered = await this.render(tx, kind, toEmail, user);
    return rendered ? { to: toEmail, ...rendered } : null;
  }

  private async render(
    tx: Tx,
    kind: MailKind,
    email: string,
    user: UserRow | undefined,
  ): Promise<RenderedMail | null> {
    switch (kind) {
      case 'verify_email':
      case 'verify_reminder': {
        if (!user || user.emailVerifiedAt !== null) return null;
        const link = await this.issueLink(
          tx,
          user,
          'verify_email',
          EMAIL_VERIFICATION_TTL_HOURS * HOUR_MS,
        );
        const input = { email, link, deletionAt: unverifiedDeletionAt(user.createdAt) };
        return kind === 'verify_email'
          ? renderVerifyEmail(this.context, input)
          : renderVerifyReminder(this.context, input);
      }
      case 'reset_password': {
        // Verificada o no, con o sin contraseña; sin cuenta no se envía nada (decisión 6).
        if (!user) return null;
        const link = await this.issueLink(
          tx,
          user,
          'reset_password',
          PASSWORD_RESET_TTL_MINUTES * 60_000,
        );
        return renderResetPassword(this.context, { email, link });
      }
      case 'password_changed':
        return user ? renderPasswordChanged(this.context, { email }) : null;
      case 'signup_notice':
        return this.renderSignupNotice(email, user);
    }
  }

  private async renderSignupNotice(
    email: string,
    user: UserRow | undefined,
  ): Promise<RenderedMail | null> {
    if (user) {
      return user.emailVerifiedAt !== null
        ? renderSignupNotice(this.context, { variant: 'verified', email })
        : renderSignupNotice(this.context, {
            variant: 'unverified',
            email,
            deletionAt: unverifiedDeletionAt(user.createdAt),
          });
    }
    // (c): el correo verificado de un proveedor unido a una cuenta con otro correo (R7b).
    const userId = await this.identities.findUserIdByProviderEmail(email);
    if (!userId) return null;
    const providers = (await this.identities.listForUser(userId)).map((row) => row.provider);
    if (providers.length === 0) return null;
    return renderSignupNotice(this.context, { variant: 'provider', email, providers });
  }

  private async findUser(tx: Tx, email: string): Promise<UserRow | undefined> {
    const [row] = await tx
      .select({
        id: users.id,
        email: users.email,
        emailVerifiedAt: users.emailVerifiedAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return row;
  }

  /** Emite el token (anula el anterior) y devuelve el enlace. El token solo existe en memoria. */
  private async issueLink(
    tx: Tx,
    user: UserRow,
    purpose: EmailTokenPurpose,
    ttlMs: number,
  ): Promise<string> {
    const token = await this.tokens.issue(tx, {
      userId: user.id,
      purpose,
      email: user.email,
      ttlMs,
    });
    return `${this.context.webUrl}${TOKEN_PATHS[purpose]}?token=${token}`;
  }
}
