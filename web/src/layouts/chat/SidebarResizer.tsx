import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import styles from './ChatLayout.module.css';

const MINIMUM_WIDTH = 320;
const MAXIMUM_WIDTH = 480;
const KEYBOARD_STEP = 8;
const DEFAULT_SIDEBAR_WIDTH = 360;

type SidebarSide = 'left' | 'right';

function clampWidth(width: number) {
  return Math.min(MAXIMUM_WIDTH, Math.max(MINIMUM_WIDTH, Math.round(width)));
}

function storageKey(side: SidebarSide) {
  return `react-tweb.sidebar-width.${side}.v1`;
}

/** Recover a saved browser-local column width inside the supported range. */
export function readSidebarWidth(side: SidebarSide) {
  try {
    const saved = localStorage.getItem(storageKey(side));
    const width = Number(saved);
    return saved && Number.isFinite(width) ? clampWidth(width) : DEFAULT_SIDEBAR_WIDTH;
  } catch {
    return DEFAULT_SIDEBAR_WIDTH;
  }
}

/** Resize a sidebar by keyboard or captured pointer, saving only the final width. */
export function SidebarResizer({
  side,
  width,
  onResize,
}: {
  side: SidebarSide;
  width: number;
  onResize: (width: number) => void;
}) {
  const drag = useRef<{ position: number; width: number; pointerId: number }>(undefined);
  const direction = side === 'left' ? 1 : -1;

  function save(nextWidth: number) {
    onResize(nextWidth);
    try {
      localStorage.setItem(storageKey(side), String(nextWidth));
    } catch {
      // A private or full storage area still allows resizing during the current session.
    }
  }

  function dragWidth(event: PointerEvent) {
    const start = drag.current;
    if (!start || start.pointerId !== event.pointerId) {
      return;
    }
    return clampWidth(start.width + (event.clientX - start.position) * direction);
  }

  function resizeWithKeyboard(event: KeyboardEvent) {
    let nextWidth: number;
    switch (event.key) {
      case 'ArrowLeft':
        nextWidth = width - KEYBOARD_STEP * direction;
        break;
      case 'ArrowRight':
        nextWidth = width + KEYBOARD_STEP * direction;
        break;
      case 'Home':
        nextWidth = MINIMUM_WIDTH;
        break;
      case 'End':
        nextWidth = MAXIMUM_WIDTH;
        break;
      default:
        return;
    }
    event.preventDefault();
    save(clampWidth(nextWidth));
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={side === 'left' ? 'Resize conversation directory' : 'Resize information panel'}
      aria-orientation="vertical"
      aria-valuemin={MINIMUM_WIDTH}
      aria-valuemax={MAXIMUM_WIDTH}
      aria-valuenow={width}
      className={styles.resizer}
      data-side={side}
      onKeyDown={resizeWithKeyboard}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) {
          return;
        }
        drag.current = {
          position: event.clientX,
          width,
          pointerId: event.pointerId,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const next = dragWidth(event);
        if (next !== undefined) {
          onResize(next);
        }
      }}
      onPointerUp={(event) => {
        const next = dragWidth(event);
        if (next !== undefined) {
          drag.current = undefined;
          save(next);
        }
      }}
      onLostPointerCapture={() => {
        if (drag.current) {
          onResize(drag.current.width);
          drag.current = undefined;
        }
      }}
    />
  );
}
