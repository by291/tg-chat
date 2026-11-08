// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmojiPicker } from './EmojiPicker';

const HOVER_OBSERVATION_TIME = 300;

vi.mock('./emoticons/EmojiBrowser', () => ({
  EmojiBrowser: () => <button type="button">Choose emoji</button>,
}));

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('field emoji picker', () => {
  it('waits for a click instead of opening a field palette on hover', async () => {
    const user = userEvent.setup();
    render(<EmojiPicker variant="field" label="Option emoji" onSelectEmoji={() => {}} />);
    const trigger = screen.getByRole('button', { name: 'Option emoji' });
    await user.hover(trigger);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, HOVER_OBSERVATION_TIME));
    });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('toggles on repeated clicks and opens again after outside dismissal', async () => {
    const user = userEvent.setup();
    render(
      <>
        <EmojiPicker variant="field" label="Option emoji" onSelectEmoji={() => {}} />
        <button type="button">Outside</button>
      </>,
    );
    const trigger = screen.getByRole('button', { name: 'Option emoji' });
    await user.click(trigger);
    await screen.findByRole('dialog', { name: 'Option emoji' });
    await user.click(trigger);
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('false'));
    await user.click(trigger);
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('true'));
    await user.click(screen.getByRole('button', { name: 'Outside' }));
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('false'));
    await user.click(trigger);
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('true'));
  });
});
