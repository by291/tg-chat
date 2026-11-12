import type { LocalTrackPublication, RemoteTrack, Room } from 'livekit-client';
import type {
  CallCredentials,
  CallMedia,
  CallMediaEvents,
  CallMode,
  CallVideo,
  DeviceKind,
} from './callModels';

type LiveKit = typeof import('livekit-client');

interface LocalInput {
  track: MediaStreamTrack;
  publication?: LocalTrackPublication;
}

interface RoomConnection {
  sdk: LiveKit;
  room: Room;
}

function mediaCancelled(): DOMException {
  return new DOMException('Call media was released.', 'AbortError');
}

export class LiveKitMedia implements CallMedia {
  private readonly events: CallMediaEvents;
  private readonly inputs = new Map<DeviceKind, LocalInput>();
  private readonly selectedDevices = new Map<DeviceKind, string>();
  private readonly remoteAudio = new Map<RemoteTrack, HTMLAudioElement>();
  private readonly remoteVideo = new Map<RemoteTrack, CallVideo>();
  private readonly capturedTracks = new Set<MediaStreamTrack>();
  private connection?: RoomConnection;
  private isDisposed = false;

  /** Own the captured tracks and one lazy-loaded SDK connection. */
  constructor(events: CallMediaEvents) {
    this.events = events;
  }

  /** Capture only the inputs required for this mode, from an explicit activation. */
  async prepare(mode: CallMode): Promise<void> {
    const stream = await this.capture({ audio: true, video: mode === 'video' });
    const microphone = stream.getAudioTracks()[0];
    const camera = stream.getVideoTracks()[0];
    if (!microphone || (mode === 'video' && !camera)) {
      throw new Error('The required input was unavailable.');
    }

    this.inputs.set('audioinput', { track: microphone });
    if (camera) {
      this.inputs.set('videoinput', { track: camera });
    }
    this.emitVideos();
  }

  /** Join with a short-lived grant and publish the already captured inputs. */
  async join(credentials: CallCredentials): Promise<void> {
    const sdk = await import('livekit-client');
    if (this.isDisposed) {
      throw mediaCancelled();
    }

    const room = new sdk.Room();
    const connection = { sdk, room };
    this.connection = connection;
    this.listen(connection);

    await room.connect(credentials.url, credentials.token);
    for (const [kind, input] of this.inputs) {
      input.publication = await this.publish({ connection, kind, track: input.track });
    }
  }

  /** Stop physical capture synchronously and release SDK and DOM resources. */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }

    this.isDisposed = true;
    for (const track of this.capturedTracks) {
      track.stop();
    }
    this.capturedTracks.clear();
    this.inputs.clear();
    this.selectedDevices.clear();

    for (const track of this.remoteAudio.keys()) {
      this.detachAudio(track);
    }
    this.remoteVideo.clear();
    const room = this.connection?.room;
    this.connection = undefined;
    room?.removeAllListeners();
    void room?.dispose().catch(() => undefined);
  }

  /** Mute the microphone publication while keeping the media connection. */
  async setMuted({ isMuted }: { isMuted: boolean }): Promise<void> {
    const publication = this.inputs.get('audioinput')?.publication;
    if (isMuted) {
      await publication?.mute();
      return;
    }

    await publication?.unmute();
  }

  /** Add or release the camera without changing the microphone publication. */
  async setCamera({ isEnabled }: { isEnabled: boolean }): Promise<void> {
    const connection = this.requireConnection();
    const current = this.inputs.get('videoinput');
    if (isEnabled && !current) {
      await this.enableCamera(connection);
      return;
    }
    if (!isEnabled && current) {
      this.stopTrack(current.track);
      this.inputs.delete('videoinput');
      this.emitVideos();
      await connection.room.localParticipant.unpublishTrack(current.track);
    }
  }

  /** Replace the selected input after successful capture of the replacement. */
  async selectDevice(input: { kind: DeviceKind; deviceId: string }): Promise<void> {
    const { kind, deviceId } = input;
    const current = this.inputs.get(kind);
    if (!current) {
      // Choosing a camera with video off only sets the next explicitly activated device.
      this.selectedDevices.set(kind, deviceId);
      return;
    }
    if (current.track.getSettings().deviceId === deviceId) {
      this.selectedDevices.set(kind, deviceId);
      return;
    }

    const publicationTrack = current.publication?.track;
    if (!publicationTrack) {
      throw new Error('The current input is not publishing.');
    }

    const replacement = await this.captureInput({ kind, deviceId });
    try {
      await publicationTrack.replaceTrack(replacement);
      if (this.isDisposed) {
        throw mediaCancelled();
      }

      this.stopTrack(current.track);
      current.track = replacement;
      this.selectedDevices.set(kind, deviceId);
      this.emitVideos();
    } catch (error) {
      this.stopTrack(replacement);
      throw error;
    }
  }

  /** Read browser input choices after the user has activated media. */
  async listDevices(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === 'audioinput' || device.kind === 'videoinput');
  }

  /** Resume blocked playback with a direct gesture on the call panel. */
  async playAudio(): Promise<void> {
    await this.requireConnection().room.startAudio();
  }

  private requireConnection(): RoomConnection {
    if (!this.connection || this.isDisposed) {
      throw mediaCancelled();
    }
    return this.connection;
  }

  private async capture(constraints: MediaStreamConstraints): Promise<MediaStream> {
    if (this.isDisposed) {
      throw mediaCancelled();
    }

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    for (const track of stream.getTracks()) {
      if (this.isDisposed) {
        // A permission prompt can resolve after logout or after the call was ended.
        track.stop();
      } else {
        this.capturedTracks.add(track);
      }
    }
    if (this.isDisposed) {
      throw mediaCancelled();
    }
    return stream;
  }

  private async captureInput(input: {
    kind: DeviceKind;
    deviceId?: string;
  }): Promise<MediaStreamTrack> {
    const device = input.deviceId ? { deviceId: { exact: input.deviceId } } : true;
    const constraints = input.kind === 'audioinput' ? { audio: device } : { video: device };
    const stream = await this.capture(constraints);
    const track = stream.getTracks()[0];
    if (!track) {
      throw new Error('The selected input was unavailable.');
    }
    return track;
  }

  private stopTrack(track: MediaStreamTrack): void {
    track.stop();
    this.capturedTracks.delete(track);
  }

  private async publish(input: {
    connection: RoomConnection;
    kind: DeviceKind;
    track: MediaStreamTrack;
  }): Promise<LocalTrackPublication> {
    if (this.isDisposed) {
      throw mediaCancelled();
    }

    const { room, sdk } = input.connection;
    const source =
      input.kind === 'audioinput' ? sdk.Track.Source.Microphone : sdk.Track.Source.Camera;
    return room.localParticipant.publishTrack(input.track, { source });
  }

  private async enableCamera(connection: RoomConnection): Promise<void> {
    const kind = 'videoinput';
    const track = await this.captureInput({ kind, deviceId: this.selectedDevices.get(kind) });
    try {
      const publication = await this.publish({ connection, kind, track });
      if (this.isDisposed) {
        throw mediaCancelled();
      }

      this.inputs.set(kind, { track, publication });
      this.emitVideos();
    } catch (error) {
      this.stopTrack(track);
      throw error;
    }
  }

  private listen({ room, sdk }: RoomConnection): void {
    room.on(sdk.RoomEvent.TrackSubscribed, this.attachRemote);
    room.on(sdk.RoomEvent.TrackUnsubscribed, this.detachRemote);
    room.on(sdk.RoomEvent.AudioPlaybackStatusChanged, () => {
      this.events.onAudioBlocked(!room.canPlaybackAudio);
    });
    const reconnecting = () => this.events.onStatus('reconnecting');
    room.on(sdk.RoomEvent.Reconnecting, reconnecting);
    room.on(sdk.RoomEvent.SignalReconnecting, reconnecting);
    room.on(sdk.RoomEvent.Reconnected, () => this.events.onStatus('connected'));
    room.on(sdk.RoomEvent.Disconnected, () => this.events.onStatus('idle'));
  }

  private attachRemote = (track: RemoteTrack): void => {
    if (this.isDisposed) {
      return;
    }

    if (track.kind === 'audio') {
      const audio = document.createElement('audio');
      audio.hidden = true;
      audio.dataset.callAudio = '';
      this.remoteAudio.set(track, audio);
      track.attach(audio);
      document.body.append(audio);
      return;
    }

    const remote = track.mediaStreamTrack;
    this.remoteVideo.set(track, {
      id: remote.id,
      stream: new MediaStream([remote]),
      isLocal: false,
    });
    this.emitVideos();
  };

  private detachRemote = (track: RemoteTrack): void => {
    this.detachAudio(track);
    if (this.remoteVideo.delete(track)) {
      this.emitVideos();
    }
  };

  private detachAudio(track: RemoteTrack): void {
    const audio = this.remoteAudio.get(track);
    if (audio) {
      track.detach(audio);
      audio.remove();
      this.remoteAudio.delete(track);
    }
  }

  private emitVideos(): void {
    const videos = Array.from(this.remoteVideo.values());
    const local = this.inputs.get('videoinput')?.track;
    if (local) {
      videos.push({ id: local.id, stream: new MediaStream([local]), isLocal: true });
    }
    this.events.onVideo(videos);
  }
}
