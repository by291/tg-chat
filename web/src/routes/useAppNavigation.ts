import { useNavigationType } from 'react-router';
import { SETTINGS_SEARCH_ITEMS, type SettingsSearchItem } from '@/features/settings/settingsSearch';
import { useSearchDestination } from './useSearchDestination';

type SettingsPage = 'power' | 'wallpaper';

/** Keep shareable destinations in the URL while mounted panels retain their local UI state. */
export function useAppNavigation() {
  const { searchParams, changeDestination } = useSearchDestination();
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
        color: undefined,
      },
      isReturning: isSettingsOpen && !destination,
    });
  }

  function closeSettings() {
    changeDestination({
      changes: {
        settings: undefined,
        settingsPage: undefined,
        color: undefined,
      },
      isReturning: true,
    });
  }

  function openSettingsPage(page: SettingsPage | undefined) {
    changeDestination({
      changes: { settingsPage: page, color: undefined },
      isReturning: page === undefined,
    });
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
    isWallpaperColorOpen: settingsPage === 'wallpaper' && searchParams.has('color'),
    setWallpaperColorOpen: ({ isOpen }: { isOpen: boolean }) =>
      changeDestination({ changes: { color: isOpen ? '1' : undefined }, isReturning: !isOpen }),
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
