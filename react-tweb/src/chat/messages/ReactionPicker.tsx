import { Popover } from '@ark-ui/react/popover';
import { MenuDismissLayer } from '../MenuDismissLayer';
import { ReactionBrowser } from './ReactionBrowser';
import styles from './ReactionPicker.module.css';

const STRIP_LEFT_OFFSET = 10.5;
const STRIP_TOP_OFFSET = 60.5;

interface ReactionPickerProps {
  anchor: DOMRect;
  replacedMenuId: string;
  isOpen: boolean;
  selected: string[];
  onSelect: (options: { emoji: string; source: HTMLElement }) => void;
  onClose: () => void;
  onExitComplete: () => void;
}

/** Replace the compact strip with a separate picker without moving the message actions. */
export function ReactionPicker({
  anchor,
  replacedMenuId,
  isOpen,
  selected,
  onSelect,
  onClose,
  onExitComplete,
}: ReactionPickerProps) {
  return (
    <Popover.Root
      open={isOpen}
      autoFocus={false}
      onRequestDismiss={(event) => {
        // The picker replaces this menu; its deferred layer cleanup must not dismiss its successor.
        if (event.detail.targetLayer?.id === replacedMenuId) {
          event.preventDefault();
        }
      }}
      positioning={{
        placement: 'bottom-start',
        gutter: 0,
        flip: false,
        slide: true,
        overlap: true,
        overflowPadding: 8,
        getAnchorRect: () => ({
          x: anchor.left - STRIP_LEFT_OFFSET,
          y: anchor.top - STRIP_TOP_OFFSET,
          width: 0,
          height: 0,
        }),
      }}
      onOpenChange={({ open }) => {
        if (!open) {
          onClose();
        }
      }}
      onExitComplete={onExitComplete}
      lazyMount
      unmountOnExit
    >
      <MenuDismissLayer isOpen={isOpen} label="Dismiss reaction picker" onDismiss={onClose}>
        <Popover.Positioner>
          <Popover.Content className={styles.panel} aria-label="Choose reaction">
            <ReactionBrowser selected={selected} onSelect={onSelect} />
          </Popover.Content>
        </Popover.Positioner>
      </MenuDismissLayer>
    </Popover.Root>
  );
}
