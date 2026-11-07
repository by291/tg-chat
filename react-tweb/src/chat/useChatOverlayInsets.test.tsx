// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatOverlayInsets } from './useChatOverlayInsets';

const resizeCallbacks = new Set<() => void>();
let editorHeight = 33;

class TestResizeObserver {
  constructor(callback: () => void) {
    resizeCallbacks.add(callback);
  }

  observe() {}
  disconnect() {}
}

class TestKeyframeEffect {
  getKeyframes() {
    return [{ height: '33px' }, { height: '96px' }];
  }
}

class TestTransition {
  transitionProperty = 'height';
  effect = new TestKeyframeEffect();
}

beforeEach(() => {
  editorHeight = 33;
  resizeCallbacks.clear();
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  vi.stubGlobal('CSSTransition', TestTransition);
  vi.stubGlobal('KeyframeEffect', TestKeyframeEffect);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(48);
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.getAttribute('data-testid') === 'footer') {
      return 736 - Math.max(0, editorHeight - 40);
    }
    return 16;
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => {
    return new DOMRect(0, 0, 400, editorHeight);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function OverlayScreen() {
  const overlays = useChatOverlayInsets();
  return (
    <main ref={overlays.containerRef}>
      <div ref={overlays.headerRef} />
      <div ref={overlays.footerRef} data-testid="footer">
        <div data-composer="true" data-testid="editor" style={{ transitionDuration: '0.15s' }} />
      </div>
      <output data-testid="insets">{JSON.stringify(overlays.insets)}</output>
    </main>
  );
}

function resizeEditor(height: number) {
  act(() => {
    editorHeight = height;
    for (const callback of resizeCallbacks) {
      callback();
    }
  });
}

describe('floating composer measurements', () => {
  it('reserves the final size once instead of publishing intermediate animation heights', () => {
    render(<OverlayScreen />);
    const editor = screen.getByTestId('editor');
    Object.defineProperty(editor, 'getAnimations', { value: () => [new TestTransition()] });
    expect(screen.getByTestId('insets').textContent).toContain('"bottom":64');

    const transition = new Event('transitionrun', { bubbles: true });
    Object.defineProperty(transition, 'propertyName', { value: 'height' });
    fireEvent(editor, transition);
    expect(screen.getByTestId('insets').textContent).toContain('"bottom":120');

    resizeEditor(50);
    resizeEditor(73);
    expect(screen.getByTestId('insets').textContent).toContain('"bottom":120');
  });

  it('immediately measures a size change without an animation', () => {
    render(<OverlayScreen />);
    resizeEditor(96);
    expect(screen.getByTestId('insets').textContent).toContain('"bottom":120');
  });
});
