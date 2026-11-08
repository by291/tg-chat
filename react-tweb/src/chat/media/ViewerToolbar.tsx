import { useAppPreferences } from '../../app/settings/appPreferences';
import { useEffect, useState } from 'react';
import { Dialog } from '@ark-ui/react/dialog';
import { Menu } from '@ark-ui/react/menu';
import { Portal } from '@ark-ui/react/portal';
import {
  Copy,
  Download,
  Forward,
  MoreVertical,
  Pencil,
  RotateCcw,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { IconButton } from '../../components/IconButton';
import { Avatar } from '../../components/Avatar';
import { CURRENT_USER_ID, type Message } from '../model';
import { formatMessageDate, formatMessageTime } from '../messageFormatting';
import { copyViewerImage, canCopyViewerImage } from './copyViewerImage';
import type { MediaViewerCommand } from './mediaViewerCommands';
import type { ViewerTransformController } from './useViewerTransform';
import styles from './MediaViewer.module.css';

const MOBILE_VIEWPORT_QUERY = '(max-width: 600px)';

interface ViewerToolbarProps {
  message: Message;
  activeIndex: number;
  count: number;
  isBusy: boolean;
  isMenuOpen: boolean;
  transform: ViewerTransformController;
  onCommand: (command: MediaViewerCommand) => void;
  onNotify: (message: string) => void;
  onMenuOpenChange: (isOpen: boolean) => void;
}

/** Keep media transformations and message actions available without stealing gallery gestures. */
export function ViewerToolbar({
  message,
  activeIndex,
  count,
  isBusy,
  isMenuOpen,
  transform,
  onCommand,
  onNotify,
  onMenuOpenChange,
}: ViewerToolbarProps) {
  const { timeFormat } = useAppPreferences();
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_VIEWPORT_QUERY).matches);
  useEffect(() => {
    const viewport = window.matchMedia(MOBILE_VIEWPORT_QUERY);
    const syncMobileMenu = () => {
      setIsMobile(viewport.matches);
      if (!viewport.matches) {
        onMenuOpenChange(false);
      }
    };
    syncMobileMenu();
    viewport.addEventListener('change', syncMobileMenu);
    return () => viewport.removeEventListener('change', syncMobileMenu);
  }, [onMenuOpenChange]);

  const video = message.media?.kind === 'video' ? message.media : undefined;
  const mediaLabel = video ? 'video' : 'image';
  const isOwnMedia = message.authorId === CURRENT_USER_ID;

  function command(action: MediaViewerCommand['action']) {
    onCommand({ action, message });
  }

  return (
    <header className={styles.toolbar} data-viewer-controls>
      <button className={styles.author} onClick={() => command('go-to-message')}>
        <Avatar initials={message.authorName.slice(0, 1)} size="small" />
        <span>
          <Dialog.Title>{message.authorName}</Dialog.Title>
          <Dialog.Description>
            {activeIndex + 1} of {count} • {formatMessageDate(message.createdAt)} at{' '}
            {formatMessageTime(message.createdAt, { timeFormat })}
          </Dialog.Description>
        </span>
      </button>
      <div className={styles.actions}>
        {isOwnMedia && (
          <IconButton
            label="Edit caption"
            className={styles.desktopAction}
            onClick={() => command('edit-caption')}
          >
            <Pencil />
          </IconButton>
        )}
        <IconButton
          label="Delete message"
          className={styles.desktopAction}
          onClick={() => command('delete')}
        >
          <Trash2 />
        </IconButton>
        <IconButton
          label="Forward"
          className={styles.desktopAction}
          onClick={() => command('forward')}
        >
          <Forward />
        </IconButton>
        {!video && canCopyViewerImage() && (
          <IconButton
            label="Copy image"
            className={styles.desktopAction}
            onClick={() => void copyViewerImage({ message, onNotify })}
          >
            <Copy />
          </IconButton>
        )}
        <a
          href={video?.url ?? message.attachment?.url}
          download={video ? 'video.mp4' : message.attachment?.name}
          aria-label={`Download ${mediaLabel}`}
        >
          <Download />
        </a>
        {!video && (
          <>
            <IconButton
              label="Rotate left"
              onClick={transform.rotateCounterclockwise}
              disabled={isBusy}
            >
              <RotateCcw />
            </IconButton>
            <IconButton
              label={transform.isZooming ? 'Reset zoom' : 'Zoom in'}
              onClick={transform.toggleZoom}
              disabled={isBusy}
            >
              {transform.isZooming ? <ZoomOut /> : <ZoomIn />}
            </IconButton>
          </>
        )}
        <Menu.Root
          open={isMobile && isMenuOpen}
          onOpenChange={({ open }) => onMenuOpenChange(open)}
        >
          <Menu.Trigger asChild>
            <IconButton label="Media options" className={styles.mobileAction}>
              <MoreVertical />
            </IconButton>
          </Menu.Trigger>
          <Portal>
            <Menu.Positioner className={styles.menuPositioner}>
              <Menu.Content className={styles.menu}>
                <Menu.Item value="message" onClick={() => command('go-to-message')}>
                  Go to message
                </Menu.Item>
                <Menu.Item value="forward" onClick={() => command('forward')}>
                  Forward
                </Menu.Item>
                {isOwnMedia && (
                  <Menu.Item value="edit" onClick={() => command('edit-caption')}>
                    Edit caption
                  </Menu.Item>
                )}
                {!video && canCopyViewerImage() && (
                  <Menu.Item
                    value="copy"
                    onClick={() => void copyViewerImage({ message, onNotify })}
                  >
                    Copy image
                  </Menu.Item>
                )}
                <Menu.Item value="delete" onClick={() => command('delete')}>
                  Delete message
                </Menu.Item>
              </Menu.Content>
            </Menu.Positioner>
          </Portal>
        </Menu.Root>
        <Dialog.CloseTrigger asChild>
          <IconButton label={`Close ${mediaLabel}`}>
            <X />
          </IconButton>
        </Dialog.CloseTrigger>
      </div>
    </header>
  );
}
