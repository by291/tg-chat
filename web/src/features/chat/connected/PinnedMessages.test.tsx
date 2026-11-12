// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { components } from '@/api/schema';
import { PinnedMessages } from './PinnedMessages';

it('labels pinned contact cards and stickers without visible text', async () => {
  const base: components['schemas']['CanonicalMessage'] = {
    id: 'sticker',
    conversation_id: 'conversation',
    author_id: 'author',
    author_name: 'Author',
    sequence: '1',
    version: '1',
    interaction_version: '1',
    is_deleted: false,
    is_pinned: true,
    reactions: [],
    created_at: '2026-11-12T00:00:00Z',
    content: {
      schema_version: 1,
      text: '',
      custom_emoji: [],
    },
  };
  const page: components['schemas']['HistoryPage'] = {
    messages: [
      {
        ...base,
        content: { ...base.content, text: ' ' },
        body: { kind: 'sticker', sticker_id: 'UtyaDuck-AgAD8gADVp29Cg' },
      },
      {
        ...base,
        id: 'contact',
        sequence: '2',
        body: { kind: 'contact', display_name: 'Emergency contact' },
      },
    ],
    has_older: false,
    has_newer: false,
    observation_cursor: 'cursor',
    generation: '1',
  };

  const jumpToMessage = vi.fn().mockResolvedValue(undefined);
  const onOpen = vi.fn();
  render(
    <PinnedMessages
      owner={{ loadPins: vi.fn().mockResolvedValue(page), jumpToMessage }}
      version="1"
      isListOpen={false}
      onOpen={onOpen}
      onClose={vi.fn()}
      onError={vi.fn()}
    />,
  );

  const preview = await screen.findByRole('button', {
    name: 'Pinned message: Emergency contact',
  });
  fireEvent.click(preview);
  expect(jumpToMessage).toHaveBeenCalledWith('contact');

  fireEvent.click(screen.getByRole('button', { name: 'Open pinned messages' }));
  expect(onOpen).toHaveBeenCalledOnce();
});
