// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CurrentUserProvider } from '@/features/chat/CurrentUser';
import type { Message } from '@/domain/messages/message';
import { MessageMetadata } from './MessageMetadata';

const MESSAGE: Message = {
  id: 'message',
  chatId: 'conversation',
  authorId: 'authenticated-user',
  authorName: 'Alice',
  text: 'Stored safely',
  createdAt: Date.now(),
  reactions: [],
  deliveryStatus: 'accepted',
};

afterEach(cleanup);

describe('connected delivery metadata', () => {
  it('uses authenticated ownership and describes server acceptance without a read claim', () => {
    render(
      <CurrentUserProvider value="authenticated-user">
        <MessageMetadata message={MESSAGE} />
      </CurrentUserProvider>,
    );
    expect(screen.getByRole('img', { name: 'Stored on server' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Stored locally' })).toBeNull();
  });

  it('does not attach the caller delivery state to someone else’s message', () => {
    render(
      <CurrentUserProvider value="another-user">
        <MessageMetadata message={MESSAGE} />
      </CurrentUserProvider>,
    );
    expect(screen.queryByRole('img', { name: 'Stored on server' })).toBeNull();
  });
});
