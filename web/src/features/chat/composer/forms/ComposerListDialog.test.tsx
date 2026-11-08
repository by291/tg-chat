// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComposerListDialog } from './ComposerListDialog';

beforeEach(() => {
  // Motion restores document scroll after layout measurements; jsdom has no scrolling viewport.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
  document.getAnimations = () => [];
  Element.prototype.getAnimations = () => [];
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fillField(name: string, value: string) {
  fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } });
}

describe('structured message composition', () => {
  it('cancels keyboard sorting without changing the answers', async () => {
    const user = userEvent.setup();
    render(<ComposerListDialog kind="poll" onClose={() => {}} onSubmit={() => {}} />);
    fillField('Option 1', 'First');
    fillField('Option 2', 'Second');
    screen.getByRole('button', { name: 'Reorder option 1' }).focus();
    await user.keyboard('[Space]');
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Reorder option 1' }).getAttribute('aria-pressed'),
      ).toBe('true');
    });
    await user.keyboard('[ArrowDown][Escape]');
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Option 1' }).value).toBe('First');
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Option 2' }).value).toBe(
      'Second',
    );
  });

  it('rejects answers that become duplicates after whitespace is trimmed', async () => {
    const onSubmit = vi.fn();
    render(<ComposerListDialog kind="poll" onClose={() => {}} onSubmit={onSubmit} />);
    fillField('Ask a Question', 'Which one?');
    fillField('Option 1', 'First');
    fillField('Option 2', ' First ');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create' }).hasAttribute('disabled')).toBe(true);
    });
    expect(screen.getByRole('alert').textContent).toContain('different');
    fillField('Option 2', 'Second');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create' }).hasAttribute('disabled')).toBe(false);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
  });

  it('keeps one correct answer in single-answer mode and allows independent multiple answers', async () => {
    const user = userEvent.setup();
    render(<ComposerListDialog kind="poll" onClose={() => {}} onSubmit={() => {}} />);
    fillField('Option 1', 'First');
    fillField('Option 2', 'Second');
    await user.click(screen.getByText('Set Correct Answer'));
    await user.click(screen.getByText('Allow Multiple Answers'));

    const firstAnswer = screen.getByRole<HTMLInputElement>('radio', { name: 'Correct answer 1' });
    const secondAnswer = screen.getByRole<HTMLInputElement>('radio', { name: 'Correct answer 2' });
    await user.click(firstAnswer);
    await user.click(firstAnswer);
    expect(firstAnswer.checked).toBe(true);
    await user.click(secondAnswer);
    expect(firstAnswer.checked).toBe(false);
    expect(secondAnswer.checked).toBe(true);

    await user.click(screen.getByText('Allow Multiple Answers'));
    const firstCheckbox = screen.getByRole<HTMLInputElement>('checkbox', {
      name: 'Correct answer 1',
    });
    const secondCheckbox = screen.getByRole<HTMLInputElement>('checkbox', {
      name: 'Correct answer 2',
    });
    expect(secondCheckbox.checked).toBe(true);
    await user.click(firstCheckbox);
    expect(firstCheckbox.checked).toBe(true);
    expect(secondCheckbox.checked).toBe(true);
    await user.click(firstCheckbox);
    expect(firstCheckbox.checked).toBe(false);
  });

  it('requires a correct answer for a quiz and preserves the chosen answer', async () => {
    const onSubmit = vi.fn();
    render(<ComposerListDialog kind="poll" onClose={() => {}} onSubmit={onSubmit} />);
    fillField('Ask a Question', 'Which one?');
    fillField('Option 1', 'First');
    fillField('Option 2', 'Second');
    await userEvent.click(screen.getByText('Set Correct Answer'));
    expect(screen.getByRole('button', { name: 'Create' }).hasAttribute('disabled')).toBe(true);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Correct answer 2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const poll = onSubmit.mock.calls[0][0].media;
    expect(poll.options).toHaveLength(2);
    const correctAnswer = poll.options.find((option: { text: string }) => option.text === 'Second');
    expect(poll.correctOptionIds).toEqual([correctAnswer.id]);
    expect(poll.canRevote).toBe(false);
    expect(poll.canAddOptions).toBe(false);
  });

  it('redirects the empty add row and removes a cleared answer with Backspace', async () => {
    const user = userEvent.setup();
    render(<ComposerListDialog kind="poll" onClose={() => {}} onSubmit={() => {}} />);
    await user.click(screen.getByRole('textbox', { name: 'Option 2' }));
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Option 1' }));
    fillField('Option 1', 'First');
    fillField('Option 2', 'Second');
    fillField('Option 3', 'Third');
    await user.click(screen.getByRole('textbox', { name: 'Option 2' }));
    await user.clear(screen.getByRole('textbox', { name: 'Option 2' }));
    await user.keyboard('{Backspace}');
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Option 1' }));
    expect(screen.getByRole('textbox', { name: 'Option 2' }).getAttribute('value')).toBe('Third');
  });

  it('keeps task identities and permissions when an earlier task is removed', async () => {
    const onSubmit = vi.fn();
    render(<ComposerListDialog kind="checklist" onClose={() => {}} onSubmit={onSubmit} />);
    fillField('Title', 'Release');
    fillField('Task 1', 'Obsolete');
    fireEvent.click(screen.getByRole('button', { name: 'Add Task' }));
    fillField('Task 2', 'Ship');
    fireEvent.click(screen.getByRole('button', { name: 'Delete task 1' }));
    await userEvent.click(screen.getByText('Allow Others to Add Tasks'));
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(onSubmit).toHaveBeenCalledWith({
      text: '',
      media: {
        kind: 'checklist',
        title: 'Release',
        items: [
          {
            id: expect.any(String),
            text: 'Ship',
            isCompleted: false,
          },
        ],
        canOthersComplete: false,
        canOthersAppend: true,
      },
    });
  });
});
