import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
import { IconButton } from '../../components/IconButton';
import { useClosingDialogValue } from '../sidebar/useClosingDialogValue';
import type { Message } from '../model';
import { getGalleryMessages } from './photoGallery';
import { ViewerGallery } from './ViewerGallery';
import { ViewerToolbar } from './ViewerToolbar';
import { useViewerTransform } from './useViewerTransform';
import { VIEWER_ZOOM_MIN, VIEWER_ZOOM_MAX, VIEWER_ZOOM_SLIDER_STEP } from './viewerTransform';
import type { MediaViewerCommand } from './mediaViewerCommands';
import styles from './MediaViewer.module.css';

const MOBILE_WIDTH = 600;
const DESKTOP_MEDIA_RESERVE = 190;
const CLOSE_DURATION = 200;

interface MediaViewerProps {
  message?: Message;
  messages: Message[];
  onClose: () => void;
  onNavigate: (message: Message) => void;
  onCommand: (command: MediaViewerCommand) => void;
  onNotify: (message: string) => void;
}

interface ViewerContentProps extends Omit<MediaViewerProps, 'message'> {
  message: Message;
  isOpen: boolean;
}

function getMediaBox() {
  const reserve = window.innerWidth <= MOBILE_WIDTH ? 0 : DESKTOP_MEDIA_RESERVE;
  return { width: window.innerWidth, height: window.innerHeight - reserve };
}

function ViewerContent({
  message,
  messages,
  isOpen,
  onClose,
  onNavigate,
  onCommand,
  onNotify,
}: ViewerContentProps) {
  const mediaMessages = getGalleryMessages(messages);
  const activeIndex = mediaMessages.findIndex((entry) => entry.id === message.id);
  const isVideo = message.media?.kind === 'video';
  const mediaElementRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const isBusyRef = useRef(true);
  const [isBusy, setIsBusy] = useState(true);
  const [isChromeHidden, setIsChromeHidden] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const transform = useViewerTransform({
    mediaId: message.id,
    mediaElementRef,
    isEnabled: isOpen && !isBusy,
    canTransform: !isVideo,
    getMediaBox,
    onNavigate: navigate,
    onDismiss: onClose,
  });
  const hasPrevious = activeIndex > 0;
  const hasNext = activeIndex >= 0 && activeIndex < mediaMessages.length - 1;
  const canNavigate = !isBusy && !transform.isZooming;
  const albumPhotos =
    message.media?.kind === 'album'
      ? mediaMessages.filter((entry) => entry.media === message.media)
      : [];

  function navigateTo(nextMessage?: Message) {
    if (
      !nextMessage ||
      nextMessage.id === message.id ||
      isBusyRef.current ||
      transform.isZooming ||
      isMenuOpen
    ) {
      return;
    }
    // Disabling the clicked arrow must not move keyboard navigation outside the dialog.
    viewerRef.current?.focus({ preventScroll: true });
    isBusyRef.current = true;
    setIsBusy(true);
    setIsChromeHidden(false);
    onNavigate(nextMessage);
  }

  function navigate(direction: -1 | 1) {
    navigateTo(mediaMessages[activeIndex + direction]);
  }

  const updateBusy = useCallback((nextBusy: boolean) => {
    isBusyRef.current = nextBusy;
    setIsBusy(nextBusy);
  }, []);

  function clickViewer(event: MouseEvent<HTMLDivElement>) {
    if (!isOpen || isBusyRef.current || isMenuOpen || event.defaultPrevented) {
      return;
    }
    const target = event.target as HTMLElement;
    const hasClickedControls = target.closest(
      'button, input, a, video, [data-viewer-controls], [role="menu"], [aria-label="Video player"]',
    );
    if (hasClickedControls) {
      return;
    }
    if (window.innerWidth <= MOBILE_WIDTH) {
      setIsChromeHidden((current) => !current);
      return;
    }
    onClose();
  }

  useEffect(() => {
    setIsChromeHidden(false);
  }, [message.id]);

  useLayoutEffect(() => {
    if (isOpen) {
      return;
    }
    const layer = transform.containerRef.current;
    if (!layer?.animate) {
      return;
    }
    const shouldReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animation = layer.animate(
      [{ transform: getComputedStyle(layer).transform }, { transform: 'none' }],
      {
        duration: shouldReduceMotion ? 0 : CLOSE_DURATION,
        easing: 'ease',
        fill: 'both',
      },
    );
    return () => animation.cancel();
  }, [isOpen, transform.containerRef]);

  return (
    <Dialog.Content
      ref={viewerRef}
      className={styles.viewer}
      data-chrome-hidden={isChromeHidden}
      data-zooming={transform.isZooming}
      data-has-album={albumPhotos.length > 1}
      onClick={clickViewer}
      onKeyDown={(event) => {
        if (isMenuOpen || (event.target as HTMLElement).matches('input, textarea')) {
          return;
        }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          navigate(event.key === 'ArrowLeft' ? -1 : 1);
        }
        const isZoomShortcut = (event.ctrlKey || event.metaKey) && !isVideo;
        if (isZoomShortcut && (event.key === '=' || event.key === '+')) {
          event.preventDefault();
          transform.zoomIn();
        }
        if (isZoomShortcut && event.key === '-') {
          event.preventDefault();
          transform.zoomOut();
        }
      }}
    >
      <div
        ref={transform.containerRef}
        className={styles.transformLayer}
        style={transform.transformStyle}
        data-viewer-transform
        data-dragging={transform.isDragging}
        {...transform.gestureProps}
        onDoubleClick={(event) => {
          // Desktop smart zoom arrives as a wheel gesture; double-tap belongs to mobile.
          if (window.innerWidth <= MOBILE_WIDTH) {
            transform.gestureProps.onDoubleClick(event);
          }
        }}
      >
        <ViewerGallery
          message={message}
          isOpen={isOpen}
          activeIndex={activeIndex}
          mediaElementRef={mediaElementRef}
          onBusyChange={updateBusy}
        />
      </div>
      <ViewerToolbar
        message={message}
        activeIndex={activeIndex}
        count={mediaMessages.length}
        isBusy={isBusy}
        isMenuOpen={isMenuOpen}
        transform={transform}
        onCommand={onCommand}
        onNotify={onNotify}
        onMenuOpenChange={setIsMenuOpen}
      />
      <div className={styles.navigation} data-viewer-controls>
        <button
          aria-label="Previous media"
          className={styles.previous}
          disabled={!hasPrevious || !canNavigate}
          data-available={hasPrevious && !transform.isZooming}
          onClick={() => navigate(-1)}
        >
          <ChevronLeft />
        </button>
        <button
          aria-label="Next media"
          className={styles.next}
          disabled={!hasNext || !canNavigate}
          data-available={hasNext && !transform.isZooming}
          onClick={() => navigate(1)}
        >
          <ChevronRight />
        </button>
      </div>
      {!isVideo && (
        <div
          className={styles.zoomControls}
          data-visible={transform.isZooming}
          data-viewer-controls
        >
          <IconButton
            label="Zoom out"
            onClick={transform.zoomOut}
            disabled={transform.scale <= VIEWER_ZOOM_MIN}
          >
            <ZoomOut />
          </IconButton>
          <input
            type="range"
            aria-label="Image zoom"
            min={VIEWER_ZOOM_MIN}
            max={VIEWER_ZOOM_MAX}
            step={VIEWER_ZOOM_SLIDER_STEP}
            value={transform.scale}
            onChange={(event) => transform.setZoom(Number(event.target.value))}
            onPointerUp={transform.finishZoomGesture}
            onKeyUp={transform.finishZoomGesture}
          />
          <IconButton
            label="Increase zoom"
            onClick={transform.zoomIn}
            disabled={transform.scale >= VIEWER_ZOOM_MAX}
          >
            <ZoomIn />
          </IconButton>
        </div>
      )}
      {message.text && (
        <p className={styles.caption} data-viewer-controls>
          {message.text}
        </p>
      )}
      {albumPhotos.length > 1 && (
        <div className={styles.albumThumbs} data-viewer-controls aria-label="Album photos">
          {albumPhotos.map((entry, index) => (
            <button
              key={entry.id}
              aria-label={`View album photo ${index + 1}`}
              aria-current={entry.id === message.id}
              disabled={isBusy}
              onClick={() => navigateTo(entry)}
            >
              <img src={entry.attachment?.url} alt="" draggable={false} />
            </button>
          ))}
        </div>
      )}
    </Dialog.Content>
  );
}

/** Present shared media with independent gallery, gesture, and message-action lifecycles. */
export function MediaViewer({ message, ...options }: MediaViewerProps) {
  const displayedMessage = useClosingDialogValue(message);
  return (
    <Dialog.Root
      open={Boolean(message)}
      onOpenChange={({ open }) => {
        if (!open) {
          options.onClose();
        }
      }}
      lazyMount
      unmountOnExit
    >
      <Portal>
        <Dialog.Backdrop className={styles.backdrop} />
        <Dialog.Positioner className={styles.positioner}>
          {displayedMessage && (
            <ViewerContent {...options} message={displayedMessage} isOpen={Boolean(message)} />
          )}
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
