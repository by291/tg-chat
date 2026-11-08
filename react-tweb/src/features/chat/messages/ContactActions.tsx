import { createContext, useContext, type Dispatch, type ReactNode } from 'react';
import { CURRENT_USER_ID, type ChatAction, type ChatState, type Conversation } from '../model';
import type { ContactMedia } from '../messageMedia';
import { getConversations } from '../state/conversations';

// prettier-ignore
const AVATAR_COLORS = [
  'blue',
  'pink',
  'green',
  'purple',
  'orange',
  'indigo',
];

interface SaveContactOptions {
  media: ContactMedia;
  firstName: string;
  lastName: string;
  phone: string;
}

interface ContactActions {
  getConversation: (userId: string) => Conversation | undefined;
  openConversation: (media: ContactMedia) => void;
  saveContact: (options: SaveContactOptions) => void;
}

interface ContactActionsProviderProps {
  state: ChatState;
  dispatch: Dispatch<ChatAction>;
  onSelectConversation: (chatId: string) => void;
  children: ReactNode;
}

const ContactActionsContext = createContext<ContactActions | undefined>(undefined);

/** Choose a stable avatar palette entry for a peer or a name-only contact. */
export function getContactColor(identity: string) {
  let colorIndex = 0;
  for (const character of identity) {
    colorIndex = (colorIndex + character.codePointAt(0)!) % AVATAR_COLORS.length;
  }
  return AVATAR_COLORS[colorIndex];
}

function createContactConversation(media: ContactMedia): Conversation {
  return {
    id: `contact:${media.userId!}`,
    title: media.name.trim() || media.phone || 'Contact',
    subtitle: media.phone || 'Contact',
    initials: media.initials,
    color: getContactColor(media.userId!),
    kind: 'private',
    preview: '',
    time: '',
    phone: media.phone,
    isContact: false,
  };
}

/** Connect shared contact controls to the application's persisted local conversations. */
export function ContactActionsProvider({
  state,
  dispatch,
  onSelectConversation,
  children,
}: ContactActionsProviderProps) {
  const conversations = getConversations(state);

  function getConversation(userId: string) {
    if (userId === CURRENT_USER_ID) {
      return conversations.find((conversation) => conversation.kind === 'saved');
    }
    return conversations.find((conversation) => {
      const isMatchingPeer = conversation.id === userId || conversation.id === `contact:${userId}`;
      return conversation.kind === 'private' && isMatchingPeer;
    });
  }

  function openConversation(media: ContactMedia) {
    if (!media.userId) {
      return;
    }
    let conversation = getConversation(media.userId);
    if (!conversation) {
      // Create before selecting so the next render can resolve the selected conversation.
      conversation = createContactConversation(media);
      dispatch({ type: 'save-conversation', conversation });
    }
    onSelectConversation(conversation.id);
  }

  function saveContact({ media, firstName, lastName, phone }: SaveContactOptions) {
    if (!media.userId || media.userId === CURRENT_USER_ID) {
      return;
    }
    const conversation = getConversation(media.userId) ?? createContactConversation(media);
    const title = `${firstName.trim()} ${lastName.trim()}`.trim();
    const initials = `${firstName.trim().slice(0, 1)}${lastName.trim().slice(0, 1)}`.toUpperCase();
    const normalizedPhone = phone.trim();
    const hasPhoneSubtitle = conversation.subtitle === (conversation.phone || 'Contact');
    const subtitle = hasPhoneSubtitle ? normalizedPhone : conversation.subtitle;
    dispatch({
      type: 'save-conversation',
      conversation: {
        ...conversation,
        title,
        initials,
        phone: normalizedPhone,
        subtitle,
        isContact: true,
      },
    });
  }

  return (
    <ContactActionsContext.Provider
      value={{
        getConversation,
        openConversation,
        saveContact,
      }}
    >
      {children}
    </ContactActionsContext.Provider>
  );
}

/** Read the shared contact actions when rendered inside the chat application. */
export function useContactActions() {
  return useContext(ContactActionsContext);
}
