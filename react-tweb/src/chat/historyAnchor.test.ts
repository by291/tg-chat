// @vitest-environment jsdom
import { Virtualizer } from '@tanstack/react-virtual';
import { describe, expect, it } from 'vitest';
import { remeasureHistory } from './historyAnchor';

const ROW_COUNT = 100;
const VIEWPORT_HEIGHT = 600;

function createMeasuredHistory() {
  const viewport = document.createElement('div');
  const row = document.createElement('div');
  row.dataset.rowKey = 'row-50';
  row.dataset.index = '50';
  viewport.append(row);
  document.body.append(viewport);
  viewport.getBoundingClientRect = () => new DOMRect(0, 0, 600, VIEWPORT_HEIGHT);
  row.getBoundingClientRect = () => new DOMRect(0, -10, 600, 200);
  Object.defineProperty(viewport, 'scrollHeight', { get: () => 20_000 });
  Object.defineProperty(viewport, 'clientHeight', { get: () => VIEWPORT_HEIGHT });
  let rowHeight = 100;
  const virtualizer = new Virtualizer<HTMLDivElement, HTMLDivElement>({
    count: ROW_COUNT,
    getScrollElement: () => viewport,
    getItemKey: (index) => `row-${index}`,
    estimateSize: () => rowHeight,
    measureElement: () => rowHeight,
    observeElementRect: (_instance, callback) => {
      callback({ width: 600, height: VIEWPORT_HEIGHT });
    },
    observeElementOffset: (_instance, callback) => {
      callback(5010, false);
    },
    scrollToFn: (offset) => {
      viewport.scrollTop = offset;
    },
    anchorTo: 'end',
  });
  virtualizer._willUpdate();
  virtualizer.getVirtualItems();

  return {
    viewport,
    virtualizer,
    resize() {
      rowHeight = 200;
    },
  };
}

describe('width changes while reading history', () => {
  it('keeps the same message and negative in-row offset after measurements are rebuilt', () => {
    const history = createMeasuredHistory();
    history.resize();
    remeasureHistory(history);

    expect(history.viewport.scrollTop).toBe(10_010);
    history.virtualizer._didMount()();
    history.viewport.remove();
  });
});

it('restores the saved anchor when child measurements arrive first', () => {
  const history = createMeasuredHistory();
  const row = history.viewport.firstElementChild as HTMLElement;
  row.dataset.rowKey = 'row-51';
  row.dataset.index = '51';
  history.resize();
  remeasureHistory({ ...history, anchor: { key: 'row-50', offset: -10 } });

  expect(history.viewport.scrollTop).toBe(10_010);
  history.virtualizer._didMount()();
  history.viewport.remove();
});
