import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  OAUTH_FLOW_TTL_MINUTES,
  OAUTH_PROVIDERS,
  type OAuthCallbackRequest,
  type OAuthCallbackResponse,
  type OAuthFailureReason,
  type OAuthEntryPoint,
  type OAuthProvider,
  type OAuthSessionStartRequest,
  type OAuthStartRequest,
  type OAuthStartResponse,
} from '@cupidilla/contracts';
import { eq, lte } from 'drizzle-orm';
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  calculatePKCECodeChallenge,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
} from 'openid-client';
import { assertRecent, markSessionAuthenticated } from '../auth/recent-auth.js';
import { SessionsService } from '../auth/sessions.service.js';
import { Clock } from '../common/clock.js';
import {
  generateOpaqueToken,
  hashOpaqueToken,
  OPAQUE_TOKEN_PATTERN,
} from '../common/crypto/opaque-token.js';
import type { ActiveSession } from '../common/decorators/current-session.decorator.js';
import { ApiException } from '../common/errors/api.exception.js';
import { DB, type Database } from '../database/database.types.js';
import { isUniqueViolation } from '../database/pg-errors.js';
import { oauthStates } from '../database/schema/index.js';
import { UsersService } from '../users/users.service.js';
import { IdentitiesService } from './identities.service.js';
import { flowInvalid, PendingIdentitiesService } from './pending-identities.service.js';
import {
  ProviderCancelledError,
  type ProviderClient,
  type ProviderIdentity,
} from './providers/provider-client.js';
import { PROVIDER_CLIENTS, type ProviderClients } from './providers/provider-clients.js';

const MINUTE_MS = 60_000;

type OAuthStateRow = typeof oauthStates.$inferSelect;

/** Comparación en tiempo constante de dos cadenas de cualquier longitud. */
const sameString = (a: string, b: string): boolean =>
  timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

/** Inicio y vuelta de un flujo con proveedor, con las reglas de §6. */
@Injectable()
export class OAuthFlowService implements OnModuleInit {
  private readonly logger = new Logger(OAuthFlowService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PROVIDER_CLIENTS) private readonly clients: ProviderClients,
    private readonly clock: Clock,
    private readonly users: UsersService,
    private readonly identities: IdentitiesService,
    private readonly pending: PendingIdentitiesService,
    private readonly sessions: SessionsService,
  ) {}

  /** Al arrancar se limpian las filas caducadas de las dos tablas (§4). */
  async onModuleInit(): Promise<void> {
    await this.deleteExpiredStates();
    await this.pending.deleteExpired();
  }

  /** Proveedores con credenciales, en el orden de la interfaz. */
  configuredProviders(): OAuthProvider[] {
    return OAUTH_PROVIDERS.filter((provider) => this.clients.has(provider));
  }

  /** El cliente del proveedor; 404 si no está configurado (§10.3). */
  client(provider: OAuthProvider): ProviderClient {
    const client = this.clients.get(provider);
    if (!client) throw new ApiException('NOT_FOUND', 404, undefined, 'Provider not configured');
    return client;
  }

  private async deleteExpiredStates(): Promise<void> {
    await this.db.delete(oauthStates).where(lte(oauthStates.expiresAt, this.clock.now()));
  }

  /** POST /auth/oauth/:provider/authorization: empieza a entrar sin sesión. */
  start(provider: OAuthProvider, request: OAuthStartRequest): Promise<OAuthStartResponse> {
    return this.createFlow(provider, {
      purpose: 'sign_in',
      entryPoint: request.entryPoint,
      sessionTokenHash: null,
      returnPath: request.returnPath ?? null,
    });
  }

  /**
   * POST /users/me/oauth/:provider/authorization: reautenticarse o añadir un proveedor desde
   * /account (§9.1, §9.3). Añadir exige una sesión reciente: una sesión robada no puede dejar
   * unida una identidad del atacante. Reautenticarse exige tener ese proveedor unido.
   */
  async startWithSession(
    provider: OAuthProvider,
    session: ActiveSession,
    request: OAuthSessionStartRequest,
  ): Promise<OAuthStartResponse> {
    this.client(provider);
    let loginHint: string | undefined;
    if (request.purpose === 'connect') {
      assertRecent(session, this.clock.now());
    } else {
      const identity = (await this.identities.listRowsForUser(session.userId)).find(
        (row) => row.provider === provider,
      );
      if (!identity) throw new ApiException('NOT_FOUND', 404, undefined, 'Provider not linked');
      loginHint = identity.providerEmail ?? undefined;
    }
    return this.createFlow(provider, {
      purpose: request.purpose,
      entryPoint: null,
      sessionTokenHash: session.tokenHash,
      returnPath: request.returnPath ?? null,
      loginHint,
    });
  }

  private async createFlow(
    provider: OAuthProvider,
    flow: {
      purpose: 'sign_in' | 'reauthenticate' | 'connect';
      entryPoint: OAuthEntryPoint | null;
      sessionTokenHash: string | null;
      returnPath: string | null;
      loginHint?: string;
    },
  ): Promise<OAuthStartResponse> {
    const client = this.client(provider);
    await this.deleteExpiredStates();

    const flowToken = generateOpaqueToken();
    const state = randomState();
    const codeVerifier = randomPKCECodeVerifier();
    const nonce = randomNonce();
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + OAUTH_FLOW_TTL_MINUTES * MINUTE_MS);
    await this.db.insert(oauthStates).values({
      tokenHash: hashOpaqueToken(flowToken),
      provider,
      purpose: flow.purpose,
      entryPoint: flow.entryPoint,
      sessionTokenHash: flow.sessionTokenHash,
      state,
      codeVerifier,
      nonce,
      returnPath: flow.returnPath,
      createdAt: now,
      expiresAt,
    });
    const authorizationUrl = client.authorizationUrl({
      state,
      nonce,
      codeChallenge: await calculatePKCECodeChallenge(codeVerifier),
      reauthenticate: flow.purpose === 'reauthenticate',
      loginHint: flow.loginHint,
    });
    return {
      authorizationUrl: authorizationUrl.toString(),
      flowToken,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Consume la fila del flujo: un solo uso (`DELETE … RETURNING`). Si no existe, ha caducado, es
   * de otro proveedor o el `state` de la vuelta no coincide, `OAUTH_FLOW_INVALID` sin más detalle.
   */
  private async consume(
    provider: OAuthProvider,
    request: OAuthCallbackRequest,
  ): Promise<OAuthStateRow> {
    const [row] = await this.db
      .delete(oauthStates)
      .where(eq(oauthStates.tokenHash, hashOpaqueToken(request.flowToken)))
      .returning();
    if (
      !row ||
      row.provider !== provider ||
      row.expiresAt.getTime() <= this.clock.now().getTime()
    ) {
      throw flowInvalid();
    }
    const returnedState = new URLSearchParams(request.callbackQuery).get('state');
    if (returnedState === null || !sameString(returnedState, row.state)) throw flowInvalid();
    return row;
  }

  /**
   * POST /auth/oauth/:provider/callback. `sessionToken` es el `Bearer` que envía la web si hay
   * sesión; los flujos de reautenticar y añadir lo exigen (§9.1).
   */
  async callback(
    provider: OAuthProvider,
    request: OAuthCallbackRequest,
    sessionToken?: string,
  ): Promise<OAuthCallbackResponse> {
    const client = this.client(provider);
    const row = await this.consume(provider, request);
    if (row.purpose !== 'sign_in') return this.sessionCallback(client, row, request, sessionToken);
    if (row.entryPoint === null) throw flowInvalid();

    const failed = (reason: OAuthFailureReason): OAuthCallbackResponse => {
      this.logger.log({ event: 'oauth_flow_failed', provider, reason });
      return {
        result: 'failed',
        reason,
        entryPoint: row.entryPoint ?? 'login',
        returnPath: row.returnPath,
      };
    };

    let identity: ProviderIdentity;
    try {
      identity = await client.exchange({
        callbackQuery: request.callbackQuery,
        state: row.state,
        codeVerifier: row.codeVerifier,
        nonce: row.nonce,
      });
    } catch (error) {
      // El error ya se registró saneado en el cliente; aquí solo el motivo.
      return failed(error instanceof ProviderCancelledError ? 'cancelled' : 'provider_failed');
    }

    // 3. Identidad ya unida: manda (provider, subject), no el correo (T10).
    const known = await this.identities.findByProviderSubject(provider, identity.subject);
    if (known) {
      await this.identities.touch(known.id, {
        providerEmail: identity.email,
        emailVerified: identity.emailVerified,
      });
      const user = await this.users.findPublicById(known.userId);
      if (!user) throw flowInvalid();
      await this.sessions.deleteExpiredForUser(user.id);
      const session = await this.sessions.create(this.db, user.id);
      this.logger.log({ event: 'oauth_signed_in', provider });
      return {
        result: 'signed_in',
        user,
        session: { token: session.token, expiresAt: session.expiresAt.toISOString() },
        returnPath: row.returnPath,
      };
    }

    // 4 y 5. Sin correo fiable no se consulta `users`: no revela si la cuenta existe.
    if (identity.email === null) return failed('email_missing');
    if (!identity.emailVerified) return failed('email_unverified');

    const pendingBase = {
      provider,
      subject: identity.subject,
      providerEmail: identity.email,
      emailVerified: identity.emailVerified,
      entryPoint: row.entryPoint,
      returnPath: row.returnPath,
    };
    const account = await this.users.findCredentialsByEmail(identity.email);
    // 8. Sin cuenta: alta pendiente.
    if (!account) {
      const pending = await this.pending.create({ ...pendingBase, kind: 'signup', userId: null });
      return { result: 'signup_required', pending };
    }
    // 6. Cuenta con contraseña: unión pendiente, que pedirá la contraseña.
    if (account.passwordHash !== null) {
      const pending = await this.pending.create({
        ...pendingBase,
        kind: 'link',
        userId: account.user.id,
      });
      return { result: 'link_required', pending };
    }
    // 7. Cuenta sin contraseña, creada con otro proveedor: no se une nada.
    const providers = (await this.identities.listForUser(account.user.id)).map(
      (item) => item.provider,
    );
    const [first, ...rest] = providers;
    if (!first) return failed('provider_failed'); // no debería existir: cuenta sin forma de entrar
    this.logger.log({ event: 'oauth_flow_failed', provider, reason: 'use_other_provider' });
    return { result: 'use_other_provider', providers: [first, ...rest] };
  }

  /**
   * Vuelta de reautenticar o añadir (§9.1, §9.3). La fila va ligada al hash de la sesión que
   * empezó el flujo: la web tiene que enviar el `Bearer` de esa misma sesión, y la sesión tiene
   * que seguir viva.
   */
  private async sessionCallback(
    client: ProviderClient,
    row: OAuthStateRow,
    request: OAuthCallbackRequest,
    sessionToken: string | undefined,
  ): Promise<OAuthCallbackResponse> {
    const provider = client.provider;
    if (!sessionToken || !OPAQUE_TOKEN_PATTERN.test(sessionToken)) throw flowInvalid();
    const tokenHash = hashOpaqueToken(sessionToken);
    if (row.sessionTokenHash === null || !sameString(tokenHash, row.sessionTokenHash)) {
      throw flowInvalid();
    }
    const session = await this.sessions.validate(tokenHash);
    if (!session) throw flowInvalid();

    const failed = (reason: OAuthFailureReason): OAuthCallbackResponse => {
      this.logger.log({ event: 'oauth_flow_failed', provider, reason });
      return { result: 'failed', reason, entryPoint: 'account', returnPath: row.returnPath };
    };

    let identity: ProviderIdentity;
    try {
      identity = await client.exchange({
        callbackQuery: request.callbackQuery,
        state: row.state,
        codeVerifier: row.codeVerifier,
        nonce: row.nonce,
      });
    } catch (error) {
      return failed(error instanceof ProviderCancelledError ? 'cancelled' : 'provider_failed');
    }
    const known = await this.identities.findByProviderSubject(provider, identity.subject);

    if (row.purpose === 'reauthenticate') {
      // Tiene que ser una identidad de esta cuenta (R5): si no, no se confirma nada.
      if (!known || known.userId !== session.userId) return failed('identity_mismatch');
      await markSessionAuthenticated(this.db, tokenHash, this.clock.now());
      this.logger.log({ event: 'session_reauthenticated', method: 'provider' });
      return { result: 'reauthenticated', returnPath: row.returnPath };
    }

    // connect (§9.3).
    if (known) {
      return known.userId === session.userId ? { result: 'connected' } : failed('identity_in_use');
    }
    try {
      await this.identities.create(this.db, {
        userId: session.userId,
        provider,
        subject: identity.subject,
        providerEmail: identity.email,
        emailVerified: identity.emailVerified,
      });
    } catch (error) {
      if (isUniqueViolation(error, 'identities_user_provider_unique')) {
        return failed('already_linked');
      }
      if (isUniqueViolation(error, 'identities_provider_subject_unique')) {
        // Se unió a la vez desde otra pestaña o a otra cuenta.
        const now = await this.identities.findByProviderSubject(provider, identity.subject);
        return now?.userId === session.userId ? { result: 'connected' } : failed('identity_in_use');
      }
      throw error;
    }
    this.logger.log({ event: 'identity_connected', provider });
    return { result: 'connected' };
  }
}
