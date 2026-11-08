import { useVirtualizer } from '@tanstack/react-virtual';
import { useImperativeHandle, useMemo, useRef, type ReactNode, type Ref } from 'react';
import styles from './EmojiPicker.module.css';

const SECTION_TITLE_HEIGHT = 32;
const OVERSCAN_ROWS = 3;

export interface PickerSection<Item> {
  id: string;
  title: string;
  items: Item[];
}

export interface PickerGridControls {
  scrollToSection: (id: string) => void;
}

interface PickerRow<Item> {
  key: string;
  sectionId: string;
  title?: string;
  items: Item[];
}

interface PickerGridProps<Item> {
  sections: PickerSection<Item>[];
  columns: number;
  rowHeight: number;
  renderItem: (item: Item) => ReactNode;
  controlsRef?: Ref<PickerGridControls>;
  onSectionChange?: (id: string) => void;
  initialSectionId?: string;
}

function createRows<Item>(sections: PickerSection<Item>[], columns: number) {
  const rows: PickerRow<Item>[] = [];
  for (const section of sections) {
    rows.push({
      key: section.id,
      sectionId: section.id,
      title: section.title,
      items: [],
    });
    for (let offset = 0; offset < section.items.length; offset += columns) {
      rows.push({
        key: `${section.id}-${offset}`,
        sectionId: section.id,
        items: section.items.slice(offset, offset + columns),
      });
    }
  }
  return rows;
}

function getSectionOffset<Item>(options: {
  rows: PickerRow<Item>[];
  sectionId?: string;
  rowHeight: number;
}) {
  if (!options.sectionId) {
    return 0;
  }

  let offset = 0;
  for (const row of options.rows) {
    if (row.sectionId === options.sectionId) {
      return offset;
    }

    offset += row.title ? SECTION_TITLE_HEIGHT : options.rowHeight;
  }
  return 0;
}

/** Virtualize whole grid rows so category navigation never mounts the full emoji catalog. */
export function PickerGrid<Item>({
  sections,
  columns,
  rowHeight,
  renderItem,
  controlsRef,
  onSectionChange,
  initialSectionId,
}: PickerGridProps<Item>) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => createRows(sections, columns), [sections, columns]);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: (index) => (rows[index].title ? SECTION_TITLE_HEIGHT : rowHeight),
    getItemKey: (index) => rows[index].key,
    // A replacement grid must begin at its requested category, before native scrolling starts.
    initialOffset: () =>
      getSectionOffset({
        rows,
        sectionId: initialSectionId,
        rowHeight,
      }),
    overscan: OVERSCAN_ROWS,
    onChange: (instance) => {
      const offset = instance.scrollOffset ?? 0;
      const firstVisible = instance.getVirtualItems().find((item) => item.end > offset);
      if (firstVisible) {
        onSectionChange?.(rows[firstVisible.index].sectionId);
      }
    },
  });

  useImperativeHandle(controlsRef, () => ({
    scrollToSection(id) {
      const index = rows.findIndex((row) => row.sectionId === id);
      if (index >= 0) {
        virtualizer.scrollToIndex(index, { align: 'start', behavior: 'smooth' });
      }
    },
  }));

  return (
    <div ref={viewportRef} className={styles.viewport}>
      <div className={styles.gridSurface} style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];

          return (
            <div
              key={row.key}
              className={styles.gridRow}
              style={{
                transform: `translateY(${virtualRow.start}px)`,
                height: virtualRow.size,
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              }}
            >
              {row.title ? (
                <h3 className={styles.sectionTitle}>{row.title}</h3>
              ) : (
                row.items.map(renderItem)
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
