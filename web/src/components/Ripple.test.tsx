// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IconButton } from './IconButton';
import styles from './Ripple.module.css';

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('press feedback', () => {
  it('keeps a held wave visible and releases it when the pointer is cancelled outside', () => {
    const { container } = render(<IconButton label="Open">Open</IconButton>);
    const button = screen.getByRole('button', { name: 'Open' });
    fireEvent.pointerDown(button, {
      button: 0,
      clientX: 12,
      clientY: 18,
    });
    act(() => vi.advanceTimersByTime(2000));

    const wave = container.querySelector(`.${styles.wave}`);

    expect(wave).not.toBeNull();
    expect(wave?.getAttribute('data-fading')).toBe('false');

    fireEvent.pointerCancel(window);
    act(() => vi.runAllTimers());

    expect(container.querySelector(`.${styles.wave}`)).toBeNull();
  });

  it('does not duplicate a keyboard hold and releases feedback when focus leaves', () => {
    const { container } = render(<IconButton label="Open">Open</IconButton>);
    const button = screen.getByRole('button', { name: 'Open' });
    fireEvent.keyDown(button, { key: ' ' });
    fireEvent.keyDown(button, { key: ' ', repeat: true });

    expect(container.querySelectorAll(`.${styles.wave}`)).toHaveLength(1);

    fireEvent.blur(button);
    act(() => vi.runAllTimers());

    expect(container.querySelector(`.${styles.wave}`)).toBeNull();
  });

  it('removes pending feedback work when a pressed control unmounts', () => {
    const { unmount } = render(<IconButton label="Open">Open</IconButton>);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Open' }), {
      button: 0,
      clientX: 12,
      clientY: 18,
    });
    unmount();
    fireEvent.pointerUp(window);

    expect(vi.getTimerCount()).toBe(0);
  });
});
