import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { useRef, useState } from 'react';
import { MathPreview } from './MathNode';
import dialogs from '@/features/conversations/ConversationDialogs.module.css';
import styles from './ComposerFormattingToolbar.module.css';

export type ComposerDialogKind = 'link' | 'date' | 'math' | 'language';

export interface ComposerDialogValue {
  text: string;
  isBlock: boolean;
}

interface ComposerFormatDialogProps {
  kind: ComposerDialogKind;
  initialValue: ComposerDialogValue;
  onSubmit: (value: ComposerDialogValue) => void;
  onClose: () => void;
  getEditorElement: () => HTMLElement | null;
}

const DIALOG_LABELS = {
  link: {
    title: 'Edit link',
    field: 'URL',
    placeholder: 'https://example.com',
  },
  date: {
    title: 'Insert date',
    field: 'Date and time',
    placeholder: '',
  },
  math: {
    title: 'Insert formula',
    field: 'LaTeX',
    placeholder: 'e^{i\\pi} + 1 = 0',
  },
  language: {
    title: 'Code language',
    field: 'Language',
    placeholder: 'javascript',
  },
};

/** Edit a formatting value while Ark manages focus trapping and Escape dismissal. */
export function ComposerFormatDialog({
  kind,
  initialValue,
  onSubmit,
  onClose,
  getEditorElement,
}: ComposerFormatDialogProps) {
  const [text, setText] = useState(initialValue.text);
  const [isBlock, setIsBlock] = useState(initialValue.isBlock);
  const inputRef = useRef<HTMLInputElement>(null);
  const labels = DIALOG_LABELS[kind];
  const isRequired = kind === 'date' || kind === 'math';
  const inputType = kind === 'date' ? 'datetime-local' : 'text';

  return (
    <Dialog.Root
      open
      initialFocusEl={() => inputRef.current}
      finalFocusEl={getEditorElement}
      onOpenChange={({ open }) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <Portal>
        <Dialog.Backdrop className={`${dialogs.backdrop} ${styles.backdrop}`} />
        <Dialog.Positioner className={styles.dialogPositioner}>
          <Dialog.Content className={`${dialogs.confirmation} ${styles.dialog}`}>
            <Dialog.Title className={styles.dialogTitle}>{labels.title}</Dialog.Title>
            <Dialog.Description className={styles.dialogDescription}>
              {kind === 'link'
                ? 'Leave the URL empty to remove the link.'
                : 'Apply to your message.'}
            </Dialog.Description>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                onSubmit({ text, isBlock });
              }}
            >
              <label className={styles.field}>
                <span>{labels.field}</span>
                <input
                  ref={inputRef}
                  type={inputType}
                  value={text}
                  placeholder={labels.placeholder}
                  required={isRequired}
                  onChange={(event) => setText(event.target.value)}
                />
              </label>
              {kind === 'math' && (
                <>
                  <label className={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={isBlock}
                      onChange={(event) => setIsBlock(event.target.checked)}
                    />
                    Separate line
                  </label>
                  <div className={styles.preview} aria-label="Formula preview">
                    <MathPreview source={text || labels.placeholder} isBlock={isBlock} />
                  </div>
                </>
              )}
              <div className={styles.dialogActions}>
                <button type="button" onClick={onClose}>
                  Cancel
                </button>
                <button type="submit">Apply</button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
