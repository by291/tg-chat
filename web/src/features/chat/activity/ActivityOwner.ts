import { requirePayload, type SessionOwner } from '@/features/auth/SessionOwner';

const HEARTBEAT_MS = 15_000;
const MAX_ONLINE_MS = 45_000;
const MAX_TYPING_MS = 6_000;
const TYPING_REFRESH_MS = 2_000;
const REQUEST_TIMEOUT_MS = 5_000;

export interface ActivityView {
  conversationId: string;
  peerId: string;
  generation: string;
}

interface ActivitySnapshot {
  view?: ActivityView;
  isOnline: boolean;
  isTyping: boolean;
}

interface ActivityScope {
  view?: ActivityView;
  controller: AbortController;
  isReady: boolean;
  isReading: boolean;
  shouldReadAgain: boolean;
  lastTypingAt?: number;
}

interface ActivityDeadline {
  online: number;
  typing: number;
}

function expiryTime(input: { remaining: number; startedAt: number; maximum: number }): number {
  if (!Number.isFinite(input.remaining) || input.remaining <= 0) {
    return 0;
  }

  // Counting from request start avoids extending a lease when a reply arrives late.
  return input.startedAt + Math.min(input.remaining, input.maximum);
}

export class ActivityOwner {
  private readonly session: SessionOwner;
  private readonly listeners = new Set<() => void>();
  private readonly tabId = crypto.randomUUID();
  private sequence = 0;
  private revision?: number;
  private view?: ActivityView;
  private scope?: ActivityScope;
  private hasPageHidden = false;
  private heartbeatTimer?: ReturnType<typeof setTimeout>;
  private expiryTimer?: ReturnType<typeof setTimeout>;
  private snapshot: ActivitySnapshot = {
    isOnline: false,
    isTyping: false,
  };

  /** Own one tab's activity through the authenticated client's existing session fence. */
  constructor({ session }: { session: SessionOwner }) {
    this.session = session;
  }

  /** Return the latest indicators with their owning view. */
  getSnapshot = (): ActivitySnapshot => this.snapshot;

  /** Observe the current view without retaining any activity outside this tab. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Refresh a foreground lease while the authenticated workspace is open and visible. */
  connect(): () => void {
    const { auth, revision } = this.session.getSnapshot();
    if (!auth || this.revision !== undefined) {
      return () => undefined;
    }

    const removeSessionListener = this.session.subscribe(() => {
      if (!this.isCurrent()) {
        this.view = undefined;
        disconnect();
      }
    });
    const disconnect = () => {
      if (this.revision !== revision) {
        return;
      }

      removeSessionListener();
      document.removeEventListener('visibilitychange', this.onVisibility);
      window.removeEventListener('pagehide', this.onPageHide);
      window.removeEventListener('pageshow', this.onPageShow);
      window.removeEventListener('offline', this.onVisibility);
      window.removeEventListener('online', this.onVisibility);
      const wasForeground = this.resetScope();
      if (wasForeground && this.isCurrent()) {
        this.sendBackground();
      }
      this.revision = undefined;
      this.setIndicators({});
    };

    this.revision = revision;
    this.hasPageHidden = false;
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('pageshow', this.onPageShow);
    window.addEventListener('offline', this.onVisibility);
    window.addEventListener('online', this.onVisibility);
    this.onVisibility();

    return disconnect;
  }

  /** Change the selected direct view and return cleanup scoped to this selection. */
  setView(view?: ActivityView): () => void {
    this.view = view;
    this.onVisibility();
    return () => {
      if (this.view === view) {
        this.view = undefined;
        this.onVisibility();
      }
    };
  }

  /** Refetch the selected peer when a transient personal hint arrives. */
  refresh = (): void => {
    const scope = this.scope;
    if (!scope?.view || !scope.isReady || !this.isCurrent()) {
      return;
    }
    if (scope.isReading) {
      scope.shouldReadAgain = true;
      return;
    }

    void this.readPeer({ scope, view: scope.view });
  };

  /** Publish throttled activity from fresh composer input, with no background refresh loop. */
  recordComposerChange({ isTyping }: { isTyping: boolean }): void {
    const scope = this.scope;
    if (!scope?.view || !scope.isReady || !this.isCurrent()) {
      return;
    }

    const now = performance.now();
    if (isTyping && now - (scope.lastTypingAt ?? -Infinity) < TYPING_REFRESH_MS) {
      return;
    }
    if (!isTyping && scope.lastTypingAt === undefined) {
      return;
    }
    scope.lastTypingAt = isTyping ? now : undefined;

    const request = this.session.client.POST('/api/v1/conversations/{conversation_id}/typing', {
      params: { path: { conversation_id: scope.view.conversationId } },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: {
        tab_id: this.tabId,
        sequence: String(++this.sequence),
        is_typing: isTyping,
      },
    });
    void request.catch(() => undefined);
  }

  private isCurrent(): boolean {
    const { auth, revision } = this.session.getSnapshot();
    return Boolean(auth && revision === this.revision);
  }

  private onPageHide = (): void => {
    this.hasPageHidden = true;
    this.onVisibility();
  };

  private onPageShow = (): void => {
    this.hasPageHidden = false;
    this.onVisibility();
  };

  private onVisibility = (): void => {
    const isForeground =
      this.isCurrent() &&
      document.visibilityState === 'visible' &&
      navigator.onLine &&
      !this.hasPageHidden;
    if (isForeground && this.scope && this.scope.view === this.view) {
      return;
    }

    const wasForeground = this.resetScope();
    this.setIndicators({ view: this.view });
    if (!isForeground) {
      if (wasForeground && this.isCurrent()) {
        this.sendBackground();
      }
      return;
    }

    const scope: ActivityScope = {
      view: this.view,
      controller: new AbortController(),
      isReady: false,
      isReading: false,
      shouldReadAgain: false,
    };
    this.scope = scope;
    void this.heartbeat(scope);
  };

  private resetScope(): boolean {
    const hadScope = this.scope !== undefined;
    this.scope?.controller.abort();
    this.scope = undefined;
    clearTimeout(this.heartbeatTimer);
    clearTimeout(this.expiryTimer);

    return hadScope;
  }

  private async heartbeat(scope: ActivityScope): Promise<void> {
    this.heartbeatTimer = setTimeout(() => void this.heartbeat(scope), HEARTBEAT_MS);
    try {
      await this.session.client.POST('/api/v1/activity/heartbeat', {
        body: {
          tab_id: this.tabId,
          sequence: String(++this.sequence),
          is_foreground: true,
          conversation_id: scope.view?.conversationId,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (scope === this.scope && this.isCurrent()) {
        scope.isReady = true;
        this.refresh();
      }
    } catch {
      if (scope === this.scope && this.isCurrent()) {
        scope.isReady = false;
        clearTimeout(this.expiryTimer);
        this.setIndicators({ view: scope.view });
      }
    }
  }

  private sendBackground(): void {
    // The ordered stop may outlive navigation. Expiry covers a stop the browser cannot send.
    const request = this.session.client.POST('/api/v1/activity/heartbeat', {
      body: {
        tab_id: this.tabId,
        sequence: String(++this.sequence),
        is_foreground: false,
      },
      keepalive: true,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    void request.catch(() => undefined);
  }

  private async readPeer(input: { scope: ActivityScope; view: ActivityView }): Promise<void> {
    const { scope, view } = input;
    scope.isReading = true;
    const startedAt = performance.now();
    try {
      const reply = await this.session.client.GET('/api/v1/activity/presence/{user_id}', {
        params: {
          path: { user_id: view.peerId },
          query: { conversation_id: view.conversationId, tab_id: this.tabId },
        },
        signal: AbortSignal.any([scope.controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      });
      if (scope !== this.scope || !scope.isReady || !this.isCurrent()) {
        return;
      }

      const presence = requirePayload(reply);
      const deadline = {
        online: expiryTime({
          remaining: presence.online_for_ms,
          startedAt,
          maximum: MAX_ONLINE_MS,
        }),
        typing: expiryTime({
          remaining: presence.typing_for_ms,
          startedAt,
          maximum: MAX_TYPING_MS,
        }),
      };
      this.showUntil({ scope, deadline });
    } catch {
      if (scope === this.scope && this.isCurrent()) {
        clearTimeout(this.expiryTimer);
        this.setIndicators({ view });
      }
    } finally {
      scope.isReading = false;
      if (scope === this.scope && scope.shouldReadAgain) {
        scope.shouldReadAgain = false;
        this.refresh();
      }
    }
  }

  private showUntil(input: { scope: ActivityScope; deadline: ActivityDeadline }): void {
    const { scope, deadline } = input;
    if (scope !== this.scope || !scope.isReady || !this.isCurrent()) {
      return;
    }
    const now = performance.now();
    const isOnline = deadline.online > now;
    const isTyping = deadline.typing > now;
    this.setIndicators({ view: scope.view, isOnline, isTyping });

    clearTimeout(this.expiryTimer);
    const nextExpiry = Math.min(
      isOnline ? deadline.online : Infinity,
      isTyping ? deadline.typing : Infinity,
    );
    if (Number.isFinite(nextExpiry)) {
      const delay = Math.ceil(nextExpiry - now);
      this.expiryTimer = setTimeout(() => this.showUntil(input), delay);
    }
  }

  private setIndicators(input: Partial<ActivitySnapshot>): void {
    const { view, isOnline = false, isTyping = false } = input;
    if (
      this.snapshot.view === view &&
      this.snapshot.isOnline === isOnline &&
      this.snapshot.isTyping === isTyping
    ) {
      return;
    }

    this.snapshot = view ? { view, isOnline, isTyping } : { isOnline, isTyping };
    for (const listener of this.listeners) {
      listener();
    }
  }
}
