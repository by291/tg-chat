// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHistoryMessages } from '../demo/historyFixtures';
import type { MediaViewerCommand } from './mediaViewerCommands';
import { useMediaViewerCommand } from './useMediaViewerCommand';

afterEach(cleanup);

describe('viewer command handoff', () => {
  const message = createHistoryMessages()[0];

  it('does not reopen a dismissed dialog when conversation callbacks change', () => {
    const command: MediaViewerCommand = { action: 'delete', message };
    const onMessageCommand = vi.fn();
    const onJumpToMessage = vi.fn();
    const view = renderHook(useMediaViewerCommand, {
      initialProps: {
        command,
        onMessageCommand,
        onJumpToMessage,
      },
    });
    expect(onMessageCommand).toHaveBeenCalledWith({ action: 'delete', message });

    const nextMessageCommand = vi.fn();
    view.rerender({
      command,
      onMessageCommand: nextMessageCommand,
      onJumpToMessage,
    });

    expect(nextMessageCommand).not.toHaveBeenCalled();
  });

  it('allows returning to the same message again after another explicit request', () => {
    const onMessageCommand = vi.fn();
    const onJumpToMessage = vi.fn();
    const command: MediaViewerCommand = { action: 'go-to-message', message };
    const view = renderHook(useMediaViewerCommand, {
      initialProps: {
        command,
        onMessageCommand,
        onJumpToMessage,
      },
    });
    expect(onJumpToMessage).toHaveBeenCalledWith(message.id);
    onJumpToMessage.mockClear();

    view.rerender({
      command: { action: 'go-to-message', message },
      onMessageCommand,
      onJumpToMessage,
    });

    expect(onJumpToMessage).toHaveBeenCalledWith(message.id);
    expect(onMessageCommand).not.toHaveBeenCalled();
  });
});
