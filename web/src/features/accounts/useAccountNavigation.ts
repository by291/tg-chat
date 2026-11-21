import { useEffect, useEffectEvent } from 'react';
import { useSearchDestination } from '@/routes/useSearchDestination';
import type { CommunityKind } from '../communities/communityModels';
import type { SettingsPage } from './AccountSettingsHome';

export type CommunityView = 'discover' | 'invitations' | CommunityKind;
export type AccountPage =
  | SettingsPage
  | 'messages'
  | 'settings'
  | 'contacts'
  | 'contact-search'
  | 'blocks'
  | 'security'
  | 'communities'
  | 'invitations';

const PARENT_PAGE: Partial<Record<AccountPage, AccountPage>> = {
  invitations: 'communities',
  profile: 'settings',
  general: 'settings',
  shortcuts: 'settings',
  preferences: 'settings',
  operator: 'settings',
  privacy: 'settings',
  devices: 'settings',
  blocks: 'privacy',
  security: 'privacy',
  'contact-search': 'contacts',
};

/** List the visible sidebar page and its mounted ancestors in reading order. */
export function accountPagePath(page: AccountPage): AccountPage[] {
  const parent = PARENT_PAGE[page];
  return parent ? [...accountPagePath(parent), page] : [page];
}

function parseAccountPage(value: string | null, fallback: AccountPage): AccountPage {
  if (value === 'settings' || value === 'contacts' || value === 'communities') {
    return value;
  }
  return value && Object.hasOwn(PARENT_PAGE, value) ? (value as AccountPage) : fallback;
}

/** Own account and handheld panel history without applying settings changes to ChatOwner. */
export function useAccountNavigation({ isMessagingAvailable }: { isMessagingAvailable: boolean }) {
  const { searchParams, changeDestination, entryState } = useSearchDestination();
  const rootPage = isMessagingAvailable ? 'messages' : 'settings';
  const page = parseAccountPage(searchParams.get('account'), rootPage);
  const view = searchParams.get('community');
  const isKnownView = view === 'group' || view === 'channel';
  const communityView: CommunityView = isKnownView ? view : 'discover';
  const isChatOpen = searchParams.has('conversation');

  function openPage(next: AccountPage, options?: { isReturning?: boolean; view?: CommunityView }) {
    const account = next === rootPage ? undefined : next;
    const community = options?.view === 'discover' ? undefined : options?.view;
    changeDestination({
      changes: {
        account,
        community,
        settings: next === 'general' ? 'general' : undefined,
        settingsPage: undefined,
        color: undefined,
        detail: undefined,
      },
      isReturning: options?.isReturning,
    });
  }

  function openMessages(view: 'conversation' | 'directory') {
    changeDestination({
      changes: {
        account: undefined,
        community: undefined,
        settings: undefined,
        settingsPage: undefined,
        color: undefined,
        detail: undefined,
        conversation: view === 'conversation' ? 'open' : undefined,
      },
    });
  }

  function closeConversation() {
    changeDestination({ changes: { conversation: undefined }, isReturning: true });
  }

  function openDetail(value?: string) {
    // Session identifiers are kept in the browser entry rather than included in shareable URLs.
    changeDestination({
      changes: { detail: value ? 'open' : undefined },
      entryState: value ? { accountDetail: value } : undefined,
      isReturning: !value,
    });
  }

  function goBack() {
    if (searchParams.has('detail')) {
      openDetail();
      return;
    }
    if (searchParams.has('color')) {
      changeDestination({ changes: { color: undefined }, isReturning: true });
      return;
    }
    if (searchParams.has('settingsPage')) {
      changeDestination({ changes: { settingsPage: undefined }, isReturning: true });
      return;
    }
    openPage(PARENT_PAGE[page] ?? rootPage, { isReturning: true });
  }

  const onEscape = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) {
      return;
    }
    // Portaled dialogs and menus own their dismissal before the surrounding page can close.
    if (document.querySelector('[role="dialog"]:not([hidden]), [role="menu"][data-state="open"]')) {
      return;
    }
    if (page !== rootPage || searchParams.has('settingsPage')) {
      event.preventDefault();
      goBack();
      return;
    }
    if (isChatOpen && window.matchMedia?.('(max-width: 760px)').matches) {
      event.preventDefault();
      closeConversation();
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onEscape(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  return {
    page,
    communityView,
    detail: {
      value: searchParams.has('detail') ? entryState?.accountDetail : undefined,
      open: openDetail,
    },
    isChatOpen,
    openPage,
    openConversation: () => openMessages('conversation'),
    openInbox: () => openMessages('directory'),
    closeConversation,
    goBack,
  };
}
