export type ConnectionStatus = 'ready' | 'waiting' | 'reconnecting' | 'updating';

const connectionLabels: Record<Exclude<ConnectionStatus, 'ready'>, string> = {
  waiting: 'Waiting for network…',
  reconnecting: 'Reconnecting…',
  updating: 'Updating…',
};

/** Describe recovery in a shared voice for the directory and active chat. */
export function connectionStatusLabel(status: ConnectionStatus): string | undefined {
  if (status === 'ready') {
    return undefined;
  }

  return connectionLabels[status];
}
