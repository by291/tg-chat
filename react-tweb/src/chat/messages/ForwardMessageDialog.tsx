import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { useState } from 'react';
import { Check, CheckCircle2, Search, Send, X } from 'lucide-react';
import { Avatar } from '../../components/Avatar';
import { IconButton } from '../../components/IconButton';
import { Ripple } from '../../components/Ripple';
import { EmojiPicker } from '../composer/EmojiPicker';
import { getConversationList } from '../sidebar/conversationList';
import type { ChatState, Conversation } from '../model';
import overlays from '../overlays.module.css';
import styles from './ForwardMessageDialog.module.css';

export interface ForwardRecipients {
  recipients: Conversation[];
  caption: string;
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
  const [query, setQuery] = useState('');
  const [caption, setCaption] = useState('');
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
  const recipients = conversations.filter((conversation) => recipientIds.includes(conversation.id));
  const hasRecipients = recipients.length > 0;

  function chooseRecipient(conversation: Conversation) {
    if (!isSelecting) {
      onChooseRecipient(conversation);
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

  function appendEmoji(emoji: string) {
    setCaption((current) => current + emoji);
  }

  function sendToRecipients() {
    if (hasRecipients) {
      onSend({ recipients, caption: caption.trim() });
    }
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(details) => {
        if (!details.open) {
          onClose();
        }
      }}
    >
      <Portal>
        <Dialog.Backdrop className={`${overlays.backdrop} ${styles.backdrop}`} />
        <Dialog.Positioner className={`${overlays.dialogPositioner} ${styles.positioner}`}>
          <Dialog.Content className={styles.dialog} data-selecting={isSelecting}>
            <header className={styles.header}>
              <IconButton label="Close forwarding" onClick={onClose}>
                <X />
              </IconButton>
              <Dialog.Title>Share with</Dialog.Title>
              {!isSelecting && (
                <IconButton label="Select recipients" onClick={() => setIsSelecting(true)}>
                  <CheckCircle2 />
                </IconButton>
              )}
            </header>
            <div className={styles.search}>
              {!hasRecipients && <Search size={22} />}
              {recipients.map((recipient) => (
                <button
                  key={recipient.id}
                  className={styles.chip}
                  aria-label={`Remove ${recipient.title}`}
                  onClick={() => chooseRecipient(recipient)}
                >
                  <Avatar initials={recipient.initials} color={recipient.color} size="small" />
                  <span>{recipient.title}</span>
                  <X size={14} />
                </button>
              ))}
              <input
                aria-label="Search recipients"
                placeholder={hasRecipients ? '' : 'Search'}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div
              className={styles.savedSection}
              data-collapsed={hasRecipients || Boolean(query)}
              inert={hasRecipients || Boolean(query)}
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
                  {isSelecting && (
                    <span className={styles.checkbox} aria-hidden="true">
                      {recipientIds.includes(conversation.id) && <Check size={16} />}
                    </span>
                  )}
                  <Ripple />
                </button>
              ))}
              {matchingConversations.length === 0 && <p>No conversations found</p>}
            </div>
            <footer className={styles.footer} inert={!isSelecting} aria-hidden={!isSelecting}>
              <div className={styles.caption}>
                <EmojiPicker onSelectEmoji={appendEmoji} />
                <input
                  aria-label="Forward caption"
                  placeholder="Add a caption..."
                  value={caption}
                  onChange={(event) => setCaption(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                      sendToRecipients();
                    }
                  }}
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
