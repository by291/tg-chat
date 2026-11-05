import { createHistoryMessages } from './historyFixtures';
import { DEFAULT_CHAT_ID, type ChatState, type Conversation, type Message } from '../model';

export const conversations: Conversation[] = [
  {
    id: 'dev',
    title: 'dev',
    subtitle: '3 members',
    initials: 'D',
    color: 'blue',
    preview: 'You: This feels familiar ✨',
    time: '14:42',
  },
  {
    id: 'lab',
    title: 'Message lab',
    subtitle: '3 members · local history study',
    initials: 'ML',
    color: 'purple',
    preview: 'Photos, albums, voice, polls, and a long history',
    time: '16:17',
  },
  {
    id: 'design',
    title: 'Design conversations',
    subtitle: '5 members',
    initials: 'DC',
    color: 'pink',
    preview: 'Mia: The little details make it.',
    time: '14:26',
    unreadCount: 3,
  },
  {
    id: 'alex',
    title: 'Alex Morgan',
    subtitle: 'last seen recently',
    initials: 'AM',
    color: 'green',
    preview: 'Coffee after the release? ☕',
    time: '13:58',
    unreadCount: 1,
  },
  {
    id: 'saved',
    title: 'Saved Messages',
    subtitle: 'your personal cloud',
    initials: 'saved',
    color: 'purple',
    preview: 'A place for ideas worth keeping',
    time: '12:10',
  },
  {
    id: 'webk',
    title: 'WebK Channel',
    subtitle: '24,108 subscribers',
    initials: 'W',
    color: 'blue',
    preview: 'Small details. Better conversations.',
    time: 'Wed',
    isVerified: true,
    isMuted: true,
  },
  {
    id: 'weekend',
    title: 'Weekend people',
    subtitle: '8 members',
    initials: 'WP',
    color: 'orange',
    preview: 'Sam: Photo',
    time: 'Tue',
    unreadCount: 12,
    isMuted: true,
  },
  {
    id: 'frontend',
    title: 'Frontend notes',
    subtitle: '4 members',
    initials: 'FN',
    color: 'indigo',
    preview: 'One component, one clear responsibility.',
    time: 'Tue',
    isMuted: true,
  },
  {
    id: 'mia',
    title: 'Mia Chen',
    subtitle: 'last seen recently',
    initials: 'MC',
    color: 'pink',
    preview: 'Thanks, see you tomorrow!',
    time: 'Mon',
  },
];

const DEMO_DATE = new Date('2026-11-05T14:30:00').getTime();
const MINUTE = 60 * 1000;

const devMessages: Message[] = [
  {
    id: 'dev-1',
    chatId: 'dev',
    authorId: 'alex',
    authorName: 'Alex',
    text: 'A little space to build things together. 👋',
    createdAt: DEMO_DATE,
    reactions: [],
  },
  {
    id: 'dev-2',
    chatId: 'dev',
    authorId: 'alex',
    authorName: 'Alex',
    text: 'Same familiar chat. A fresh start in React.',
    createdAt: DEMO_DATE + MINUTE,
    reactions: [],
  },
  {
    id: 'dev-3',
    chatId: 'dev',
    authorId: 'you',
    authorName: 'You',
    text: 'The floating layout is so nice.',
    createdAt: DEMO_DATE + 2 * MINUTE,
    reactions: [],
  },
  {
    id: 'dev-4',
    chatId: 'dev',
    authorId: 'mia',
    authorName: 'Mia',
    text: 'A little inspiration for the colors 🌿',
    createdAt: DEMO_DATE + 4 * MINUTE,
    attachment: {
      name: 'Quiet hills.svg',
      url: '/assets/quiet-hills.svg',
      width: 960,
      height: 600,
    },
    reactions: ['💜'],
  },
  {
    id: 'dev-5',
    chatId: 'dev',
    authorId: 'you',
    authorName: 'You',
    text: 'Love these. Let’s keep the details simple.',
    createdAt: DEMO_DATE + 5 * MINUTE,
    replyToId: 'dev-4',
    reactions: [],
  },
  {
    id: 'dev-6',
    chatId: 'dev',
    authorId: 'mia',
    authorName: 'Mia',
    text: 'Try replying to a message, or send a photo.\nEverything here stays on your device.',
    createdAt: DEMO_DATE + 7 * MINUTE,
    reactions: ['👍'],
  },
  {
    id: 'dev-7',
    chatId: 'dev',
    authorId: 'you',
    authorName: 'You',
    text: '',
    sticker: '👋',
    createdAt: DEMO_DATE + 10 * MINUTE,
    reactions: [],
  },
  {
    id: 'dev-8',
    chatId: 'dev',
    authorId: 'you',
    authorName: 'You',
    text: 'This feels familiar ✨',
    createdAt: DEMO_DATE + 12 * MINUTE,
    reactions: [],
  },
];

function createOtherMessages(): Message[] {
  return conversations
    .filter((conversation) => conversation.id !== DEFAULT_CHAT_ID && conversation.id !== 'lab')
    .map((conversation) => ({
      id: `${conversation.id}-first`,
      chatId: conversation.id,
      authorId: conversation.id === 'saved' ? 'you' : conversation.id,
      authorName: conversation.title,
      text: conversation.preview,
      createdAt: DEMO_DATE,
      reactions: [],
    }));
}

/** Create independent initial state for a new local demonstration. */
export function createInitialState(): ChatState {
  return {
    version: 2,
    activeChatId: DEFAULT_CHAT_ID,
    messages: [...devMessages, ...createOtherMessages(), ...createHistoryMessages()],
    drafts: {},
    isDark: false,
  };
}
