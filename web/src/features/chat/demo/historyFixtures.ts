import type { Attachment } from '@/domain/messages/media';
import type { Message } from '@/domain/messages/message';

const HISTORY_MESSAGE_COUNT = 1000;
const MINUTE = 60 * 1000;
const HISTORY_START = new Date('2026-11-02T09:00:00').getTime();
const SHOWCASE_START = new Date('2026-11-05T16:00:00').getTime();
const PHOTO_INTERVAL = 13;
const LONG_TEXT_INTERVAL = 7;
const SENDER_GROUP_LENGTH = 3;
const SENDER_COUNT = 3;
const WAVEFORM_BAR_COUNT = 48;
const WAVEFORM_FREQUENCY = 0.71;
const WAVEFORM_BASE_AMPLITUDE = 0.2;
const WAVEFORM_AMPLITUDE_RANGE = 0.8;

const landscape: Attachment = {
  name: 'Quiet hills.svg',
  url: '/assets/quiet-hills.svg',
  width: 960,
  height: 600,
};

const portrait: Attachment = {
  name: 'Evening window.svg',
  url: '/assets/evening-window.svg',
  width: 480,
  height: 800,
};

const authors = [
  { id: 'alex', name: 'Alex' },
  { id: 'mia', name: 'Mia' },
  { id: 'you', name: 'You' },
];

function createArchiveMessage(index: number): Message {
  const authorIndex = Math.floor(index / SENDER_GROUP_LENGTH) % SENDER_COUNT;
  const author = authors[authorIndex];
  const isPhoto = index % PHOTO_INTERVAL === 0;
  const isLongText = index % LONG_TEXT_INTERVAL === 0;
  let text = `Archive note ${index + 1}: a small detail worth keeping.`;
  if (isLongText) {
    text += '\nThe view should stay on this message while older history arrives. ';
    text += 'Messages have different heights, and a narrow window changes their wrapping. ';
    text += 'Keep reading here while photos load above the viewport.';
  }

  return {
    id: `lab-history-${index + 1}`,
    chatId: 'lab',
    authorId: author.id,
    authorName: author.name,
    createdAt: HISTORY_START + index * MINUTE,
    text,
    attachment: isPhoto ? landscape : undefined,
    reactions: [],
  };
}

function createShowcase(): Message[] {
  const contents: Partial<Message>[] = [
    { text: 'Alex pinned the message showcase', isService: true },
    {
      text: 'A message has a shared shell, but its contents do not all use the same layout.',
      isPinned: true,
    },
    { text: 'Short text keeps its time on the last line.' },
    {
      text: 'A longer thought\nwith deliberate line breaks, a reply, and a reaction.',
      replyToId: 'lab-history-12',
      reactions: ['👍', '❤️'],
    },
    { text: '', attachment: portrait },
    { text: 'A narrow photo needs room for a readable caption.', attachment: portrait },
    {
      text: 'A small album, one caption, one timestamp.',
      media: { kind: 'album', photos: [landscape, portrait, landscape] },
    },
    {
      text: 'An ordinary video has a reserved frame and native playback controls.',
      media: {
        kind: 'video',
        url: '/assets/flower.mp4',
        poster: '/assets/quiet-hills.svg',
        width: 960,
        height: 540,
        duration: 5,
      },
    },
    {
      text: '',
      media: {
        kind: 'video',
        url: '/assets/flower.mp4',
        poster: '/assets/quiet-hills.svg',
        width: 540,
        height: 540,
        duration: 5,
        isRound: true,
      },
    },
    {
      text: '',
      media: {
        kind: 'voice',
        url: '/assets/sample-tone.wav',
        duration: 4,
        waveform: Array.from({ length: WAVEFORM_BAR_COUNT }, (_, index) => {
          return (
            WAVEFORM_BASE_AMPLITUDE +
            Math.abs(Math.sin(index * WAVEFORM_FREQUENCY)) * WAVEFORM_AMPLITUDE_RANGE
          );
        }),
      },
    },
    {
      text: 'The file card downloads an actual local document.',
      media: {
        kind: 'document',
        name: 'conversation-notes.txt',
        url: '/assets/conversation-notes.txt',
        size: 176,
        mimeType: 'text/plain',
      },
    },
    {
      text: 'The reference for our next release',
      forwardedFrom: 'Frontend notes',
      media: {
        kind: 'link',
        url: 'https://github.com/morethanwords/tweb',
        site: 'GitHub',
        title: 'Telegram Web K',
        description: 'Message shells, media wrappers, grouping, and scroll ownership.',
        image: landscape,
      },
    },
    {
      text: '',
      media: {
        kind: 'poll',
        question: 'Which detail should we explore next?',
        options: [
          { id: 'scroll', text: 'Scroll anchoring', votes: 8 },
          { id: 'media', text: 'Media layouts', votes: 5 },
          { id: 'motion', text: 'Message animation', votes: 3 },
        ],
      },
    },
    {
      text: '',
      media: {
        kind: 'contact',
        name: 'Alex Example',
        phone: '+1 202 555 0142',
        initials: 'AE',
      },
    },
    {
      text: 'The message stays put even when the rows above it change height.',
      textStyle: 'quote',
    },
    {
      text: 'const message = {\n  id: "stable-message-id",\n  text: "Hello, React"\n};',
      textStyle: 'code',
    },
    { text: '', sticker: 'shark_animated-AgADqhQAAowt_Qc' },
    {
      text: 'Scroll up to explore 1,000 earlier messages. This reply goes to archive note 12.',
      replyToId: 'lab-history-12',
    },
  ];

  return contents.map((content, index) => ({
    id: `lab-showcase-${index + 1}`,
    chatId: 'lab',
    authorId: index % SENDER_COUNT === 0 ? 'you' : 'mia',
    authorName: index % SENDER_COUNT === 0 ? 'You' : 'Mia',
    text: '',
    createdAt: SHOWCASE_START + index * MINUTE,
    reactions: [],
    ...content,
  }));
}

/** Build a deterministic history that exercises pagination and every supported bubble shape. */
export function createHistoryMessages(): Message[] {
  const archive = Array.from({ length: HISTORY_MESSAGE_COUNT }, (_, index) => {
    return createArchiveMessage(index);
  });
  return [...archive, ...createShowcase()];
}
