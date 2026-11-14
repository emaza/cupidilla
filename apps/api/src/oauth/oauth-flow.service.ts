import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  OAUTH_CONFIRMED_CONNECT_TTL_MINUTES,
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
import { and, eq, gt, lte } from 'drizzle-orm';
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  calculatePKCECodeChallenge,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
} from 'openid-client';
import { markSessionAuthenticated } from '../auth/recent-auth.js';
import { SessionsService } from '../auth/sessions.service.js';
import { Clock } from '../common/clock.js';
import {
  generateOpaqueToken,
  hashOpaqueToken,
  OPAQUE_TOKEN_PATTERN,
} from '../common/crypto/opaque-token.js';
import type { ActiveSession } from '../common/decorators/current-session.decorator.js';
import { ApiException } from '../common/errors/api.exception.js';
import { DB, type Database, type Executor, type Tx } from '../database/database.types.js';
import { isUniqueViolation } from '../database/pg-errors.js';
import { oauthStates, sessions, users } from '../database/schema/index.js';
import { Transactions } from '../database/transactions.js';
import { PasswordService } from '../users/password.service.js';
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
/** Cada cuánto se borran las filas caducadas de `oauth_states` (pueden llevar un hash de contraseña). */
const SWEEP_INTERVAL_MS = MINUTE_MS;

type OAuthStateRow = typeof oauthStates.$inferSelect;

/** Comparación en tiempo constante de dos cadenas de cualquier longitud. */
const sameString = (a: string, b: string): boolean =>
  timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

/** Inicio y vuelta de un flujo con proveedor, con las reglas de §6. */
@Injectable()
export class OAuthFlowService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OAuthFlowService.name);
  private sweepTimer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PROVIDER_CLIENTS) private readonly clients: ProviderClients,
    private readonly clock: Clock,
    private readonly users: UsersService,
    private readonly identities: IdentitiesService,
    private readonly pending: PendingIdentitiesService,
    private readonly sessions: SessionsService,
    private readonly passwords: PasswordService,
    private readonly transactions: Transactions,
  ) {}

  /** Al arrancar se limpian las filas caducadas de las dos tablas (§4). */
  async onModuleInit(): Promise<void> {
    await this.deleteExpiredStates();
    await this.pending.deleteExpired();
    // En los tests no hay timers: llaman a `sweepExpiredStates` con el reloj falso.
    if (process.env.NODE_ENV !== 'test') {
      this.sweepTimer = setInterval(() => void this.sweepExpiredStates(), SWEEP_INTERVAL_MS);
      this.sweepTimer.unref();
    }
  }

  onModuleDestroy(): void {
    clearInterval(this.sweepTimer);
    this.sweepTimer = undefined;
  }

  /** Limpieza periódica de `oauth_states` caducadas; un fallo se registra y se reintenta en el siguiente ciclo. */
  async sweepExpiredStates(): Promise<void> {
    try {
      await this.deleteExpiredStates();
    } catch (error) {
      this.logger.warn(`No se pudieron borrar los estados OAuth caducados: ${String(error)}`);
    }
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

  private async deleteExpiredStates(db: Executor = this.db): Promise<void> {
    await db.delete(oauthStates).where(lte(oauthStates.expiresAt, this.clock.now()));
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
   * POST /users/me/oauth/:provider/authorization (§9.1, §9.3, §9.5, decisión 21):
   * - `connect` con contraseña: se escribe en el mismo formulario y empieza el flujo de añadir.
   * - `connect` sin contraseña: no se crea ninguna fila `connect`. Empieza una reautenticación con
   *   un proveedor ya unido y su vuelta crea la fila `connect` (`connect_provider`). Así una sesión
   *   robada no puede dejar unida una identidad del atacante.
   * - `create_password`: lo mismo, con la contraseña nueva ya cifrada en la fila de
   *   reautenticación; se guarda en `users` a la vuelta. `:provider` es el proveedor unido.
   * - `reauthenticate`: exige tener `:provider` unido.
   */
  async startWithSession(
    provider: OAuthProvider,
    session: ActiveSession,
    request: OAuthSessionStartRequest,
  ): Promise<OAuthStartResponse> {
    this.client(provider);
    const base = {
      entryPoint: null,
      sessionTokenHash: session.tokenHash,
      returnPath: request.returnPath ?? null,
    };
    if (request.purpose === 'connect') {
      const hasPassword = await this.users.confirmPassword(session.userId, request.password);
      if (hasPassword) return this.createFlow(provider, { ...base, purpose: 'connect' });
      // Confirma el proveedor unido usado más recientemente; el que se añade no puede confirmar.
      const confirmer = (await this.identities.listRowsForUser(session.userId))
        .filter((row) => row.provider !== provider)
        .sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime())[0];
      // Sin otro proveedor, `:provider` es el único unido: no hay nada que añadir.
      if (!confirmer) throw new ApiException('NOT_FOUND', 404, undefined, 'Provider not found');
      return this.createFlow(confirmer.provider, {
        ...base,
        purpose: 'reauthenticate',
        connectProvider: provider,
        loginHint: confirmer.providerEmail ?? undefined,
      });
    }

    const identity = (await this.identities.listRowsForUser(session.userId)).find(
      (row) => row.provider === provider,
    );
    if (request.purpose === 'create_password') {
      await this.users.assertHasNoPassword(session.userId);
      if (!identity) throw new ApiException('NOT_FOUND', 404, undefined, 'Provider not linked');
      // El hash va fuera de cualquier transacción.
      const newPasswordHash = await this.passwords.hash(request.password);
      return this.createFlow(provider, {
        ...base,
        purpose: 'reauthenticate',
        newPasswordHash,
        loginHint: identity.providerEmail ?? undefined,
      });
    }
    if (!identity) throw new ApiException('NOT_FOUND', 404, undefined, 'Provider not linked');
    return this.createFlow(provider, {
      ...base,
      purpose: 'reauthenticate',
      loginHint: identity.providerEmail ?? undefined,
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
      /** Reautenticación que confirma añadir este proveedor (decisión 21). */
      connectProvider?: OAuthProvider;
      /** Reautenticación que confirma crear esta contraseña (hash argon2id, decisión 21). */
      newPasswordHash?: string;
      /** Vida de la fila; por defecto `OAUTH_FLOW_TTL_MINUTES`. */
      ttlMinutes?: number;
    },
    db: Executor = this.db,
  ): Promise<OAuthStartResponse> {
    const client = this.client(provider);
    // Dentro de la transacción de quien llama, si la hay: no se pide otro cliente al pool.
    await this.deleteExpiredStates(db);

    const flowToken = generateOpaqueToken();
    const state = randomState();
    const codeVerifier = randomPKCECodeVerifier();
    const nonce = randomNonce();
    const now = this.clock.now();
    const ttlMinutes = flow.ttlMinutes ?? OAUTH_FLOW_TTL_MINUTES;
    const expiresAt = new Date(now.getTime() + ttlMinutes * MINUTE_MS);
    await db.insert(oauthStates).values({
      tokenHash: hashOpaqueToken(flowToken),
      provider,
      purpose: flow.purpose,
      entryPoint: flow.entryPoint,
      sessionTokenHash: flow.sessionTokenHash,
      state,
      codeVerifier,
      nonce,
      returnPath: flow.returnPath,
      connectProvider: flow.connectProvider ?? null,
      newPasswordHash: flow.newPasswordHash ?? null,
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
    if (!account) {
      // 7b (R7b). El correo es el de un proveedor de otra cuenta: siempre `use_other_provider`
      // con los proveedores de esa cuenta, tenga o no contraseña. No se une nada.
      const ownerId = await this.identities.findUserIdByProviderEmail(identity.email);
      if (ownerId) return this.useOtherProvider(provider, ownerId, failed);
      // 8. Sin cuenta: alta pendiente.
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
    return this.useOtherProvider(provider, account.user.id, failed);
  }

  /** `use_other_provider` con los proveedores de la cuenta, en el orden de la interfaz. */
  private async useOtherProvider(
    provider: OAuthProvider,
    userId: string,
    failed: (reason: OAuthFailureReason) => OAuthCallbackResponse,
  ): Promise<OAuthCallbackResponse> {
    const providers = (await this.identities.listForUser(userId)).map((item) => item.provider);
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
      const connectProvider = row.connectProvider;
      const newPasswordHash = row.newPasswordHash;
      return this.withLiveSession(session.userId, tokenHash, async (tx) => {
        await markSessionAuthenticated(tx, tokenHash, this.clock.now());
        this.logger.log({ event: 'session_reauthenticated', method: 'provider' });
        if (connectProvider !== null) {
          return this.confirmConnect(connectProvider, row.returnPath, tokenHash, failed, tx);
        }
        if (newPasswordHash !== null) {
          const created = await this.users.setPasswordHashIfMissing(
            session.userId,
            newPasswordHash,
            tx,
          );
          if (!created) return failed('password_already_set');
          this.logger.log({ event: 'password_created' });
          return { result: 'password_created' };
        }
        return { result: 'reauthenticated', returnPath: row.returnPath };
      });
    }

    // connect (§9.3).
    if (known) {
      return known.userId === session.userId ? { result: 'connected' } : failed('identity_in_use');
    }
    // Las mismas exigencias de correo que al entrar (decisión 21): nunca se guarda un correo que
    // nadie ha demostrado poseer. Facebook cuenta como verificado si lo envía (R1).
    if (identity.email === null) return failed('email_missing');
    if (!identity.emailVerified) return failed('email_unverified');
    try {
      const providerEmail = identity.email;
      const outcome = await this.withLiveSession(session.userId, tokenHash, (tx) =>
        this.identities.createForConnect(
          session.userId,
          { provider, subject: identity.subject, providerEmail, emailVerified: true },
          tx,
        ),
      );
      // El correo es el de otra cuenta: mensaje genérico, sin revelar el motivo.
      if (outcome === 'email_in_other_account') return failed('connect_refused');
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

  /**
   * Reautenticación confirmada para añadir un proveedor (decisión 21): crea la fila `connect` de
   * ese proveedor, ligada a la misma sesión y con 5 minutos de vida. Esa fila es la confirmación:
   * de un solo uso y sin ningún token aparte en el navegador.
   */
  private async confirmConnect(
    connectProvider: OAuthProvider,
    returnPath: string | null,
    tokenHash: string,
    failed: (reason: OAuthFailureReason) => OAuthCallbackResponse,
    tx: Tx,
  ): Promise<OAuthCallbackResponse> {
    if (!this.clients.has(connectProvider)) return failed('provider_failed');
    const next = await this.createFlow(
      connectProvider,
      {
        purpose: 'connect',
        entryPoint: null,
        sessionTokenHash: tokenHash,
        returnPath,
        ttlMinutes: OAUTH_CONFIRMED_CONNECT_TTL_MINUTES,
      },
      tx,
    );
    this.logger.log({ event: 'connect_confirmed', provider: connectProvider });
    return { result: 'connect_confirmed', next };
  }

  /**
   * Escrituras de la vuelta con sesión (contraseña, identidad, fila `connect`), en una
   * transacción corta abierta después del intercambio con el proveedor, nunca durante él.
   * La sesión se validó antes de ir al proveedor, pero puede haberse cerrado mientras tanto
   * (logout, borrado desde /account, caducidad): sin este bloqueo, la revocación concurrente no
   * impediría crear una forma de entrar. Bloquea primero la cuenta y luego la sesión viva, el
   * mismo orden que el borrado de la cuenta (`users` y en cascada `sessions`), así que no hay
   * interbloqueo; un logout simultáneo espera o ya no deja fila. Sin sesión, `OAUTH_FLOW_INVALID`,
   * como si se hubiera cerrado antes de volver.
   */
  private async withLiveSession<T>(
    userId: string,
    tokenHash: string,
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    return this.transactions.run(async (tx) => {
      await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .for('no key update');
      const [live] = await tx
        .select({ tokenHash: sessions.tokenHash })
        .from(sessions)
        .where(
          and(
            eq(sessions.tokenHash, tokenHash),
            eq(sessions.userId, userId),
            gt(sessions.expiresAt, this.clock.now()),
          ),
        )
        .for('update');
      if (!live) throw flowInvalid();
      return fn(tx);
    });
  }
}
