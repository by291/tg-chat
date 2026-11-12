// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Message } from '@/domain/messages/message';
import type { ChecklistMedia } from '@/domain/messages/media';
import {
  StructuredMessageActionsProvider,
  useStructuredMessageActions,
} from '../../StructuredMessageActions';
import { ChecklistMessage } from './ChecklistMessage';

const checklist: ChecklistMedia = {
  kind: 'checklist',
  title: 'Meeting tasks',
  items: [{ id: 'existing', text: 'Book room', isCompleted: true }],
  canAppend: true,
  canOthersAppend: true,
  canOthersComplete: true,
  listVersion: '3',
};

const message: Message = {
  id: 'meeting',
  chatId: 'conversation',
  authorId: 'author',
  authorName: 'Author',
  text: '',
  createdAt: 0,
  reactions: [],
};

function AddTasksMenuAction() {
  const { dispatch } = useStructuredMessageActions();
  return (
    <button onClick={() => dispatch({ messageId: message.id, action: 'add-task' })}>
      Add Task
    </button>
  );
}

afterEach(cleanup);

it('submits multiple checklist tasks together against the same list revision', async () => {
  const onInteract = vi.fn(async () => true);
  render(
    <StructuredMessageActionsProvider>
      <AddTasksMenuAction />
      <ChecklistMessage message={message} checklist={checklist} onInteract={onInteract} />
    </StructuredMessageActionsProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Add Task' }));

  const dialog = within(screen.getByRole('dialog', { name: 'Add tasks' }));
  fireEvent.change(dialog.getByRole('textbox', { name: 'Task 1' }), {
    target: { value: 'Print agenda' },
  });
  fireEvent.click(dialog.getByRole('button', { name: 'Add Task' }));
  fireEvent.change(dialog.getByRole('textbox', { name: 'Task 2' }), {
    target: { value: 'Send minutes' },
  });
  fireEvent.click(dialog.getByRole('button', { name: 'Save tasks' }));

  expect(onInteract).toHaveBeenCalledOnce();
  expect(onInteract).toHaveBeenCalledWith({
    type: 'append-tasks',
    expectedListVersion: '3',
    tasks: [
      { id: expect.any(String), text: 'Print agenda' },
      { id: expect.any(String), text: 'Send minutes' },
    ],
  });
});
