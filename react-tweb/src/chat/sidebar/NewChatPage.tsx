import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { useState, type Dispatch } from 'react';
import { Avatar } from '../../components/Avatar';
import { IconButton } from '../../components/IconButton';
import { Ripple } from '../../components/Ripple';
import type { ChatAction, Conversation } from '../model';
import type { NewChatMode } from './NewChatMenu';
import styles from './NewChat.module.css';

interface NewChatPageProps {
  mode: NewChatMode;
  conversations: Conversation[];
  dispatch: Dispatch<ChatAction>;
  onBack: () => void;
  onSelectChat: (chatId: string) => void;
}

const PAGE_TITLES = {
  group: 'New Group',
  channel: 'New Channel',
  private: 'Contacts',
  call: 'New Group Call',
};

/** Choose local contacts before naming a group, or open an existing private conversation. */
export function NewChatPage({
  mode,
  conversations,
  dispatch,
  onBack,
  onSelectChat,
}: NewChatPageProps) {
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState('');
  const [about, setAbout] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isNaming, setIsNaming] = useState(mode === 'channel');
  const isGroup = mode === 'group';
  const contacts = conversations.filter((conversation) => {
    return (
      conversation.kind === 'private' &&
      conversation.isContact !== false &&
      conversation.title.toLowerCase().includes(query.toLowerCase())
    );
  });
  const nameLabel = isGroup ? 'Group Name' : 'Channel Name';

  function createConversation() {
    const name = title.trim();
    if (!name) {
      return;
    }
    const conversation: Conversation = {
      id: `local-${crypto.randomUUID()}`,
      kind: isGroup ? 'group' : 'channel',
      title: name,
      subtitle: isGroup ? `${selectedIds.length + 1} members` : '1 subscriber',
      initials: Array.from(name)[0].toUpperCase(),
      color: 'blue',
      preview: '',
      time: '',
      about: about.trim(),
      memberIds: ['you', ...selectedIds],
    };
    dispatch({ type: 'save-conversation', conversation });
    onSelectChat(conversation.id);
  }

  function toggleContact(chatId: string) {
    setSelectedIds((current) => {
      return current.includes(chatId)
        ? current.filter((selectedId) => selectedId !== chatId)
        : [...current, chatId];
    });
  }

  return (
    <section className={styles.page} aria-label={PAGE_TITLES[mode]}>
      <header className={styles.header}>
        <IconButton
          label="Back to chats"
          onClick={() => {
            if (isGroup && isNaming) {
              setIsNaming(false);
              return;
            }
            onBack();
          }}
        >
          <ArrowLeft />
        </IconButton>
        <h2>{PAGE_TITLES[mode]}</h2>
      </header>
      {mode === 'call' && (
        <p className={styles.hint}>
          Group calls require a Telegram connection. This local demo does not connect to a call.
        </p>
      )}
      {isNaming && (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            createConversation();
          }}
        >
          <Avatar initials={title.trim().charAt(0).toUpperCase() || '+'} size="large" />
          <label>
            {nameLabel}
            <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label>
            Description (optional)
            <textarea value={about} onChange={(event) => setAbout(event.target.value)} />
          </label>
          <button className={styles.nextButton} disabled={!title.trim()} type="submit">
            <Check /> {isGroup ? 'Create Group' : 'Create Channel'}
          </button>
        </form>
      )}
      {!isNaming && mode !== 'call' && (
        <>
          <input
            className={styles.search}
            aria-label="Search contacts"
            placeholder="Search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className={styles.contacts}>
            {contacts.map((contact) => (
              <button
                key={contact.id}
                className={styles.contact}
                role={isGroup ? 'checkbox' : undefined}
                aria-checked={isGroup ? selectedIds.includes(contact.id) : undefined}
                onClick={() => {
                  if (isGroup) {
                    toggleContact(contact.id);
                    return;
                  }
                  onSelectChat(contact.id);
                }}
              >
                <Avatar initials={contact.initials} color={contact.color} />
                <span>
                  <strong>{contact.title}</strong>
                  <small>{contact.subtitle}</small>
                </span>
                {selectedIds.includes(contact.id) && <Check />}
                <Ripple />
              </button>
            ))}
            {contacts.length === 0 && <p className={styles.hint}>No contacts found</p>}
          </div>
          {isGroup && (
            <button className={styles.nextButton} onClick={() => setIsNaming(true)}>
              <ArrowRight /> Next
            </button>
          )}
        </>
      )}
    </section>
  );
}
