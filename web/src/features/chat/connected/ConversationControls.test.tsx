// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { conversationFixture } from '../data/messageFixtures.test-support';
import { ConversationControls } from './ConversationControls';

describe('community conversation controls', () => {
  it('keeps personal preferences available without granting subscriber management', () => {
    render(
      <ConversationControls
        conversation={conversationFixture({ kind: 'channel', can_manage: false })}
        onCommand={vi.fn()}
        onConfirm={vi.fn()}
        onError={vi.fn()}
        onPins={vi.fn()}
      />,
    );
    expect(screen.getByRole('combobox', { hidden: true }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByText('Close conversation')).toBeNull();
    expect(screen.getByText('Clear history')).toBeTruthy();
    expect(screen.getByText('Archive')).toBeTruthy();
  });
});
