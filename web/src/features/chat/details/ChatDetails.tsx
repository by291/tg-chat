import { Tabs } from '@ark-ui/react/tabs';
import {
  Bell,
  BellOff,
  Info,
  MessageCircle,
  LogOut,
  Pencil,
  UserPlus,
  Video,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type Dispatch } from 'react';
import { Avatar } from '@/components/Avatar';
import { IconButton } from '@/components/IconButton';
import { Ripple } from '@/components/Ripple';
import { HeaderActionDialog } from '../HeaderActionDialog';
import type { ChatAction } from '@/features/chat/state/chatActions';
import type { ChatState } from '@/features/chat/state/chatState';
import type { Conversation } from '@/domain/conversations/conversation';
import type { Message } from '@/domain/messages/message';
import { getPhotoMessages } from '@/features/media/photoGallery';
import { ConversationRemovalDialog } from '@/features/conversations/ConversationDialogs';
import { useSidebarActions } from '@/features/conversations/useSidebarActions';
import { useConversationDirectory } from '@/features/conversations/ConversationDirectory';
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
  shouldManageFocus?: boolean;
  isMuted: boolean;
  onToggleMute: () => void;
  onClose: () => void;
  onMessage?: () => void;
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
  dispatch,
  isOpen,
  shouldManageFocus = true,
  isMuted,
  onToggleMute,
  onClose,
  onMessage,
  onOpenMedia,
}: ChatDetailsProps) {
  const isGroup = conversation.kind === 'group';
  const canEdit = isGroup || conversation.kind === 'channel';
  const [requestedTab, setRequestedTab] = useState('');
  const [direction, setDirection] = useState<'forward' | 'backward'>();
  const [isCallOpen, setIsCallOpen] = useState(false);
  const [profileMode, setProfileMode] = useState<'edit' | 'members'>();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { entries, entriesById, privateConversations } = useConversationDirectory();
  const actions = useSidebarActions({ conversations: entries, dispatch });
  const entry = entriesById.get(conversation.id);
  const contacts = privateConversations.filter((candidate) => candidate.isContact !== false);
  // Existing group membership does not depend on whether a peer is in the address book.
  const members = privateConversations.filter((candidate) => {
    return conversation.memberIds?.includes(candidate.id);
  });
  const hasPhotos = getPhotoMessages(messages).length > 0;
  const tabs = SHARED_TABS.filter((tab) => {
    if (tab.value === 'members') {
      return isGroup;
    }
    if (tab.value === 'media') {
      return hasPhotos || messages.some((message) => message.media?.kind === 'video');
    }

    const mediaKind = tab.value === 'files' ? 'document' : 'voice';
    return messages.some((message) => message.media?.kind === mediaKind);
  });
  const hasRequestedTab = tabs.some((tab) => tab.value === requestedTab);
  const selectedTab = hasRequestedTab ? requestedTab : (tabs[0]?.value ?? '');
  const transitionDirection = hasRequestedTab ? direction : undefined;

  useEffect(() => {
    // Counter-driven categories can disappear; automatic fallback must not slide the profile.
    if (requestedTab !== selectedTab) {
      setRequestedTab(selectedTab);
      setDirection(undefined);
    }
  }, [requestedTab, selectedTab]);

  useEffect(() => {
    // Modal profiles delegate focus restoration to their dialog focus scope.
    if (!isOpen || !shouldManageFocus) {
      return;
    }

    const previousFocus = document.activeElement;
    closeButtonRef.current?.focus({ preventScroll: true });

    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [isOpen, shouldManageFocus]);

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
          {onMessage && (
            <button type="button" aria-label="Message" onClick={onMessage}>
              <MessageCircle />
              <span>message</span>
              <Ripple />
            </button>
          )}
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
        {tabs.length > 0 && (
          <Tabs.Root
            value={selectedTab}
            onValueChange={({ value }) => {
              const previousIndex = tabs.findIndex((tab) => tab.value === selectedTab);
              const nextIndex = tabs.findIndex((tab) => tab.value === value);
              setDirection(nextIndex > previousIndex ? 'forward' : 'backward');
              setRequestedTab(value);
            }}
            className={styles.tabs}
            lazyMount
            unmountOnExit
          >
            <Tabs.List className={styles.tabList} hidden={tabs.length === 1}>
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
                  data-direction={transitionDirection}
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
                    data-direction={transitionDirection}
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
        )}
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
