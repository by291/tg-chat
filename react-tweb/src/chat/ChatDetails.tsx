import { Tabs } from '@ark-ui/react/tabs';
import { Bell, BellOff, Image, Info, Users, X } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '../shared/Avatar';
import { IconButton } from '../shared/IconButton';
import type { Conversation, Message } from './model';
import styles from './ChatDetails.module.css';

interface ChatDetailsProps {
  conversation: Conversation;
  messages: Message[];
  onClose: () => void;
  onOpenMedia: (message: Message) => void;
}

/** Display local conversation information and a browsable gallery of attached photos. */
export function ChatDetails({ conversation, messages, onClose, onOpenMedia }: ChatDetailsProps) {
  const [isMuted, setIsMuted] = useState(false);
  const mediaMessages = messages.filter((message) => message.attachment);

  return (
    <aside className={styles.details} aria-label="Chat information">
      <header className={styles.header}>
        <IconButton label="Close chat information" onClick={onClose}>
          <X />
        </IconButton>
        <h2>Chat Info</h2>
      </header>
      <div className={styles.profile}>
        <Avatar initials={conversation.initials} color={conversation.color} size="large" />
        <h1>{conversation.title}</h1>
        <p>{conversation.subtitle}</p>
      </div>
      <button className={styles.notificationButton} onClick={() => setIsMuted(!isMuted)}>
        {isMuted ? <BellOff size={22} /> : <Bell size={22} />}
        <span>{isMuted ? 'Unmute' : 'Mute'}</span>
      </button>
      <section className={styles.about}>
        <Info size={23} />
        <div>
          <p>A small space for ideas, experiments, and things worth sharing.</p>
          <span>About</span>
        </div>
      </section>
      <Tabs.Root defaultValue="members" className={styles.tabs}>
        <Tabs.List className={styles.tabList}>
          <Tabs.Trigger value="members">
            <Users size={16} /> Members
          </Tabs.Trigger>
          <Tabs.Trigger value="media">
            <Image size={16} /> Media
          </Tabs.Trigger>
          <Tabs.Indicator className={styles.indicator} />
        </Tabs.List>
        <Tabs.Content value="members" className={styles.members}>
          <div className={styles.member}>
            <Avatar initials="Y" color="purple" size="small" />
            <span>
              <strong>You</strong>
              <span className={styles.online}>online</span>
            </span>
            <small>owner</small>
          </div>
          {conversation.id === 'dev' && (
            <>
              <div className={styles.member}>
                <Avatar initials="A" color="green" size="small" />
                <span>
                  <strong>Alex</strong>
                  <span>last seen recently</span>
                </span>
              </div>
              <div className={styles.member}>
                <Avatar initials="M" color="pink" size="small" />
                <span>
                  <strong>Mia</strong>
                  <span>last seen recently</span>
                </span>
              </div>
            </>
          )}
        </Tabs.Content>
        <Tabs.Content value="media">
          <div className={styles.gallery}>
            {mediaMessages.map((message) => (
              <button key={message.id} onClick={() => onOpenMedia(message)}>
                <img src={message.attachment!.url} alt={message.attachment!.name} />
              </button>
            ))}
          </div>
          {mediaMessages.length === 0 && <p className={styles.empty}>No shared photos yet</p>}
        </Tabs.Content>
      </Tabs.Root>
    </aside>
  );
}
