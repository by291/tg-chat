// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CUSTOM_EMOJI } from '../emoji/customEmojiCatalog';
import { MessageReaction } from './MessageReaction';
import { getCustomReactionKey } from './reactionEmoji';

const MESSAGE_ID = 'custom-reaction-message';

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('custom message reactions', () => {
  it('renders the custom artwork and removes its document key instead of the native fallback', () => {
    const custom = CUSTOM_EMOJI[0];
    const emoji = getCustomReactionKey(custom.id);
    const onReact = vi.fn();
    render(<MessageReaction emoji={emoji} messageId={MESSAGE_ID} onReact={onReact} />);

    const button = screen.getByRole('button', { name: `Remove ${custom.name} reaction` });
    expect(screen.getByRole('img', { name: custom.name })).toBeTruthy();
    expect(button.querySelector('img')?.getAttribute('src')).toBe(custom.preview);
    expect(button.querySelector('[data-reaction-emoji]')?.getAttribute('data-reaction-emoji')).toBe(
      emoji,
    );
    fireEvent.click(button);

    expect(onReact).toHaveBeenCalledWith(MESSAGE_ID, emoji);
  });

  it('keeps a missing custom reaction readable and removable', () => {
    const emoji = getCustomReactionKey('unavailable-document');
    const onReact = vi.fn();
    render(<MessageReaction emoji={emoji} messageId={MESSAGE_ID} onReact={onReact} />);

    const button = screen.getByRole('button', { name: 'Remove Unknown custom emoji reaction' });
    expect(button.textContent).toContain('❔');
    expect(button.textContent).not.toContain('unavailable-document');
    fireEvent.click(button);

    expect(onReact).toHaveBeenCalledWith(MESSAGE_ID, emoji);
  });
});
