// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSidebarSearch } from './useSidebarSearch';

interface SearchHandoffScreenProps {
  isArchiveOpen: boolean;
}

function SearchHandoffScreen({ isArchiveOpen }: SearchHandoffScreenProps) {
  const search = useSidebarSearch({
    conversations: [],
    isArchiveOpen,
    onCloseArchive: () => {},
  });

  useLayoutEffect(() => {
    if (!isArchiveOpen) {
      // Returning sidebar pages restore their primary control before search claims focus.
      search.menuButtonRef.current?.focus();
    }
  }, [isArchiveOpen, search.menuButtonRef]);

  return (
    <>
      <button ref={search.menuButtonRef} onClick={search.openArchiveSearch}>
        Search archive
      </button>
      <input ref={search.inputRef} aria-label="Search conversations" />
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('archive search focus', () => {
  it('focuses search when returning from archive takes longer than one frame', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    const { rerender } = render(<SearchHandoffScreen isArchiveOpen />);

    fireEvent.click(screen.getByRole('button', { name: 'Search archive' }));
    act(() => vi.advanceTimersToNextFrame());

    rerender(<SearchHandoffScreen isArchiveOpen={false} />);
    act(() => vi.advanceTimersToNextFrame());

    expect(document.activeElement).toBe(
      screen.getByRole('textbox', { name: 'Search conversations' }),
    );
  });
});
