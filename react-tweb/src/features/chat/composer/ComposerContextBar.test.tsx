// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Message } from '../model';
import { ComposerContextBar } from './ComposerContextBar';

const originalMessage: Message = {
  id: 'original',
  chatId: 'dev',
  authorId: 'mia',
  authorName: 'Mia',
  text: '',
  createdAt: 1000,
  reactions: [],
};

afterEach(cleanup);

describe('composer media previews', () => {
  it('shows a photo thumbnail alongside the original caption', () => {
    render(
      <ComposerContextBar
        replyMessage={{
          ...originalMessage,
          text: 'A photo caption',
          attachment: {
            name: 'hills.jpg',
            url: '/hills.jpg',
            width: 400,
            height: 300,
          },
        }}
        onCancel={() => {}}
        onJumpToMessage={() => {}}
      />,
    );

    expect(screen.getByRole('img', { name: 'Message preview' }).getAttribute('src')).toBe(
      '/hills.jpg',
    );
    expect(screen.getByText('A photo caption')).toBeTruthy();
  });

  it('uses an audio summary without creating a thumbnail from the audio URL', () => {
    render(
      <ComposerContextBar
        replyMessage={{
          ...originalMessage,
          media: {
            kind: 'voice',
            url: '/voice.webm',
            duration: 5,
            waveform: [0.4],
          },
        }}
        onCancel={() => {}}
        onJumpToMessage={() => {}}
      />,
    );

    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('Voice message')).toBeTruthy();
  });
});
