import { useEffect, useEffectEvent, useRef } from 'react';
import { isDismissKey } from '@/lib/keyboardEvent';
import { isHandheldLayout } from '@/layouts/chat/useHandheldLayout';
import { useSearchDestination } from '@/routes/useSearchDestination';
import type { CommunityKind } from '../communities/communityModels';
import type { SettingsPage } from './accountSettingsCatalog';

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
export function useAccountNavigation({
  isMessagingAvailable,
  isCovered,
}: {
  isMessagingAvailable: boolean;
  isCovered: boolean;
}) {
  const { searchParams, changeDestination, entryState } = useSearchDestination();
  const intentVersion = useRef(0);
  const rootPage = isMessagingAvailable ? 'messages' : 'settings';
  const page = parseAccountPage(searchParams.get('account'), rootPage);
  const view = searchParams.get('community');
  const isKnownView = view === 'group' || view === 'channel';
  const communityView: CommunityView = isKnownView ? view : 'discover';
  const isChatOpen = searchParams.has('conversation');

  const isSearchingSettings = searchParams.has('accountSearch');
  const canonicalizeGeneral = useEffectEvent(() => {
    changeDestination({ changes: { settings: 'general' }, isReturning: true });
  });
  const needsGeneralDestination = page === 'general' && !searchParams.has('settings');
  useEffect(() => {
    if (needsGeneralDestination) {
      canonicalizeGeneral();
    }
  }, [needsGeneralDestination]);

  function captureIntent() {
    const version = ++intentVersion.current;
    return () => intentVersion.current === version;
  }

  function navigate(destination: Parameters<typeof changeDestination>[0]) {
    intentVersion.current += 1;
    changeDestination(destination);
  }

  function openNotificationInbox() {
    openMessages('directory');
    return captureIntent();
  }

  function setSettingsSearch({ shouldOpen }: { shouldOpen: boolean }) {
    navigate({
      changes: { accountSearch: shouldOpen ? 'open' : undefined },
      isReturning: !shouldOpen,
    });
  }

  function openPage(
    next: AccountPage,
    options?: {
      isReturning?: boolean;
      view?: CommunityView;
      settingsPage?: 'wallpaper' | 'power';
      settingsItem?: string;
    },
  ) {
    const account = next === rootPage ? undefined : next;
    const community = options?.view === 'discover' ? undefined : options?.view;
    navigate({
      changes: {
        account,
        community,
        settings: options?.settingsItem ?? (next === 'general' ? 'general' : undefined),
        settingsPage: options?.settingsPage,
        color: undefined,
        detail: undefined,
      },
      isReturning: options?.isReturning,
    });
  }

  function openMessages(view: 'conversation' | 'directory') {
    navigate({
      changes: {
        account: undefined,
        accountSearch: undefined,
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
    if (!isChatOpen) {
      return;
    }
    navigate({ changes: { conversation: undefined }, isReturning: true });
  }

  function openDetail(value?: string) {
    // Session identifiers are kept in the browser entry rather than included in shareable URLs.
    navigate({
      changes: { detail: value ? 'open' : undefined },
      entryState: value ? { accountDetail: value } : undefined,
      isReturning: !value,
    });
  }

  function goBack() {
    if (page === 'settings' && isSearchingSettings) {
      setSettingsSearch({ shouldOpen: false });
      return;
    }
    if (searchParams.has('detail')) {
      openDetail();
      return;
    }
    if (searchParams.has('color')) {
      navigate({ changes: { color: undefined }, isReturning: true });
      return;
    }
    if (searchParams.has('settingsPage')) {
      navigate({ changes: { settingsPage: undefined }, isReturning: true });
      return;
    }
    openPage(PARENT_PAGE[page] ?? rootPage, { isReturning: true });
  }

  const onEscape = useEffectEvent((event: KeyboardEvent) => {
    if (isCovered || !isDismissKey(event)) {
      return;
    }
    // Portaled dialogs and menus own their dismissal before the surrounding page can close.
    if (document.querySelector('[role="dialog"]:not([hidden]), [role="menu"][data-state="open"]')) {
      return;
    }
    if (page !== rootPage || isSearchingSettings || searchParams.has('settingsPage')) {
      event.preventDefault();
      goBack();
      return;
    }
    if (isChatOpen && isHandheldLayout()) {
      event.preventDefault();
      if (entryState?.chatPanels) {
        window.history.back();
        return;
      }
      closeConversation();
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onEscape(event);
    const interruptLookup = () => {
      // Back or Forward can supersede a pending lookup even when returning to the same inbox.
      intentVersion.current += 1;
    };
    window.addEventListener('keydown', listener);
    window.addEventListener('popstate', interruptLookup);
    return () => {
      intentVersion.current += 1;
      window.removeEventListener('keydown', listener);
      window.removeEventListener('popstate', interruptLookup);
    };
  }, []);

  return {
    page,
    communityView,
    isSearchingSettings,
    settingsItem: searchParams.get('settings'),
    setSettingsSearch,
    captureIntent,
    detail: {
      value: searchParams.has('detail') ? entryState?.accountDetail : undefined,
      open: openDetail,
    },
    isChatOpen,
    openPage,
    openConversation: () => openMessages('conversation'),
    openNotificationInbox,
    closeConversation,
    goBack,
  };
}
