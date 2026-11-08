import { useLocation, useNavigate, useNavigationType, useSearchParams } from 'react-router';
import { SETTINGS_SEARCH_ITEMS, type SettingsSearchItem } from '@/features/settings/settingsSearch';

type SettingsPage = 'power' | 'wallpaper';
type SearchChanges = Record<string, string | undefined>;

interface DestinationChange {
  changes: SearchChanges;
  isReturning?: boolean;
}

/** Keep shareable destinations in the URL while mounted panels retain their local UI state. */
export function useAppNavigation() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const chatId = searchParams.get('chat') ?? '';
  const isSettingsOpen = searchParams.has('settings');
  const settingsDestination = SETTINGS_SEARCH_ITEMS.find((item) => {
    return item.id === searchParams.get('settings');
  });
  const requestedPage = searchParams.get('settingsPage');
  const hasGeneralPage = settingsDestination?.category === 'general';
  const isKnownPage = requestedPage === 'power' || requestedPage === 'wallpaper';
  const settingsPage = hasGeneralPage && isKnownPage ? requestedPage : undefined;
  const isArchiveOpen = searchParams.get('sidebar') === 'archive';

  function changeDestination({ changes, isReturning = false }: DestinationChange) {
    const nextParams = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value) {
        nextParams.set(key, value);
      } else {
        nextParams.delete(key);
      }
    }
    const nextSearch = nextParams.toString();
    const currentSearch = searchParams.toString();
    if (nextSearch === currentSearch) {
      return;
    }
    // Only traverse entries created by this navigation owner; a deep link has no known parent.
    if (isReturning && location.state?.previousSearch === nextSearch) {
      navigate(-1);
      return;
    }
    setSearchParams(nextParams, {
      replace: isReturning,
      preventScrollReset: true,
      state: isReturning ? null : { previousSearch: currentSearch },
    });
  }

  function openChat(nextChatId: string) {
    changeDestination({ changes: { chat: nextChatId } });
  }

  function closeChat() {
    changeDestination({ changes: { chat: undefined }, isReturning: true });
  }

  function openSettings(destination?: SettingsSearchItem) {
    changeDestination({
      changes: {
        settings: destination?.id ?? 'overview',
        settingsPage: destination?.page,
      },
      isReturning: isSettingsOpen && !destination,
    });
  }

  function closeSettings() {
    changeDestination({
      changes: { settings: undefined, settingsPage: undefined },
      isReturning: true,
    });
  }

  function openSettingsPage(page: SettingsPage | undefined) {
    changeDestination({ changes: { settingsPage: page }, isReturning: page === undefined });
  }

  function openArchive() {
    changeDestination({ changes: { sidebar: 'archive' } });
  }

  function closeArchive() {
    changeDestination({ changes: { sidebar: undefined }, isReturning: true });
  }

  return {
    chatId,
    navigationType,
    isSettingsOpen,
    settingsDestination,
    settingsPage,
    isArchiveOpen,
    openChat,
    closeChat,
    openSettings,
    closeSettings,
    openSettingsPage,
    openArchive,
    closeArchive,
  };
}
