import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { useRef, useState } from 'react';
import { CheckCircle2, Send, X } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { IconButton } from '@/components/IconButton';
import { Ripple } from '@/components/Ripple';
import { EmojiEditor, type EmojiEditorControls } from '../composer/EmojiEditor';
import type { EmojiText, CustomEmojiEntity } from '@/features/emoji/customEmojiEntities';
import { EmojiPicker } from '../composer/EmojiPicker';
import { getConversationList } from '@/features/conversations/conversationList';
import type { ChatState, Conversation } from '../model';
import overlays from '../overlays.module.css';
import styles from './ForwardMessageDialog.module.css';
import { ForwardRecipientSearch } from './ForwardRecipientSearch';
import { MessageCheckbox } from './MessageCheckbox';

export interface ForwardRecipients {
  recipients: Conversation[];
  caption: string;
  customEmoji?: CustomEmojiEntity[];
  richText?: string;
}

interface ForwardMessageDialogProps {
  state: ChatState;
  onClose: () => void;
  onChooseRecipient: (conversation: Conversation) => void;
  onSend: (options: ForwardRecipients) => void;
}

/** Pick a destination draft, or explicitly send to several local recipients. */
export function ForwardMessageDialog({
  state,
  onClose,
  onChooseRecipient,
  onSend,
}: ForwardMessageDialogProps) {
  const [isOpen, setIsOpen] = useState(true);
  const closingActionRef = useRef<(() => void) | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [caption, setCaption] = useState<EmojiText>({ text: '' });
  const [editorError, setEditorError] = useState('');
  const editorRef = useRef<EmojiEditorControls>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  const conversations = getConversationList(state).sort((first, second) => {
    return Number(second.kind === 'saved') - Number(first.kind === 'saved');
  });
  const saved = conversations.find((conversation) => conversation.kind === 'saved');
  const normalizedQuery = query.trim().toLowerCase();
  const matchingConversations = conversations.filter((conversation) => {
    return conversation.title.toLowerCase().includes(normalizedQuery);
  });
  const recipients = recipientIds.flatMap((id) => {
    const conversation = conversations.find((candidate) => candidate.id === id);
    return conversation ? [conversation] : [];
  });
  const hasRecipients = recipients.length > 0;

  function closeWithAction(action: () => void) {
    if (!isOpen || closingActionRef.current) {
      return;
    }
    // The destination can unmount this conversation, so hand it off only after presence exits.
    closingActionRef.current = action;
    setIsOpen(false);
  }

  function finishClosing() {
    const action = closingActionRef.current;
    closingActionRef.current = undefined;
    action?.();
  }

  function cancelForwarding() {
    closeWithAction(onClose);
  }

  function chooseRecipient(conversation: Conversation) {
    if (!isSelecting) {
      closeWithAction(() => onChooseRecipient(conversation));
      return;
    }
    setRecipientIds((current) => {
      if (current.includes(conversation.id)) {
        return current.filter((id) => id !== conversation.id);
      }
      return [...current, conversation.id];
    });
    setQuery('');
  }

  function sendToRecipients() {
    if (hasRecipients) {
      const selection = {
        recipients,
        caption: caption.text,
        customEmoji: caption.customEmoji,
        richText: caption.richText,
      };
      closeWithAction(() => onSend(selection));
    }
  }

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={({ open }) => {
        if (!open) {
          cancelForwarding();
        }
      }}
      onExitComplete={finishClosing}
      unmountOnExit
    >
      <Portal>
        <Dialog.Backdrop className={styles.backdrop} />
        <Dialog.Positioner className={`${overlays.dialogPositioner} ${styles.positioner}`}>
          <Dialog.Content className={styles.dialog} data-selecting={isSelecting} inert={!isOpen}>
            <header className={styles.header}>
              <IconButton label="Close forwarding" onClick={cancelForwarding}>
                <X />
              </IconButton>
              <Dialog.Title>Share with</Dialog.Title>
              {!isSelecting && (
                <IconButton label="Select recipients" onClick={() => setIsSelecting(true)}>
                  <CheckCircle2 />
                </IconButton>
              )}
            </header>
            <ForwardRecipientSearch
              recipients={recipients}
              query={query}
              onQueryChange={setQuery}
              onRemove={chooseRecipient}
            />
            <div
              className={styles.savedSection}
              data-collapsed={Boolean(query)}
              inert={Boolean(query)}
            >
              {saved && (
                <button className={styles.saved} onClick={() => chooseRecipient(saved)}>
                  <Avatar initials={saved.initials} color={saved.color} />
                  <span>Saved</span>
                  <Ripple />
                </button>
              )}
            </div>
            <div className={styles.tabs}>
              <span>All</span>
            </div>
            <div className={styles.recipients}>
              {matchingConversations.map((conversation) => (
                <button
                  key={conversation.id}
                  className={styles.recipient}
                  aria-pressed={isSelecting ? recipientIds.includes(conversation.id) : undefined}
                  onClick={() => chooseRecipient(conversation)}
                >
                  <Avatar
                    initials={conversation.initials}
                    color={conversation.color}
                    size="small"
                  />
                  <span className={styles.recipientText}>
                    <strong>{conversation.title}</strong>
                    <span>
                      {conversation.kind === 'saved'
                        ? 'forward here to save'
                        : conversation.subtitle}
                    </span>
                  </span>
                  <span className={styles.checkbox} aria-hidden="true">
                    <MessageCheckbox isChecked={recipientIds.includes(conversation.id)} />
                  </span>
                  <Ripple />
                </button>
              ))}
              {matchingConversations.length === 0 && <p>No conversations found</p>}
            </div>
            {editorError && <p role="alert">{editorError}</p>}
            <footer className={styles.footer} inert={!isSelecting} aria-hidden={!isSelecting}>
              <div className={styles.caption}>
                <EmojiPicker
                  onSelectEmoji={(emoji) => editorRef.current?.insertEmoji(emoji)}
                  onSelectCustomEmoji={(emoji) => editorRef.current?.insertCustomEmoji(emoji)}
                />
                <EmojiEditor
                  controlsRef={editorRef}
                  label="Forward caption"
                  placeholder="Add a caption..."
                  value={caption}
                  onChange={setCaption}
                  onSubmit={sendToRecipients}
                  onCancel={cancelForwarding}
                  onPasteImage={() => setEditorError('Add photos in the conversation composer.')}
                  onError={setEditorError}
                />
              </div>
              <IconButton
                label="Send forwarded messages"
                className={styles.send}
                disabled={!hasRecipients}
                onClick={sendToRecipients}
              >
                <Send />
              </IconButton>
            </footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
