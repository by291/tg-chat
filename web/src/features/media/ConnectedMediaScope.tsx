import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Message } from '@/domain/messages/message';
import type { ChatOwner } from '@/features/chat/data/ChatOwner';
import {
  ConnectedMediaContext,
  type ConnectedMediaActions,
  type GallerySelection,
} from './ConnectedMediaContext';
import {
  galleryMessage,
  isVisualKind,
  mediaSourceId,
  previewVariant,
  urlFor,
  type MediaReference,
} from './connectedMediaReference';
import { MediaViewer } from './MediaViewer';

type MediaActions = Omit<ConnectedMediaActions, 'openGallery'>;

interface GalleryRequest extends GallerySelection {
  owner: ChatOwner;
  session: MediaActions['session'];
  scope: string;
  revision: number;
}

interface GalleryResult {
  message?: Message;
  error?: string;
}

interface GalleryEntry {
  reference: MediaReference;
  placeholder: Message;
}

async function loadOccurrence(entry: GalleryEntry, signal: AbortSignal): Promise<Message> {
  const { reference, placeholder } = entry;
  const variant = previewVariant(reference.attachment);
  const preview = await urlFor({
    reference,
    variant,
    signal,
  });
  // Keep the original signer stable while the same occurrence gains its renderable URLs.
  if (placeholder.attachment) {
    return { ...placeholder, attachment: { ...placeholder.attachment, url: preview } };
  }

  const video = placeholder.media;
  if (video?.kind !== 'video') {
    throw new Error('Unsupported gallery media.');
  }
  const playback = await urlFor({
    reference,
    variant: 'playback',
    signal,
  });
  return {
    ...placeholder,
    media: {
      ...video,
      url: playback,
      poster: preview,
    },
  };
}

function GallerySession({
  request,
  actions,
  onDiscard,
}: {
  request: GalleryRequest;
  actions: MediaActions;
  onDiscard: () => void;
}) {
  const selectedId = mediaSourceId(request.message.id, request.occurrenceId);
  const [activeId, setActiveId] = useState(selectedId);
  const [isOpen, setIsOpen] = useState(true);
  const [results, setResults] = useState<Record<string, GalleryResult>>({});
  const lifetime = useRef<AbortController>(undefined);
  const entries = useMemo(() => {
    const visual = request.message.remoteAttachments?.filter((attachment) => {
      return isVisualKind(attachment.file.kind);
    });
    return (visual ?? []).map((attachment) => {
      const reference = {
        session: request.session,
        message: request.message,
        attachment,
      };
      return { reference, placeholder: galleryMessage(reference) };
    });
  }, [request]);

  function load(entry: GalleryEntry, signal: AbortSignal) {
    const id = entry.placeholder.id;
    function publish(result: GalleryResult) {
      // Uncooperative transports may complete after navigation, close, or a session change.
      if (!signal.aborted) {
        setResults((current) => ({ ...current, [id]: result }));
      }
    }
    void loadOccurrence(entry, signal).then(
      (message) => publish({ message }),
      (failure: unknown) => {
        const error = failure instanceof Error ? failure.message : 'Media unavailable.';
        publish({ error });
      },
    );
  }

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    // Start the clicked occurrence first. Each neighbor publishes independently.
    const selected = entries.find((entry) => entry.placeholder.id === selectedId);
    if (selected) {
      load(selected, controller.signal);
    }
    for (const entry of entries) {
      if (entry !== selected) {
        load(entry, controller.signal);
      }
    }
    return () => controller.abort();
  }, [entries, selectedId]);

  function close() {
    lifetime.current?.abort();
    setIsOpen(false);
  }
  const messages = entries.map(
    (entry) => results[entry.placeholder.id]?.message ?? entry.placeholder,
  );
  const active = entries.find((entry) => entry.placeholder.id === activeId);
  const result = results[activeId];
  function retryActive() {
    const signal = lifetime.current?.signal;
    if (!active || !signal || signal.aborted) {
      return;
    }
    setResults((current) => ({ ...current, [active.placeholder.id]: {} }));
    load(active, signal);
  }
  const loadState =
    active && !result?.message ? { error: result?.error, retry: retryActive } : undefined;

  return (
    <MediaViewer
      message={isOpen ? messages.find((message) => message.id === activeId) : undefined}
      messages={messages}
      loadState={loadState}
      onClose={close}
      onExitComplete={onDiscard}
      onNavigate={(message) => setActiveId(message.id)}
      onCommand={({ action }) => {
        if (action === 'go-to-message') {
          close();
          actions.jump(request.message.id);
        }
      }}
      onNotify={actions.notify}
    />
  );
}

/** Own the authenticated viewer independently of the virtual history rows that open it. */
export function ConnectedMediaScope({
  actions,
  owner,
  scope,
  children,
  canShowGallery,
}: {
  actions?: MediaActions;
  owner: ChatOwner;
  scope: string;
  children: ReactNode;
  canShowGallery: boolean;
}) {
  const [request, setRequest] = useState<GalleryRequest>();
  const revision = useRef(0);
  const hasAccess =
    canShowGallery &&
    request &&
    actions &&
    request.owner === owner &&
    request.session === actions.session &&
    request.scope === scope;

  useLayoutEffect(
    () => {
      if (!request) {
        return;
      }
      if (!hasAccess) {
        setRequest(undefined);
        return;
      }
      // Deletion and expiry revoke a retained viewer even after history pagination drops its row.
      return owner.observeMediaRemoval({
        message: request.message,
        revoke: () => setRequest(undefined),
      });
    },
    // prettier-ignore
    [
      owner,
      request,
      hasAccess,
    ],
  );

  const value = actions && {
    ...actions,
    openGallery: (selection: GallerySelection) => {
      revision.current += 1;
      setRequest({
        ...selection,
        owner,
        session: actions.session,
        scope,
        revision: revision.current,
      });
    },
  };
  return (
    <ConnectedMediaContext.Provider value={value}>
      {children}
      {request && actions && hasAccess && (
        <GallerySession
          key={request.revision}
          request={request}
          actions={actions}
          onDiscard={() => setRequest((current) => (current === request ? undefined : current))}
        />
      )}
    </ConnectedMediaContext.Provider>
  );
}
