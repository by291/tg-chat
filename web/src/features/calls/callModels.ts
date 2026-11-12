import type { components } from '@/api/schema';

export type CallAction = components['schemas']['CallAction'];
export type CallEndReason = components['schemas']['CallEndReason'];
export type CallMode = components['schemas']['CallMode'];
export type CallView = components['schemas']['CallView'];

export type CallCredentials = components['schemas']['RoomCredentials'];

export type DeviceKind = 'audioinput' | 'videoinput';
export type MediaStatus =
  'idle' | 'preparing' | 'waiting' | 'joining' | 'connected' | 'reconnecting';

export interface CallVideo {
  id: string;
  stream: MediaStream;
  isLocal: boolean;
}

export interface CallMediaEvents {
  onStatus: (status: MediaStatus) => void;
  onVideo: (videos: CallVideo[]) => void;
  onAudioBlocked: (isBlocked: boolean) => void;
}

export interface CallMedia {
  prepare: (mode: CallMode) => Promise<void>;
  join: (credentials: CallCredentials) => Promise<void>;
  dispose: () => void;
  setCamera: (input: { isEnabled: boolean }) => Promise<void>;
  setMuted: (input: { isMuted: boolean }) => Promise<void>;
  selectDevice: (input: { kind: DeviceKind; deviceId: string }) => Promise<void>;
  listDevices: () => Promise<MediaDeviceInfo[]>;
  playAudio: () => Promise<void>;
}

export interface CallTransport {
  current: (signal: AbortSignal) => Promise<CallView | null>;
  start: (
    input: { conversationId: string; mode: CallMode; operationId: string },
    signal: AbortSignal,
  ) => Promise<CallView>;
  command: (
    input: { callId: string; action: CallAction; operationId: string },
    signal: AbortSignal,
  ) => Promise<CallView>;
  credentials: (callId: string, signal: AbortSignal) => Promise<CallCredentials>;
  outcome: (callId: string, signal: AbortSignal) => Promise<CallEndReason | null>;
}
