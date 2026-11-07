// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useViewerTransform } from './useViewerTransform';

interface TransformScreenProps {
  mediaId?: string;
  isEnabled?: boolean;
  canTransform?: boolean;
  onNavigate?: (direction: -1 | 1) => void;
  onDismiss?: () => void;
  onClick?: () => void;
}

interface PointerOptions {
  type: string;
  pointerId?: number;
  pointerType?: string;
  left: number;
  top: number;
}

function TransformScreen({
  mediaId = 'first',
  isEnabled,
  canTransform,
  onNavigate,
  onDismiss,
  onClick,
}: TransformScreenProps) {
  const mediaElementRef = useRef<HTMLDivElement>(null);
  const viewer = useViewerTransform({
    mediaId,
    mediaElementRef,
    isEnabled,
    canTransform,
    onNavigate,
    onDismiss,
  });

  return (
    <>
      <div
        ref={viewer.containerRef}
        style={viewer.transformStyle}
        {...viewer.gestureProps}
        onClick={onClick}
        data-testid="surface"
        data-dragging={viewer.isDragging}
      >
        <div ref={mediaElementRef} />
      </div>
      <button onClick={viewer.toggleZoom}>Toggle zoom</button>
      <button onClick={viewer.zoomIn}>Zoom in</button>
      <button onClick={viewer.zoomOut}>Zoom out</button>
      <button onClick={viewer.rotateCounterclockwise}>Rotate</button>
      <button onClick={viewer.refreshGeometry}>Refresh geometry</button>
      <input
        aria-label="Zoom"
        type="range"
        min="0.5"
        max="4"
        step="0.01"
        value={viewer.scale}
        onChange={(event) => viewer.setZoom(Number(event.target.value))}
        onPointerUp={viewer.finishZoomGesture}
      />
      <output data-testid="transform">{JSON.stringify(viewer.transform)}</output>
    </>
  );
}

function sendPointer({ type, pointerId = 1, pointerType = 'mouse', left, top }: PointerOptions) {
  const event = new MouseEvent(type, {
    bubbles: true,
    clientX: left,
    clientY: top,
    button: 0,
  });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  fireEvent(screen.getByTestId('surface'), event);
}

function readTransform() {
  return JSON.parse(screen.getByTestId('transform').textContent ?? '{}');
}

beforeEach(() => {
  vi.stubGlobal('innerWidth', 1000);
  vi.stubGlobal('innerHeight', 800);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({
      x: 100,
      y: 100,
      width: 800,
      height: 600,
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('viewer gesture controls', () => {
  it('preserves a click with slight mouse movement while the photo is fitted', () => {
    const onClick = vi.fn();
    render(<TransformScreen onClick={onClick} />);
    sendPointer({
      type: 'pointerdown',
      left: 400,
      top: 300,
    });
    sendPointer({
      type: 'pointermove',
      left: 401,
      top: 300,
    });
    expect(screen.getByTestId('surface').getAttribute('data-dragging')).toBe('false');
    sendPointer({
      type: 'pointerup',
      left: 401,
      top: 300,
    });
    fireEvent.click(screen.getByTestId('surface'));
    expect(onClick).toHaveBeenCalledOnce();
    expect(readTransform().scale).toBe(1);
    expect(readTransform().offsetX).toBe(0);
  });

  it('does not pan or suppress a stationary press on a zoomed photo', () => {
    const onClick = vi.fn();
    render(<TransformScreen onClick={onClick} />);
    fireEvent.click(screen.getByText('Zoom in'));
    const beforePress = readTransform();
    sendPointer({
      type: 'pointerdown',
      left: 400,
      top: 300,
    });
    expect(screen.getByTestId('surface').getAttribute('data-dragging')).toBe('false');
    sendPointer({
      type: 'pointermove',
      left: 400,
      top: 300,
    });
    sendPointer({
      type: 'pointerup',
      left: 400,
      top: 300,
    });
    fireEvent.click(screen.getByTestId('surface'));
    expect(onClick).toHaveBeenCalledOnce();
    expect(readTransform()).toEqual(beforePress);
  });

  it('applies trackpad pinch directly and keeps the final transform after release', () => {
    vi.useFakeTimers();
    render(<TransformScreen />);
    const surface = screen.getByTestId('surface');
    fireEvent.wheel(surface, { ctrlKey: true, deltaY: -25 });

    expect(surface.style.transition).toBe('none');
    const finalTransform = readTransform();
    act(() => vi.advanceTimersByTime(150));
    expect(surface.style.transition).toBe('');
    expect(readTransform()).toEqual(finalTransform);
    act(() => vi.advanceTimersByTime(500));
    expect(readTransform()).toEqual(finalTransform);
  });

  it('distinguishes a physical modifier key from the control flag on trackpad pinch', () => {
    render(<TransformScreen />);
    const surface = screen.getByTestId('surface');
    fireEvent.keyDown(window, { key: 'Control', ctrlKey: true });
    fireEvent.wheel(surface, { ctrlKey: true, deltaY: -25 });
    expect(surface.style.transition).toBe('');

    fireEvent.keyUp(window, { key: 'Control', ctrlKey: false });
    fireEvent.wheel(surface, { ctrlKey: true, deltaY: -25 });
    expect(surface.style.transition).toBe('none');
  });

  it('applies trackpad pan directly without adding release movement', () => {
    vi.useFakeTimers();
    render(<TransformScreen />);
    fireEvent.click(screen.getByText('Zoom in'));
    const surface = screen.getByTestId('surface');
    fireEvent.wheel(surface, { deltaX: 30, deltaY: 20 });
    expect(surface.style.transition).toBe('none');
    const finalTransform = readTransform();
    act(() => vi.advanceTimersByTime(150));
    expect(surface.style.transition).toBe('');
    expect(readTransform()).toEqual(finalTransform);
  });

  it('restores animated zoom when a toolbar action interrupts trackpad input', () => {
    render(<TransformScreen />);
    const surface = screen.getByTestId('surface');
    fireEvent.wheel(surface, { ctrlKey: true, deltaY: -25 });
    expect(surface.style.transition).toBe('none');
    fireEvent.click(screen.getByText('Zoom in'));
    expect(surface.style.transition).toBe('');
  });

  it('starts toolbar zoom at one step and resets it without removing rotation', () => {
    render(<TransformScreen />);
    fireEvent.click(screen.getByText('Rotate'));
    fireEvent.click(screen.getByText('Toggle zoom'));
    expect(readTransform().scale).toBe(1.5);
    fireEvent.click(screen.getByText('Toggle zoom'));

    expect(readTransform()).toEqual({
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      rotation: -90,
    });
  });

  it('clears zoom, rotation and pan when the selected media changes', () => {
    const view = render(<TransformScreen />);
    fireEvent.click(screen.getByText('Rotate'));
    fireEvent.click(screen.getByText('Zoom in'));
    view.rerender(<TransformScreen mediaId="second" />);

    expect(readTransform()).toEqual({
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      rotation: 0,
    });
  });

  it('uses modifier-wheel for anchored zoom and unmodified wheel for pan', () => {
    render(<TransformScreen />);
    const surface = screen.getByTestId('surface');
    fireEvent.click(screen.getByText('Zoom in'));
    fireEvent.click(screen.getByText('Zoom in'));
    fireEvent.wheel(surface, { deltaX: 40, deltaY: 50 });
    expect(readTransform().scale).toBe(2);
    expect(readTransform().offsetX).toBe(-540);
    expect(readTransform().offsetY).toBe(-450);

    const beforeZoom = readTransform();
    fireEvent.wheel(surface, {
      deltaY: -10,
      ctrlKey: true,
      clientX: 400,
      clientY: 300,
    });
    const afterZoom = readTransform();
    const contentLeft = (400 - beforeZoom.offsetX) / beforeZoom.scale;
    expect(afterZoom.scale).toBe(2.1);
    expect(contentLeft * afterZoom.scale + afterZoom.offsetX).toBeCloseTo(400);
  });

  it('toggles trackpad smart zoom independently of mouse click handling', () => {
    render(<TransformScreen />);
    const surface = screen.getByTestId('surface');
    const smartZoom = {
      ctrlKey: true,
      deltaX: -0,
      deltaY: -0,
      clientX: 400,
      clientY: 300,
    };
    fireEvent.wheel(surface, smartZoom);
    expect(readTransform().scale).toBe(3);
    fireEvent.wheel(surface, smartZoom);
    expect(readTransform().scale).toBe(1);
  });

  it('toggles a three-times anchored zoom on double-click', () => {
    render(<TransformScreen />);
    const surface = screen.getByTestId('surface');
    fireEvent.doubleClick(surface, { clientX: 400, clientY: 300 });
    expect(readTransform().scale).toBe(3);
    fireEvent.doubleClick(surface, { clientX: 400, clientY: 300 });
    expect(readTransform().scale).toBe(1);
  });

  it('rechecks the viewport on resize without discarding rotation', () => {
    render(<TransformScreen />);
    fireEvent.click(screen.getByText('Rotate'));
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(readTransform().rotation).toBe(-90);
  });

  it('refits rotation to layout dimensions refreshed after a gallery transition', () => {
    render(<TransformScreen />);
    fireEvent.click(screen.getByText('Rotate'));
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({
        x: 300,
        y: 100,
        width: 400,
        height: 600,
      }),
    );
    fireEvent.click(screen.getByText('Refresh geometry'));

    expect(readTransform().rotation).toBe(-90);
    expect(screen.getByTestId('surface').style.transform).toContain('scale(1.6666666666666667)');
  });

  it('pans with the pointer and suppresses its generated click', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const onClick = vi.fn();
    render(<TransformScreen onClick={onClick} />);
    fireEvent.click(screen.getByText('Zoom in'));
    fireEvent.click(screen.getByText('Zoom in'));
    sendPointer({
      type: 'pointerdown',
      left: 400,
      top: 300,
    });
    sendPointer({
      type: 'pointermove',
      left: 450,
      top: 350,
    });
    expect(readTransform().offsetX).toBe(-450);
    expect(readTransform().offsetY).toBe(-350);
    clock.mockReturnValue(1100);
    sendPointer({
      type: 'pointerup',
      left: 450,
      top: 350,
    });
    fireEvent.click(screen.getByTestId('surface'));

    expect(readTransform().offsetX).toBe(-325);
    expect(readTransform().offsetY).toBe(-225);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('zooms with two touch pointers and keeps their midpoint stationary', () => {
    render(<TransformScreen />);
    sendPointer({
      type: 'pointerdown',
      pointerType: 'touch',
      left: 300,
      top: 400,
    });
    sendPointer({
      type: 'pointerdown',
      pointerId: 2,
      pointerType: 'touch',
      left: 700,
      top: 400,
    });
    sendPointer({
      type: 'pointermove',
      pointerId: 2,
      pointerType: 'touch',
      left: 900,
      top: 400,
    });

    const transformed = readTransform();
    expect(transformed.scale).toBe(1.5);
    expect(transformed.offsetX + 500 * transformed.scale).toBe(600);
    expect(transformed.offsetY + 400 * transformed.scale).toBe(400);
  });

  it('navigates for horizontal touch swipes and dismisses for vertical swipes', () => {
    const onNavigate = vi.fn();
    const onDismiss = vi.fn();
    render(<TransformScreen onNavigate={onNavigate} onDismiss={onDismiss} />);
    sendPointer({
      type: 'pointerdown',
      pointerType: 'touch',
      left: 500,
      top: 400,
    });
    sendPointer({
      type: 'pointermove',
      pointerType: 'touch',
      left: 300,
      top: 400,
    });
    expect(onNavigate).toHaveBeenCalledWith(1);
    sendPointer({
      type: 'pointerup',
      pointerType: 'touch',
      left: 300,
      top: 400,
    });
    expect(onNavigate).toHaveBeenCalledOnce();

    sendPointer({
      type: 'pointerdown',
      pointerType: 'touch',
      left: 500,
      top: 400,
    });
    sendPointer({
      type: 'pointerup',
      pointerType: 'touch',
      left: 500,
      top: 600,
    });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('does not navigate for a cancelled touch gesture', () => {
    const onNavigate = vi.fn();
    render(<TransformScreen onNavigate={onNavigate} />);
    sendPointer({
      type: 'pointerdown',
      pointerType: 'touch',
      left: 500,
      top: 400,
    });
    sendPointer({
      type: 'pointercancel',
      pointerType: 'touch',
      left: 300,
      top: 400,
    });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('allows video-like touch navigation while rejecting zoom and rotation', () => {
    const onNavigate = vi.fn();
    render(<TransformScreen canTransform={false} onNavigate={onNavigate} />);
    const surface = screen.getByTestId('surface');
    fireEvent.click(screen.getByText('Zoom in'));
    fireEvent.click(screen.getByText('Rotate'));
    fireEvent.doubleClick(surface, { clientX: 400, clientY: 300 });
    fireEvent.wheel(surface, { ctrlKey: true, deltaY: -25 });
    sendPointer({
      type: 'pointerdown',
      pointerType: 'touch',
      left: 500,
      top: 400,
    });
    sendPointer({
      type: 'pointermove',
      pointerType: 'touch',
      left: 300,
      top: 400,
    });
    sendPointer({
      type: 'pointerup',
      pointerType: 'touch',
      left: 300,
      top: 400,
    });

    expect(onNavigate).toHaveBeenCalledWith(1);
    expect(readTransform()).toEqual({
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      rotation: 0,
    });
  });

  it('cancels an active swipe when the viewer becomes busy or starts closing', () => {
    const onNavigate = vi.fn();
    const view = render(<TransformScreen onNavigate={onNavigate} />);
    sendPointer({
      type: 'pointerdown',
      pointerType: 'touch',
      left: 500,
      top: 400,
    });
    view.rerender(<TransformScreen isEnabled={false} onNavigate={onNavigate} />);
    sendPointer({
      type: 'pointermove',
      pointerType: 'touch',
      left: 300,
      top: 400,
    });
    view.rerender(<TransformScreen onNavigate={onNavigate} />);
    sendPointer({
      type: 'pointerup',
      pointerType: 'touch',
      left: 300,
      top: 400,
    });

    expect(onNavigate).not.toHaveBeenCalled();
    expect(readTransform().scale).toBe(1);
  });

  it('cancels an active drag when transforms become unavailable', () => {
    const onNavigate = vi.fn();
    const view = render(<TransformScreen onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('Zoom in'));
    sendPointer({
      type: 'pointerdown',
      pointerType: 'touch',
      left: 500,
      top: 400,
    });
    view.rerender(<TransformScreen canTransform={false} onNavigate={onNavigate} />);
    sendPointer({
      type: 'pointermove',
      pointerType: 'touch',
      left: 300,
      top: 400,
    });
    sendPointer({
      type: 'pointerup',
      pointerType: 'touch',
      left: 300,
      top: 400,
    });

    expect(onNavigate).not.toHaveBeenCalled();
    expect(readTransform().scale).toBe(1);
  });

  it('restores the fitted size when a pinch finishes below the initial scale', () => {
    render(<TransformScreen />);
    sendPointer({
      type: 'pointerdown',
      pointerType: 'touch',
      left: 300,
      top: 400,
    });
    sendPointer({
      type: 'pointerdown',
      pointerId: 2,
      pointerType: 'touch',
      left: 700,
      top: 400,
    });
    sendPointer({
      type: 'pointermove',
      pointerId: 2,
      pointerType: 'touch',
      left: 500,
      top: 400,
    });
    expect(readTransform().scale).toBe(0.5);
    sendPointer({
      type: 'pointerup',
      pointerId: 2,
      pointerType: 'touch',
      left: 500,
      top: 400,
    });

    expect(readTransform()).toEqual({
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      rotation: 0,
    });
  });

  it('settles toolbar and modifier-wheel zoom below fitted size after their idle delay', () => {
    vi.useFakeTimers();
    render(<TransformScreen />);
    fireEvent.click(screen.getByText('Zoom out'));
    expect(readTransform().scale).toBe(0.5);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(readTransform().scale).toBe(1);

    fireEvent.wheel(screen.getByTestId('surface'), { ctrlKey: true, deltaY: 25 });
    expect(readTransform().scale).toBe(0.75);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(readTransform().scale).toBe(1);
  });

  it('lets slider scrubbing interrupt wheel settling until the slider is released', () => {
    vi.useFakeTimers();
    render(<TransformScreen />);
    fireEvent.wheel(screen.getByTestId('surface'), { ctrlKey: true, deltaY: 25 });
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '0.6' } });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(readTransform().scale).toBe(0.6);
    fireEvent.pointerUp(slider);
    expect(readTransform().scale).toBe(1);
  });

  it('cancels pending zoom settling when closing begins', () => {
    vi.useFakeTimers();
    const view = render(<TransformScreen />);
    fireEvent.click(screen.getByText('Zoom out'));
    view.rerender(<TransformScreen isEnabled={false} />);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(readTransform().scale).toBe(0.5);
  });
});
