import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { BrowserPushOwner } from '@/features/settings/notifications/BrowserPushOwner';
import type { SessionOwner } from '../auth/SessionOwner';
import { ActivityOwner } from '../chat/activity/ActivityOwner';
import { ChatOwner, type ChatSnapshot } from '../chat/data/ChatOwner';
import { createBrowserCallOwner } from '../calls/browserCallOwner';
import { isCallSupported } from '../calls/callTabOwner';

interface ChatConnection {
  owner: ChatOwner;
  retry: () => void;
}

type ChatStartup = Pick<ChatSnapshot, 'isReady' | 'connectionStatus' | 'startupError'>;

const READY_CHAT: ChatStartup = { isReady: true, connectionStatus: 'ready' };

interface WorkspaceConnectionsOptions {
  owner: SessionOwner;
  revision: ReturnType<SessionOwner['getSnapshot']>['revision'];
  areCallsAvailable: boolean;
  isMessagingAvailable: boolean;
}

const subscribeBeforeChat = () => () => undefined;

/** Connect session-owned browser services for the lifetime of the authenticated workspace. */
export function useWorkspaceConnections({
  owner,
  revision,
  areCallsAvailable,
  isMessagingAvailable,
}: WorkspaceConnectionsOptions) {
  const [chatConnection, setChatConnection] = useState<ChatConnection>();
  const getStartupSnapshot = useCallback((): ChatStartup | undefined => {
    const snapshot = chatConnection?.owner.getSnapshot();
    // The connected page subscribes directly once the account shell has finished bootstrapping.
    return snapshot?.isReady ? READY_CHAT : snapshot;
  }, [chatConnection]);
  const startup = useSyncExternalStore(
    chatConnection?.owner.subscribe ?? subscribeBeforeChat,
    getStartupSnapshot,
  );
  const chat = isMessagingAvailable && startup?.isReady ? chatConnection?.owner : undefined;
  const [activity] = useState(() => new ActivityOwner({ session: owner }));
  const [push] = useState(() => new BrowserPushOwner({ session: owner }));
  const [calls] = useState(() => createBrowserCallOwner(owner));
  const canUseCalls = areCallsAvailable && isCallSupported();

  useEffect(() => activity.connect(), [activity, revision]);
  useEffect(() => push.connect(), [push, revision]);
  useEffect(() => {
    if (canUseCalls) {
      return calls.connect();
    }
  }, [calls, canUseCalls, revision]);

  useEffect(() => {
    if (!isMessagingAvailable) {
      return;
    }

    const connected = new ChatOwner({ session: owner });
    const { disconnect, retry } = connected.connect({
      onActivityHint: activity.refresh,
      onCallHint: canUseCalls ? () => void calls.refresh() : undefined,
    });
    setChatConnection({ owner: connected, retry });

    return () => {
      disconnect();
      connected.dispose();
    };
  }, [activity, owner, revision, isMessagingAvailable, canUseCalls, calls]);

  return {
    activity,
    push,
    calls,
    canUseCalls,
    chat,
    startup,
    retryChat: chatConnection?.retry,
  };
}
