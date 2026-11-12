import createClient, { type Client } from 'openapi-fetch';
import { z } from 'zod';
import type { components, paths } from '@/api/schema';

type AuthResponse = components['schemas']['AuthResponse'];
type Login = components['schemas']['Login'];
type Registration = components['schemas']['Registration'];
type Profile = components['schemas']['PrivateProfile'];
type AccountPreferences = components['schemas']['AccountPreferences'];
type AccountPreferenceChanges = components['schemas']['AccountPreferenceChanges'];

const ERROR_RESPONSE = z.object({
  current: z.unknown().optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    request_id: z.string(),
  }),
});

interface OwnerOptions {
  baseUrl: string;
  fetch?: (request: Request) => Promise<Response>;
}

export interface SessionSnapshot {
  auth: AuthResponse | null;
  revision: number;
  preferences?: AccountPreferences;
}

export class ApiError extends Error {
  readonly code: string;
  readonly context?: unknown;
  readonly status?: number;

  /** Preserve a safe machine code alongside the API's user-facing failure description. */
  constructor(options: { code: string; message: string; context?: unknown; status?: number }) {
    super(options.message);
    this.name = 'ApiError';
    this.code = options.code;
    this.context = options.context;
    this.status = options.status;
  }
}

/** Require a documented response body after transport and status validation have succeeded. */
export function requirePayload<T>(reply: { data?: T }): T {
  if (reply.data === undefined) {
    throw new ApiError({
      code: 'invalid_response',
      message: 'The server returned an invalid response.',
    });
  }

  return reply.data;
}

/** Recognize cancelled ownership without presenting a stale error in another account's screen. */
export function isCancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function retainNewestProfile(current: Profile | undefined, incoming: Profile): Profile {
  if (!current || current.id !== incoming.id) {
    return incoming;
  }

  // PostgreSQL versions are decimal strings; Number would lose ordering beyond its safe range.
  if (BigInt(current.version) > BigInt(incoming.version)) {
    return current;
  }

  return incoming;
}

export class SessionOwner {
  readonly client: Client<paths>;
  private snapshot: SessionSnapshot = { auth: null, revision: 0 };
  private controller = new AbortController();
  private readonly listeners = new Set<() => void>();
  private readonly transport: (request: Request) => Promise<Response>;
  private readonly origin: string;
  private channel: BroadcastChannel | null = null;
  private settingsRequest = 0;
  private requestedSettingsVersion?: string;

  /** Scope private requests to one deployment and one in-memory session generation. */
  constructor(options: OwnerOptions) {
    this.origin = new URL(options.baseUrl).origin;
    this.transport = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.client = createClient<paths>({
      baseUrl: this.origin,
      credentials: 'include',
      fetch: (request) => this.fetch(request),
    });
  }

  /** Return a stable snapshot for React's external-store subscription. */
  getSnapshot = (): SessionSnapshot => this.snapshot;

  /** Observe ownership changes without retaining account data in browser persistence. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Listen for another tab changing the shared browser cookie without broadcasting secrets. */
  connectBroadcast(): void {
    if (this.channel || typeof BroadcastChannel === 'undefined') {
      return;
    }

    this.channel = new BroadcastChannel(`tg-chat:session:${this.origin}`);
    this.channel.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data === 'invalidate') {
        this.invalidate({ shouldBroadcast: false });
      }
    };
  }

  /** Release tab resources and cancel private work when the connected application unmounts. */
  dispose(): void {
    this.channel?.close();
    this.channel = null;
    this.invalidate({ shouldBroadcast: false });
  }

  /** Abort old work before publishing an empty account snapshot. */
  invalidate({ shouldBroadcast = true }: { shouldBroadcast?: boolean } = {}): void {
    this.controller.abort();
    this.controller = new AbortController();
    this.requestedSettingsVersion = undefined;
    this.snapshot = { auth: null, revision: this.snapshot.revision + 1 };
    this.notify();
    if (shouldBroadcast) {
      this.channel?.postMessage('invalidate');
    }
  }

  /** Replace ownership after login or password rotation, fencing every previous request. */
  accept(
    grant: AuthResponse,
    { shouldBroadcast = true }: { shouldBroadcast?: boolean } = {},
  ): void {
    const auth = {
      ...grant,
      user: retainNewestProfile(this.snapshot.auth?.user, grant.user),
    };
    this.controller.abort();
    this.controller = new AbortController();
    this.requestedSettingsVersion = undefined;
    this.snapshot = { auth, revision: this.snapshot.revision + 1 };
    this.notify();
    if (shouldBroadcast) {
      this.channel?.postMessage('invalidate');
    }
  }

  /** Refresh an existing cookie session without causing cross-tab invalidation loops. */
  async refresh(): Promise<void> {
    const revision = this.snapshot.revision;
    try {
      const reply = await this.client.GET('/api/v1/auth/session');
      this.ensureCurrent(revision);
      const grant = requirePayload(reply);
      const currentSession = this.snapshot.auth?.session.id;
      if (currentSession !== grant.session.id) {
        this.accept(grant, { shouldBroadcast: false });
        return;
      }
      const auth = {
        ...grant,
        user: retainNewestProfile(this.snapshot.auth?.user, grant.user),
      };
      this.snapshot = { ...this.snapshot, auth };
      this.notify();
    } catch (error) {
      if (isCancelled(error) || (error instanceof ApiError && error.code === 'unauthenticated')) {
        return;
      }
      throw error;
    }
  }

  /** Refresh owner-only preferences and profile after observing a newer account revision. */
  async refreshAccountSettings(version?: string): Promise<void> {
    const revision = this.snapshot.revision;
    if (!this.snapshot.auth) {
      return;
    }
    if (version) {
      const currentVersion = this.snapshot.preferences?.version ?? '0';
      const requestedVersion = this.requestedSettingsVersion ?? '0';
      const isAlreadyObserved = BigInt(currentVersion) >= BigInt(version);
      const isAlreadyRequested = BigInt(requestedVersion) >= BigInt(version);
      if (isAlreadyObserved || isAlreadyRequested) {
        return;
      }
    }

    const requestId = ++this.settingsRequest;
    this.requestedSettingsVersion = version;
    try {
      const response = await this.client.GET('/api/v1/account/preferences');
      this.ensureCurrent(revision);
      if (requestId !== this.settingsRequest) {
        return;
      }

      await this.refresh();
      this.ensureCurrent(revision);
      if (requestId === this.settingsRequest) {
        this.replacePreferences(requirePayload(response));
      }
    } finally {
      if (requestId === this.settingsRequest && revision === this.snapshot.revision) {
        this.requestedSettingsVersion = undefined;
      }
    }
  }

  /** Apply an expected-version change to settings owned by the current session. */
  async updateAccountPreferences(input: AccountPreferenceChanges): Promise<void> {
    const revision = this.snapshot.revision;
    try {
      const response = await this.client.PATCH('/api/v1/account/preferences', { body: input });
      this.ensureCurrent(revision);
      this.replacePreferences(requirePayload(response));
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === 'account_changed') {
        await this.refreshAccountSettings();
      }
      throw failure;
    }
  }

  /** Load optional draft link metadata using the current authenticated browser session. */
  previewLink = async (
    url: string,
    signal: AbortSignal,
  ): Promise<components['schemas']['LinkPreviewView'] | undefined> => {
    const response = await this.client.POST('/api/v1/chat/link-preview', {
      body: { url },
      signal,
    });

    return response.data;
  };

  private replacePreferences(preferences: AccountPreferences): void {
    const current = this.snapshot.preferences;
    // An earlier read may finish after a local update or a newer cross-device refresh.
    if (current && BigInt(current.version) > BigInt(preferences.version)) {
      return;
    }
    this.snapshot = { ...this.snapshot, preferences };
    this.notify();
  }

  /** Admit password credentials and take ownership of the returned opaque-cookie session. */
  async login(input: Login): Promise<void> {
    const revision = this.snapshot.revision;
    const reply = await this.client.POST('/api/v1/auth/login', { body: input });
    this.ensureCurrent(revision);
    this.accept(requirePayload(reply));
  }

  /** Register one account and take ownership only after the server commits admission. */
  async register(input: Registration): Promise<void> {
    const revision = this.snapshot.revision;
    const reply = await this.client.POST('/api/v1/auth/register', { body: input });
    this.ensureCurrent(revision);
    this.accept(requirePayload(reply));
  }

  /** Revoke the cookie session before clearing this tab and notifying its sibling tabs. */
  async logout(): Promise<void> {
    await this.client.POST('/api/v1/auth/logout');
    this.invalidate();
  }

  /** Apply an owner-matching profile without replacing session credentials. */
  replaceProfile(profile: Profile): void {
    const auth = this.snapshot.auth;
    if (!auth || auth.user.id !== profile.id) {
      return;
    }

    const user = retainNewestProfile(auth.user, profile);
    this.snapshot = { ...this.snapshot, auth: { ...auth, user } };
    this.notify();
  }

  private ensureCurrent(revision: number): void {
    if (revision !== this.snapshot.revision) {
      throw new DOMException('Account request cancelled.', 'AbortError');
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private async fetch(original: Request): Promise<Response> {
    const revision = this.snapshot.revision;
    const headers = new Headers(original.headers);
    headers.set('x-tg-chat-request', '1');
    const csrf = this.snapshot.auth?.csrf_token;
    if (csrf) {
      headers.set('x-csrf-token', csrf);
    }
    const request = new Request(original, {
      headers,
      credentials: 'include',
      signal: AbortSignal.any([original.signal, this.controller.signal]),
    });
    let response: Response;
    try {
      response = await this.transport(request);
      // Account endpoints return bounded JSON; finish reading before releasing owned results.
      const body = await response.arrayBuffer();
      const hasBody = response.status !== 204 && response.status !== 205;
      response = new Response(hasBody ? body : null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      if (request.signal.aborted || isCancelled(error)) {
        throw new DOMException('Account request cancelled.', 'AbortError');
      }
      throw new ApiError({
        code: 'network_unavailable',
        message: 'The server could not be reached. Try again.',
      });
    }
    // Abort is advisory; a transport may still resolve after logout or another account's login.
    this.ensureCurrent(revision);
    if (response.ok) {
      return response;
    }

    const encoded = await response
      .clone()
      .json()
      .catch(() => null);
    this.ensureCurrent(revision);
    const parsed = ERROR_RESPONSE.safeParse(encoded);
    const failure = parsed.success
      ? parsed.data.error
      : { code: 'request_failed', message: 'The request could not be completed. Try again.' };
    if (failure.code === 'unauthenticated') {
      this.invalidate();
    }
    throw new ApiError({
      ...failure,
      context: parsed.success ? parsed.data.current : undefined,
      status: response.status,
    });
  }
}
