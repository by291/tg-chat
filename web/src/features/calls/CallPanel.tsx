import { ChevronDown, Maximize, Minimize, X } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import { useHandheldLayout } from '@/layouts/chat/useHandheldLayout';
import { CallCompactBar } from './CallCompactBar';
import { callPresentation, CallIdentity } from './CallIdentity';
import type { CallOwner } from './CallOwner';
import type { CallVideo, CallView } from './callModels';
import { CallControls, type CallControlsProps } from './CallControls';
import { CallDeviceSettings } from './CallDeviceSettings';
import { CallGradient } from './CallGradient';
import { useCallFullscreen } from './useCallFullscreen';
import styles from './CallPanel.module.css';

const RINGTONE_SOURCE = {
  incoming: '/assets/audio/call-incoming.wav',
  outgoing: '/assets/audio/call-outgoing.wav',
};

interface CallPanelProps {
  owner: CallOwner;
  onCoverageChange?: (coverage: { isCovered: boolean }) => void;
}

interface ExpandedCallProps extends CallControlsProps {
  onCoverageChange?: CallPanelProps['onCoverageChange'];
  call: CallView;
  isCompact: boolean;
  mediaId: string;
  collapseRef: RefObject<HTMLButtonElement | null>;
  onCollapse: () => void;
}

function CallVideoTile({ video }: { video: CallVideo }) {
  const element = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const current = element.current;
    if (!current) {
      return;
    }

    current.srcObject = video.stream;
    return () => {
      current.srcObject = null;
    };
  }, [video.stream]);

  return (
    <video
      ref={element}
      aria-label={video.isLocal ? 'Your camera' : 'Peer camera'}
      className={styles.video}
      data-local={video.isLocal || undefined}
      data-mirrored={video.isMirrored || undefined}
      autoPlay
      playsInline
      muted
    />
  );
}

/** Keep the call accessible from any authenticated workspace page. */
export function CallPanel({ owner, onCoverageChange }: CallPanelProps) {
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot);
  const { call, ownsTab, isBusy, error } = snapshot;
  const mediaId = useId();
  const [compactId, setCompactId] = useState<string>();
  const restoreFocus = useRef<HTMLButtonElement>(null);
  const collapseFocus = useRef<HTMLButtonElement>(null);
  const focusRequest = useRef<string | undefined>(undefined);
  const isCompact = Boolean(
    call && ownsTab && compactId === call.id && call.allowed_actions.includes('hangup'),
  );
  // A released call can be rediscovered with the same ID and must regain media consent.
  if (compactId && !isCompact) {
    setCompactId(undefined);
  }

  // An explicit toggle moves keyboard focus. Server snapshots never steal focus from the chat.
  useLayoutEffect(() => {
    if (!call || focusRequest.current !== call.id) {
      return;
    }
    focusRequest.current = undefined;
    const target = isCompact ? restoreFocus.current : collapseFocus.current;
    target?.focus({ preventScroll: true });
  }, [call, isCompact]);

  function toggleCompact() {
    if (call) {
      focusRequest.current = call.id;
      setCompactId(isCompact ? undefined : call.id);
    }
  }

  const ringingCall = ownsTab && !isBusy && call?.phase === 'ringing' ? call : undefined;
  const ringingId = ringingCall?.id;
  const ringingDirection = ringingCall?.direction;

  useEffect(() => {
    if (!ringingId || !ringingDirection) {
      return;
    }

    const ringtone = new Audio(RINGTONE_SOURCE[ringingDirection]);
    ringtone.loop = true;
    // A browser may require prior user activation for audible playback.
    void ringtone.play().catch(() => undefined);
    return () => ringtone.pause();
  }, [ringingId, ringingDirection]);

  const hasNotice = (!call || !ownsTab) && Boolean(call || error || isBusy);
  return (
    <>
      <AnimatePresence initial={false}>
        {isCompact && call && (
          <CallCompactBar
            key={call.id}
            mediaId={mediaId}
            restoreRef={restoreFocus}
            onRestore={toggleCompact}
            presentation={callPresentation(call, snapshot.mediaStatus)}
            snapshot={snapshot}
            owner={owner}
          />
        )}
      </AnimatePresence>
      {call && ownsTab && (
        <CallPanelContents
          key={call.id}
          call={call}
          owner={owner}
          snapshot={snapshot}
          isCompact={isCompact}
          mediaId={mediaId}
          collapseRef={collapseFocus}
          onCoverageChange={onCoverageChange}
          onCollapse={toggleCompact}
        />
      )}
      {hasNotice && (
        <section className={styles.notice} aria-label="Call">
          {error ? (
            <p role="alert">{error}</p>
          ) : (
            <p role="status">{call ? 'Call is open in another tab.' : 'Starting call…'}</p>
          )}
          {!call && error && (
            <button
              className={styles.tool}
              type="button"
              aria-label="Dismiss call message"
              onClick={() => owner.dismiss()}
            >
              <X aria-hidden="true" />
            </button>
          )}
        </section>
      )}
    </>
  );
}

function CallPanelContents({
  call,
  snapshot,
  owner,
  isCompact,
  mediaId,
  collapseRef,
  onCollapse,
  onCoverageChange,
}: ExpandedCallProps) {
  const fullscreen = useCallFullscreen();
  const isHandheld = useHandheldLayout();
  const isCovered = !isCompact && (fullscreen.isFullscreen || isHandheld);
  const panelRef = fullscreen.panelRef;
  // Move focus into a newly covering call before the underlying workspace becomes inert.
  // prettier-ignore
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (isCovered && panel && !panel.contains(document.activeElement)) {
      panel.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    }
    onCoverageChange?.({ isCovered });
    return () => onCoverageChange?.({ isCovered: false });
  }, [
    isCovered,
    onCoverageChange,
    panelRef,
  ]);
  const { videos, mediaStatus, error } = snapshot;
  const canCollapse = call.allowed_actions.includes('hangup');
  const hasPeerVideo = videos.some((video) => !video.isLocal);
  const presentation = callPresentation(call, mediaStatus);
  const fullscreenLabel = fullscreen.isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen';

  async function collapse() {
    // Keep fullscreen bound to the expanded panel until the browser confirms its exit.
    const panel = fullscreen.panelRef.current;
    if (!panel) {
      return;
    }
    if (document.fullscreenElement === panel && !(await fullscreen.exit())) {
      return;
    }
    // A rediscovered call gets a fresh element even when its server ID is unchanged.
    if (fullscreen.panelRef.current !== panel) {
      return;
    }
    onCollapse();
  }

  return (
    <section
      ref={fullscreen.panelRef}
      className={styles.panel}
      aria-label="Call"
      hidden={isCompact}
      data-video={videos.length > 0 || undefined}
    >
      <CallGradient tone={presentation.tone} />
      {/* Hiding the video layer leaves both the node and its playing MediaStream attached. */}
      <div id={mediaId} className={styles.videos} data-has-peer={hasPeerVideo || undefined}>
        {videos.map((video) => (
          <CallVideoTile key={video.id} video={video} />
        ))}
      </div>
      <div className={styles.toolbar}>
        {canCollapse && (
          <button
            type="button"
            className={styles.collapse}
            ref={collapseRef}
            aria-label="Collapse call panel"
            title="Collapse call panel"
            aria-controls={mediaId}
            aria-expanded={!isCompact}
            disabled={fullscreen.isPending}
            onClick={() => void collapse()}
          >
            <ChevronDown aria-hidden="true" />
          </button>
        )}
        {!isCompact && (
          <div className={styles.tools}>
            {mediaStatus === 'connected' && (
              <CallDeviceSettings snapshot={snapshot} owner={owner} />
            )}
            {fullscreen.isSupported && (
              <button
                type="button"
                className={styles.tool}
                aria-label={fullscreenLabel}
                title={fullscreenLabel}
                disabled={fullscreen.isPending}
                onClick={() => void fullscreen.toggle()}
              >
                {fullscreen.isFullscreen ? <Minimize aria-hidden /> : <Maximize aria-hidden />}
              </button>
            )}
          </div>
        )}
      </div>
      <CallIdentity {...presentation} />
      {(error || fullscreen.error) && (
        <p className={styles.error} role="alert">
          {error || fullscreen.error}
        </p>
      )}
      <CallControls owner={owner} snapshot={snapshot} isCompact={false} />
    </section>
  );
}
