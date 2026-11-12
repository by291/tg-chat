import { ApiError, isCancelled } from '@/features/auth/SessionOwner';
import type {
  CallAction,
  CallEndReason,
  CallMedia,
  CallMediaEvents,
  CallMode,
  CallTransport,
  CallVideo,
  CallView,
  DeviceKind,
  MediaStatus,
} from './callModels';
import type { CallTabRequest } from './callTabOwner';

const POLL_INTERVAL_MS = 5_000;

interface SessionIdentity {
  id: string;
  revision: number;
}

interface CallOptions {
  transport: CallTransport;
  getSession: () => SessionIdentity | undefined;
  subscribeSession: (listener: () => void) => () => void;
  ownTab: (request: CallTabRequest) => Promise<void>;
  createMedia: (events: CallMediaEvents) => CallMedia;
}

interface CallSnapshot {
  call?: CallView;
  isBusy: boolean;
  ownsTab: boolean;
  mediaStatus: MediaStatus;
  isMuted: boolean;
  isCameraOn: boolean;
  isAudioBlocked: boolean;
  isMediaControlBusy: boolean;
  videos: CallVideo[];
  devices: MediaDeviceInfo[];
  selectedDevices: Partial<Record<DeviceKind, string>>;
  error?: string;
}

interface SessionScope extends SessionIdentity {
  controller: AbortController;
  isPageHidden: boolean;
  refresh?: Promise<void>;
  version: number;
  lastCallId?: string;
  outcomeRetry?: OutcomeLookup;
  retry?: { key: string; id: string };
}

interface OutcomeLookup {
  callId: string;
  version: number;
  shouldRetry: boolean;
}

interface CallScope {
  id: string;
  controller: AbortController;
  media?: CallMedia;
  isJoining: boolean;
}

const EMPTY_SNAPSHOT: CallSnapshot = {
  isBusy: false,
  ownsTab: false,
  mediaStatus: 'idle',
  isMuted: false,
  isCameraOn: false,
  isAudioBlocked: false,
  isMediaControlBusy: false,
  videos: [],
  devices: [],
  selectedDevices: {},
};

const END_ERRORS: Partial<Record<CallEndReason, string>> = {
  permission_denied: 'Microphone or camera permission was denied.',
  transport_failed: 'The call connection timed out.',
  access_revoked: 'Access to this call ended.',
};

function describeError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function isPermissionError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotAllowedError';
}

function isMediaPhase(call: CallView): boolean {
  return call.allowed_actions.includes('hangup');
}

export class CallOwner {
  private readonly options: CallOptions;
  private readonly listeners = new Set<() => void>();
  private snapshot = EMPTY_SNAPSHOT;
  private session?: SessionScope;
  private call?: CallScope;

  /** Own one authenticated call UI and one optional media connection. */
  constructor(options: CallOptions) {
    this.options = options;
  }

  /** Read the immutable UI state for this browser tab. */
  getSnapshot = (): CallSnapshot => this.snapshot;

  /** Read only the occupancy flag so chat navigation ignores media updates. */
  isCallBusy = (): boolean => Boolean(this.snapshot.call || this.snapshot.isBusy);

  /** Observe local call state and controls. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Poll current state and immediately dispose on session loss or page exit. */
  connect(): () => void {
    const identity = this.options.getSession();
    if (!identity || this.session) {
      return () => undefined;
    }

    const session: SessionScope = {
      ...identity,
      version: 0,
      controller: new AbortController(),
      isPageHidden: false,
    };
    this.session = session;
    const timer = window.setInterval(this.wake, POLL_INTERVAL_MS);
    const unsubscribe = this.options.subscribeSession(() => {
      if (!this.ownsSession(session)) {
        disconnect();
      }
    });

    const releasePage = () => {
      // A cached page may return, but must reacquire its call lease and media explicitly.
      session.isPageHidden = true;
      session.version += 1;
      this.releaseCall();
      this.setSnapshot(EMPTY_SNAPSHOT);
    };
    const restorePage = () => {
      if (!session.isPageHidden) {
        return;
      }
      session.isPageHidden = false;
      void Promise.resolve(session.refresh).then(this.wake);
    };
    const disconnect = () => {
      if (this.session !== session) {
        return;
      }

      this.session = undefined;
      session.controller.abort();
      unsubscribe();
      window.clearInterval(timer);
      window.removeEventListener('focus', this.wake);
      window.removeEventListener('online', this.wake);
      window.removeEventListener('pagehide', releasePage);
      window.removeEventListener('pageshow', restorePage);
      this.releaseCall();
      this.setSnapshot(EMPTY_SNAPSHOT);
    };

    window.addEventListener('focus', this.wake);
    window.addEventListener('online', this.wake);
    window.addEventListener('pagehide', releasePage);
    window.addEventListener('pageshow', restorePage);
    this.wake();
    return disconnect;
  }

  /** Read the authoritative snapshot when a hint, timer, focus, or reconnect wakes the tab. */
  refresh = async (): Promise<void> => {
    const session = this.session;
    if (!session || !this.ownsSession(session) || session.isPageHidden) {
      return;
    }
    if (session.refresh) {
      return session.refresh;
    }

    const outcomeRetry = session.outcomeRetry;
    session.outcomeRetry = undefined;
    const version = session.version;
    const request = this.readCurrent({ session, version });
    session.refresh = request;
    try {
      await request;
      if (outcomeRetry) {
        void this.readOutcome(session, outcomeRetry);
      }
    } finally {
      session.refresh = undefined;
    }
  };

  /** Start a call with a replayable operation ID for an ambiguous network result. */
  async start(input: { conversationId: string; mode: CallMode }): Promise<void> {
    if (this.isCallBusy()) {
      return;
    }

    await this.mutate({
      key: `start:${input.conversationId}:${input.mode}`,
      send: (operationId, signal) =>
        this.options.transport.start({ ...input, operationId }, signal),
    });
  }

  /** Apply an allowed action from the tab holding the current call lease. */
  async command(action: CallAction): Promise<void> {
    const { call, ownsTab } = this.snapshot;
    if (!call || !ownsTab || !call.allowed_actions.includes(action)) {
      return;
    }

    const scope = this.call;
    await this.mutate({
      key: `${call.id}:${action}`,
      beforeSend: () => {
        // End local capture even when the server acknowledgement is delayed.
        if (action === 'hangup' && scope?.media) {
          this.resetMedia(scope);
        }
      },
      callId: call.id,
      send: (operationId, signal) =>
        this.options.transport.command({ callId: call.id, action, operationId }, signal),
    });
  }

  /** Request the required physical devices only after a button press. */
  async activateMedia(): Promise<void> {
    const { call, ownsTab, mediaStatus } = this.snapshot;
    const scope = this.call;
    const canActivate = !this.snapshot.isBusy && ownsTab && mediaStatus === 'idle';
    if (!call || !scope || !canActivate || !isMediaPhase(call)) {
      return;
    }

    const media = this.options.createMedia({
      onStatus: (status) => this.updateMediaStatus({ scope, status }),
      onVideo: (videos) => this.updateMedia({ scope, patch: { videos } }),
      onAudioBlocked: (isAudioBlocked) => this.updateMedia({ scope, patch: { isAudioBlocked } }),
    });
    scope.media = media;
    this.patch({ error: undefined, mediaStatus: 'preparing' });

    try {
      await media.prepare(call.mode);
    } catch (error) {
      if (this.call === scope) {
        await this.failInitialMedia(error);
      }
      return;
    }

    if (this.call !== scope) {
      return;
    }
    this.patch({ mediaStatus: 'waiting', isCameraOn: call.mode === 'video' });
    void this.loadDevices(scope);
    await this.joinMedia();
  }

  /** Toggle microphone publishing without closing the room. */
  async toggleMute(): Promise<void> {
    const isMuted = !this.snapshot.isMuted;
    await this.controlMedia({
      run: (media) => media.setMuted({ isMuted }),
      patch: { isMuted },
      error: 'The microphone could not be changed.',
    });
  }

  /** Toggle optional video while preserving the voice connection on permission failure. */
  async toggleCamera(): Promise<void> {
    const isEnabled = !this.snapshot.isCameraOn;
    await this.controlMedia({
      run: (media) => media.setCamera({ isEnabled }),
      patch: { isCameraOn: isEnabled },
      error: 'The camera could not be accessed. Check its permissions and try again.',
    });
    const scope = this.call;
    if (scope) {
      void this.loadDevices(scope);
    }
  }

  /** Switch one input for the current call. */
  async selectDevice(input: { kind: DeviceKind; deviceId: string }): Promise<void> {
    await this.controlMedia({
      run: (media) => media.selectDevice(input),
      patch: {
        selectedDevices: { ...this.snapshot.selectedDevices, [input.kind]: input.deviceId },
      },
      error: 'The selected device could not be used.',
    });
  }

  /** Resume remote audio if browser playback policy requires a gesture. */
  async playAudio(): Promise<void> {
    await this.controlMedia({
      run: (media) => media.playAudio(),
      patch: { isAudioBlocked: false },
      error: 'Call audio could not be played.',
    });
  }

  /** Dismiss a call result or a failed start once there is no ongoing call. */
  dismiss(): void {
    if (this.snapshot.call) {
      return;
    }

    if (this.session) {
      this.session.lastCallId = undefined;
    }
    this.patch({ error: undefined });
  }

  private wake = () => {
    void this.refresh();
  };

  private ownsSession(session: SessionScope): boolean {
    const current = this.options.getSession();
    return (
      this.session === session &&
      current?.id === session.id &&
      current.revision === session.revision
    );
  }

  private async readCurrent(input: { session: SessionScope; version: number }): Promise<void> {
    const { session, version } = input;

    try {
      const current = await this.options.transport.current(session.controller.signal);
      if (this.ownsSession(session) && session.version === version && !this.snapshot.isBusy) {
        this.applyCall(current);
      }
    } catch {
      // A missed refresh is retried by the poll and never tears down healthy media.
    }
  }

  private async mutate(input: {
    key: string;
    callId?: string;
    beforeSend?: () => void;
    send: (operationId: string, signal: AbortSignal) => Promise<CallView>;
  }): Promise<void> {
    const session = this.session;
    const canMutate = session && !session.isPageHidden && !this.snapshot.isBusy;
    if (!canMutate || !this.ownsSession(session)) {
      return;
    }

    const operationId = session.retry?.key === input.key ? session.retry.id : crypto.randomUUID();
    const version = ++session.version;
    const ownsMutation = () => this.ownsSession(session) && session.version === version;
    this.patch({ isBusy: true, error: undefined });
    try {
      input.beforeSend?.();
      const current = await input.send(operationId, session.controller.signal);
      if (ownsMutation() && (!input.callId || this.call?.id === input.callId)) {
        session.retry = undefined;
        this.applyCall(current);
      }
    } catch (error) {
      if (!ownsMutation()) {
        return;
      }

      const isNetworkFailure = error instanceof ApiError && error.code === 'network_unavailable';
      const didTimeOut = isCancelled(error);
      const canReplay = isNetworkFailure || didTimeOut;
      session.retry = canReplay ? { key: input.key, id: operationId } : undefined;
      const fallback = didTimeOut
        ? 'The call action timed out. Try again.'
        : 'The call action failed. Try again.';
      this.patch({ error: describeError(error, fallback) });
    } finally {
      if (ownsMutation()) {
        session.version += 1;
        this.patch({ isBusy: false });
        // A read started before this command cannot confirm the state after it.
        void Promise.resolve(session.refresh).then(this.wake);
      }
    }
  }

  private applyCall(current: CallView | null): void {
    const previous = this.snapshot.call;
    if (current && previous?.id === current.id) {
      if (BigInt(current.revision) < BigInt(previous.revision)) {
        return;
      }
    }

    if (current?.phase === 'ended') {
      this.releaseCall();
      const error = current.end_reason ? END_ERRORS[current.end_reason] : undefined;
      this.setSnapshot({ ...EMPTY_SNAPSHOT, isBusy: this.snapshot.isBusy, error });
      return;
    }
    if (!current?.allowed_actions.length) {
      if (previous) {
        this.clearCurrent(previous);
      }
      return;
    }
    if (this.call?.id !== current.id) {
      this.releaseCall();
      if (this.session) {
        this.session.lastCallId = current.id;
      }
      const scope = { id: current.id, controller: new AbortController(), isJoining: false };
      this.call = scope;
      this.setSnapshot({ ...EMPTY_SNAPSHOT, call: current, isBusy: this.snapshot.isBusy });
      this.acquireTab(scope);
      return;
    }

    this.patch({ call: current });
    void this.joinMedia();
  }

  private clearCurrent(previous: CallView): void {
    const { isBusy, error, ownsTab } = this.snapshot;
    const session = this.session;
    const isDesignated = previous.direction === 'outgoing' || isMediaPhase(previous);
    this.releaseCall();
    this.setSnapshot({ ...EMPTY_SNAPSHOT, isBusy, error });

    // The terminal query is advisory. Local tracks must stop as soon as the live view ends.
    if (session && ownsTab && isDesignated) {
      void this.readOutcome(session, {
        version: session.version,
        callId: previous.id,
        shouldRetry: true,
      });
    }
  }

  private async readOutcome(session: SessionScope, lookup: OutcomeLookup): Promise<void> {
    if (!this.ownsOutcome(session, lookup)) {
      return;
    }

    try {
      const outcome = await this.options.transport.outcome(
        lookup.callId,
        session.controller.signal,
      );
      if (!this.ownsOutcome(session, lookup)) {
        return;
      }

      if (!outcome) {
        // The snapshot may hide a deadline before the Worker records the terminal reason.
        if (lookup.shouldRetry) {
          session.outcomeRetry = { ...lookup, shouldRetry: false };
        }
        return;
      }

      const error = END_ERRORS[outcome];
      if (error) {
        this.patch({ error });
      }
    } catch {
      // Access loss or a failed outcome lookup leaves history authoritative.
    }
  }

  private ownsOutcome(session: SessionScope, lookup: OutcomeLookup): boolean {
    return (
      this.ownsSession(session) &&
      session.version === lookup.version &&
      session.lastCallId === lookup.callId &&
      !this.snapshot.call
    );
  }

  private acquireTab(scope: CallScope): void {
    const session = this.session;
    if (!session) {
      return;
    }

    const signal = scope.controller.signal;
    void this.options
      .ownTab({
        sessionId: session.id,
        callId: scope.id,
        signal,
        activate: async () => {
          if (this.call !== scope || !this.ownsSession(session)) {
            return;
          }

          const released = new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => resolve(), { once: true });
          });
          this.patch({ ownsTab: true });
          await released;
        },
      })
      .catch((error: unknown) => {
        if (this.call === scope && !isCancelled(error)) {
          this.patch({ error: 'This tab could not take ownership of the call.' });
        }
      });
  }

  private releaseCall(): void {
    const scope = this.call;
    this.call = undefined;
    scope?.media?.dispose();
    scope?.controller.abort();
  }

  private async joinMedia(): Promise<void> {
    const { call, mediaStatus } = this.snapshot;
    const scope = this.call;
    const session = this.session;
    const media = scope?.media;
    const isReady = call?.is_room_ready && isMediaPhase(call);
    const canJoin =
      isReady && mediaStatus === 'waiting' && !scope?.isJoining && !this.snapshot.isBusy;
    if (!session || !scope || !media || !call || !canJoin || !this.ownsSession(session)) {
      return;
    }

    scope.isJoining = true;
    let hasNewRevision = false;
    try {
      const credentials = await this.options.transport.credentials(
        call.id,
        scope.controller.signal,
      );
      if (!this.ownsSession(session) || this.call !== scope || scope.media !== media) {
        return;
      }
      hasNewRevision = this.snapshot.call?.revision !== call.revision;
      if (hasNewRevision) {
        return;
      }

      this.patch({ mediaStatus: 'joining', error: undefined });
      await media.join(credentials);
      if (this.call === scope && scope.media === media) {
        this.patch({ mediaStatus: 'connected' });
      }
    } catch (error) {
      if (this.call !== scope || scope.media !== media) {
        return;
      }
      if (this.snapshot.mediaStatus === 'waiting') {
        this.reportCredentialFailure(error);
        return;
      }

      this.resetMedia(scope);
      this.patch({ error: 'The media connection failed. Try joining the call again.' });
    } finally {
      scope.isJoining = false;
      if (hasNewRevision && this.call === scope) {
        void this.joinMedia();
      }
    }
  }

  private reportCredentialFailure(error: unknown): void {
    if (error instanceof ApiError && error.code === 'call_room_pending') {
      return;
    }

    this.patch({ error: describeError(error, 'The media connection could not be prepared.') });
  }

  private async failInitialMedia(error: unknown): Promise<void> {
    const scope = this.call;
    if (!scope) {
      return;
    }

    this.resetMedia(scope);
    const message = isPermissionError(error)
      ? 'Microphone or camera permission was denied.'
      : 'The required microphone or camera could not be accessed.';
    const actions = this.snapshot.call?.allowed_actions;
    if (actions?.includes('media_permission_denied')) {
      await this.command('media_permission_denied');
    }
    if (!this.call || this.call === scope) {
      this.patch({ error: message });
    }
  }

  private updateMediaStatus(input: { scope: CallScope; status: MediaStatus }): void {
    if (this.call !== input.scope || !input.scope.media) {
      return;
    }
    if (input.status === 'idle') {
      // LiveKit has exhausted reconnection. A fresh join requires explicit capture again.
      this.resetMedia(input.scope);
      this.patch({ error: 'The media connection was lost. Rejoin before the call ends.' });
      this.wake();
      return;
    }

    this.patch({ mediaStatus: input.status });
  }

  private updateMedia(input: { scope: CallScope; patch: Partial<CallSnapshot> }): void {
    if (this.call === input.scope && input.scope.media) {
      this.patch(input.patch);
    }
  }

  private resetMedia(scope: CallScope): void {
    const media = scope.media;
    scope.media = undefined;
    media?.dispose();
    this.patch({
      mediaStatus: 'idle',
      videos: [],
      devices: [],
      selectedDevices: {},
      isMuted: false,
      isCameraOn: false,
      isAudioBlocked: false,
      isMediaControlBusy: false,
    });
  }

  private async loadDevices(scope: CallScope): Promise<void> {
    const media = scope.media;
    try {
      const devices = await media?.listDevices();
      if (devices && this.call === scope && scope.media === media) {
        this.patch({ devices });
      }
    } catch {
      // Browser privacy settings may hide device enumeration while media still works.
    }
  }

  private async controlMedia(input: {
    run: (media: CallMedia) => Promise<void>;
    patch?: Partial<CallSnapshot>;
    error: string;
  }): Promise<void> {
    const scope = this.call;
    const media = scope?.media;
    if (!media || this.snapshot.mediaStatus !== 'connected' || this.snapshot.isMediaControlBusy) {
      return;
    }

    this.patch({ isMediaControlBusy: true, error: undefined });
    try {
      await input.run(media);
      if (this.call === scope && scope.media === media) {
        this.patch(input.patch ?? {});
      }
    } catch {
      if (this.call === scope && scope.media === media) {
        this.patch({ error: input.error });
      }
    } finally {
      if (this.call === scope && scope.media === media) {
        this.patch({ isMediaControlBusy: false });
      }
    }
  }

  private patch(patch: Partial<CallSnapshot>): void {
    this.setSnapshot({ ...this.snapshot, ...patch });
  }

  private setSnapshot(snapshot: CallSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) {
      listener();
    }
  }
}
