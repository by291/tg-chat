import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { useState } from 'react';
import type { ComposedMessage } from './MessageComposer';
import overlays from '../overlays.module.css';
import dialogs from '../sidebar/ConversationDialogs.module.css';
import styles from './ComposerListDialog.module.css';

const MIN_POLL_OPTIONS = 2;
const MAX_LIST_ITEMS = 10;

interface ComposerListDialogProps {
  kind: 'poll' | 'checklist';
  onClose: () => void;
  onSubmit: (message: ComposedMessage) => void;
}

function createChecklist(title: string, items: string[]) {
  // Text nodes keep user-entered markup literal before the shared message sanitizer runs.
  const container = document.createElement('div');
  const heading = document.createElement('p');
  const strong = document.createElement('strong');
  strong.textContent = title;
  heading.append(strong);
  const list = document.createElement('ul');
  list.dataset.listType = 'check';
  for (const text of items) {
    const item = document.createElement('li');
    item.setAttribute('aria-checked', 'false');
    item.textContent = text;
    list.append(item);
  }
  container.append(heading, list);
  return container.innerHTML;
}

/** Create local poll or checklist content while leaving the ordinary draft intact. */
export function ComposerListDialog({ kind, onClose, onSubmit }: ComposerListDialogProps) {
  const [title, setTitle] = useState('');
  const [itemText, setItemText] = useState('');
  const items = itemText
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
  const isPoll = kind === 'poll';
  const minimumItems = isPoll ? MIN_POLL_OPTIONS : 1;
  const canSubmit =
    Boolean(title.trim()) && items.length >= minimumItems && items.length <= MAX_LIST_ITEMS;

  function submit() {
    if (!canSubmit) {
      return;
    }
    if (isPoll) {
      onSubmit({
        text: '',
        media: {
          kind: 'poll',
          question: title.trim(),
          options: items.map((text) => ({ id: crypto.randomUUID(), text, votes: 0 })),
        },
      });
    } else {
      onSubmit({
        text: [title.trim(), ...items].join('\n'),
        richText: createChecklist(title.trim(), items),
      });
    }
    onClose();
  }

  return (
    <Dialog.Root
      open
      onOpenChange={({ open }) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <Portal>
        <Dialog.Backdrop className={dialogs.backdrop} />
        <Dialog.Positioner className={overlays.dialogPositioner}>
          <Dialog.Content className={`${dialogs.confirmation} ${styles.dialog}`}>
            <Dialog.Title>{isPoll ? 'New Poll' : 'New Checklist'}</Dialog.Title>
            <Dialog.Description>
              Enter each {isPoll ? 'answer' : 'task'} on its own line.
            </Dialog.Description>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <label>
                {isPoll ? 'Question' : 'Title'}
                <input value={title} onChange={(event) => setTitle(event.target.value)} required />
              </label>
              <label>
                {isPoll ? 'Answers' : 'Tasks'}
                <textarea
                  value={itemText}
                  onChange={(event) => setItemText(event.target.value)}
                  rows={5}
                  required
                />
              </label>
              <div className={styles.actions}>
                <button type="button" onClick={onClose}>
                  Cancel
                </button>
                <button type="submit" disabled={!canSubmit}>
                  Create
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
