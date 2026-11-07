import { Tabs } from '@ark-ui/react/tabs';
import { Bell, BellOff, Info, LogOut, Pencil, UserPlus, Video, X } from 'lucide-react';
import { useEffect, useRef, useState, type Dispatch } from 'react';
import { Avatar } from '../../components/Avatar';
import { IconButton } from '../../components/IconButton';
import { Ripple } from '../../components/Ripple';
import { HeaderActionDialog } from '../HeaderActionDialog';
import type { ChatAction, ChatState, Conversation, Message } from '../model';
import { getConversations } from '../state/conversations';
import { ConversationRemovalDialog } from '../sidebar/ConversationDialogs';
import { useSidebarActions } from '../sidebar/useSidebarActions';
import { useConversationList } from '../sidebar/conversationList';
import { ChatSharedMedia } from './ChatSharedMedia';
import { ChatProfileDialog } from './ChatProfileDialog';
import styles from './ChatDetails.module.css';

const SHARED_TABS = [
  { value: 'members', label: 'Members' },
  { value: 'media', label: 'Media' },
  { value: 'files', label: 'Files' },
  { value: 'voice', label: 'Voice' },
];

interface ChatDetailsProps {
  conversation: Conversation;
  messages: Message[];
  state: ChatState;
  dispatch: Dispatch<ChatAction>;
  isOpen: boolean;
  isMuted: boolean;
  onToggleMute: () => void;
  onClose: () => void;
  onOpenMedia: (message: Message) => void;
}

function getProfileTitle(conversation: Conversation) {
  if (conversation.kind === 'group') {
    return 'Group Info';
  }
  return conversation.kind === 'channel' ? 'Channel Info' : 'User Info';
}

/** Display the floating profile, local actions, and animated shared-content categories. */
export function ChatDetails({
  conversation,
  messages,
  state,
  dispatch,
  isOpen,
  isMuted,
  onToggleMute,
  onClose,
  onOpenMedia,
}: ChatDetailsProps) {
  const isGroup = conversation.kind === 'group';
  const canEdit = isGroup || conversation.kind === 'channel';
  const [selectedTab, setSelectedTab] = useState(isGroup ? 'members' : 'media');
  const [direction, setDirection] = useState('forward');
  const [isCallOpen, setIsCallOpen] = useState(false);
  const [profileMode, setProfileMode] = useState<'edit' | 'members'>();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const entries = useConversationList(state);
  const actions = useSidebarActions({ conversations: entries, dispatch });
  const entry = entries.find((candidate) => candidate.id === conversation.id);
  const contacts = getConversations(state).filter((candidate) => candidate.kind === 'private');
  const members = contacts.filter((contact) => conversation.memberIds?.includes(contact.id));
  const tabs = SHARED_TABS.filter((tab) => isGroup || tab.value !== 'members');

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const previousFocus = document.activeElement;
    closeButtonRef.current?.focus({ preventScroll: true });
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [isOpen]);

  return (
    <aside
      className={styles.details}
      aria-label="Chat information"
      onKeyDown={(event) => {
        const hasDialog = isCallOpen || profileMode || actions.confirmation;
        if (event.key === 'Escape' && !event.defaultPrevented && !hasDialog) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <header className={styles.header}>
        <IconButton ref={closeButtonRef} label="Close chat information" onClick={onClose}>
          <X />
        </IconButton>
        <h2>{getProfileTitle(conversation)}</h2>
        {canEdit && (
          <IconButton label="Edit chat information" onClick={() => setProfileMode('edit')}>
            <Pencil />
          </IconButton>
        )}
      </header>
      <div className={styles.scrollContent}>
        <div className={styles.profile}>
          <Avatar initials={conversation.initials} color={conversation.color} size="large" />
          <h1>{conversation.title}</h1>
          <p>{conversation.subtitle}</p>
        </div>
        <div className={styles.actions}>
          <button aria-label={isMuted ? 'Unmute' : 'Mute'} onClick={onToggleMute}>
            {isMuted ? <Bell /> : <BellOff />}
            <span>{isMuted ? 'unmute' : 'mute'}</span>
            <Ripple />
          </button>
          <button aria-label="Video chat" onClick={() => setIsCallOpen(true)}>
            <Video />
            <span>video chat</span>
            <Ripple />
          </button>
          {canEdit && (
            <button
              aria-label={isGroup ? 'Leave group' : 'Leave channel'}
              onClick={() => {
                if (entry) {
                  actions.runMenuAction(entry, 'delete');
                }
              }}
            >
              <LogOut />
              <span>leave</span>
              <Ripple />
            </button>
          )}
        </div>
        {conversation.about && (
          <section className={styles.about}>
            <Info size={24} />
            <div>
              <p>{conversation.about}</p>
              <span>About</span>
            </div>
          </section>
        )}
        <Tabs.Root
          value={selectedTab}
          onValueChange={({ value }) => {
            const previousIndex = tabs.findIndex((tab) => tab.value === selectedTab);
            const nextIndex = tabs.findIndex((tab) => tab.value === value);
            setDirection(nextIndex > previousIndex ? 'forward' : 'backward');
            setSelectedTab(value);
          }}
          className={styles.tabs}
          lazyMount
          unmountOnExit
        >
          <Tabs.List className={styles.tabList}>
            {tabs.map((tab) => (
              <Tabs.Trigger key={tab.value} value={tab.value}>
                {tab.label}
                <Ripple />
              </Tabs.Trigger>
            ))}
            <Tabs.Indicator className={styles.indicator} />
          </Tabs.List>
          <div className={styles.tabStage}>
            {isGroup && (
              <Tabs.Content
                value="members"
                className={styles.tabContent}
                data-direction={direction}
                inert={selectedTab !== 'members'}
                aria-hidden={selectedTab !== 'members'}
              >
                <div className={styles.members}>
                  <div className={styles.member}>
                    <Avatar initials="Y" color="purple" size="small" />
                    <span>
                      <strong>You</strong>
                      <span>online</span>
                    </span>
                    <small>owner</small>
                  </div>
                  {members.map((member) => (
                    <div key={member.id} className={styles.member}>
                      <Avatar initials={member.initials} color={member.color} size="small" />
                      <span>
                        <strong>{member.title.split(' ')[0]}</strong>
                        <span>{member.subtitle}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </Tabs.Content>
            )}
            {tabs
              .filter((tab) => tab.value !== 'members')
              .map((tab) => (
                <Tabs.Content
                  key={tab.value}
                  value={tab.value}
                  className={styles.tabContent}
                  data-direction={direction}
                  inert={selectedTab !== tab.value}
                  aria-hidden={selectedTab !== tab.value}
                >
                  <ChatSharedMedia
                    category={tab.value}
                    messages={messages}
                    isActive={isOpen && selectedTab === tab.value}
                    onOpenMedia={onOpenMedia}
                  />
                </Tabs.Content>
              ))}
          </div>
        </Tabs.Root>
      </div>
      {isGroup && (
        <IconButton
          label="Add Members"
          className={styles.addMembers}
          onClick={() => setProfileMode('members')}
        >
          <UserPlus />
        </IconButton>
      )}
      <HeaderActionDialog
        mode={isCallOpen ? 'call' : undefined}
        selectedCount={0}
        onClose={() => setIsCallOpen(false)}
        onAutoDelete={() => {}}
        onDelete={() => {}}
      />
      <ConversationRemovalDialog
        request={actions.confirmation}
        onCancel={actions.cancelRemoval}
        onConfirm={actions.confirmRemoval}
      />
      <ChatProfileDialog
        mode={profileMode}
        conversation={conversation}
        contacts={contacts}
        onClose={() => setProfileMode(undefined)}
        onSave={(updated) => {
          dispatch({ type: 'save-conversation', conversation: updated });
          setProfileMode(undefined);
        }}
      />
    </aside>
  );
}
