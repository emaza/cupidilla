import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  OAUTH_FLOW_TTL_MINUTES,
  OAUTH_PROVIDERS,
  type OAuthCallbackRequest,
  type OAuthCallbackResponse,
  type OAuthFailureReason,
  type OAuthProvider,
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
import { SessionsService } from '../auth/sessions.service.js';
import { Clock } from '../common/clock.js';
import { generateOpaqueToken, hashOpaqueToken } from '../common/crypto/opaque-token.js';
import { ApiException } from '../common/errors/api.exception.js';
import { DB, type Database } from '../database/database.types.js';
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
  async start(provider: OAuthProvider, request: OAuthStartRequest): Promise<OAuthStartResponse> {
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
      purpose: 'sign_in',
      entryPoint: request.entryPoint,
      sessionTokenHash: null,
      state,
      codeVerifier,
      nonce,
      returnPath: request.returnPath ?? null,
      createdAt: now,
      expiresAt,
    });
    const authorizationUrl = client.authorizationUrl({
      state,
      nonce,
      codeChallenge: await calculatePKCECodeChallenge(codeVerifier),
      reauthenticate: false,
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

  /** POST /auth/oauth/:provider/callback. */
  async callback(
    provider: OAuthProvider,
    request: OAuthCallbackRequest,
  ): Promise<OAuthCallbackResponse> {
    const client = this.client(provider);
    const row = await this.consume(provider, request);
    // Los propósitos con sesión (reautenticar y añadir) llegan con la fase 5.
    if (row.purpose !== 'sign_in' || row.entryPoint === null) throw flowInvalid();

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
}
