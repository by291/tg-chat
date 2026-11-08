import { Search } from 'lucide-react';
import { useRef, useState } from 'react';
import { IconButton } from '../../components/IconButton';
import { SidebarNavigation } from './SidebarNavigation';
import { GeneralSettingsPage } from './GeneralSettingsPage';
import { StickerSettingsPage } from './StickerSettingsPage';
import { SettingsHeader, SettingsRow } from './SettingsControls';
import { useClosingDialogValue } from './useClosingDialogValue';
import { DEMO_PROFILE } from '../demo/profile';
import { SettingsAccountDetails } from './SettingsAccountDetails';
import { SettingsProfile } from './SettingsProfile';
import { NotificationSettingsPage, type NotificationChatActions } from './NotificationSettingsPage';
import { DevicesSettingsPage } from './DevicesSettingsPage';
import { KeyboardSettingsPage } from './KeyboardSettingsPage';
import { SettingsOverflowMenu } from './SettingsOverflowMenu';
import { SettingsSearchPanel } from './SettingsSearchPanel';
import { SETTINGS_CATEGORIES, rememberSetting, type SettingsSearchItem } from './settingsSearch';
import { useSettingsSearchTarget } from './useSettingsSearchTarget';
import searchStyles from './SettingsSearchPanel.module.css';
import styles from './SettingsPage.module.css';

interface SettingsPageProps extends NotificationChatActions {
  onBack: () => void;
}

/** Browse supported preferences without replacing the conversation or losing sidebar state. */
export function SettingsPage({ onBack, ...notificationActions }: SettingsPageProps) {
  const [destination, setDestination] = useState<SettingsSearchItem>();
  const closingDestination = useClosingDialogValue(destination);
  const detailRef = useRef<HTMLDivElement>(null);
  useSettingsSearchTarget({ rootRef: detailRef, item: destination });
  const [isSearching, setIsSearching] = useState(false);
  const searchButtonRef = useRef<HTMLButtonElement>(null);

  function closeSearch() {
    setIsSearching(false);
    requestAnimationFrame(() => searchButtonRef.current?.focus({ preventScroll: true }));
  }

  function navigateBack() {
    if (destination) {
      setDestination(undefined);
      return;
    }
    if (isSearching) {
      closeSearch();
      return;
    }
    onBack();
  }

  function openSearchResult(item: SettingsSearchItem) {
    rememberSetting(item.id);
    setDestination(item);
  }

  const closeCategory = () => setDestination(undefined);
  let detailPage = (
    <GeneralSettingsPage
      key={closingDestination?.id}
      initialPage={closingDestination?.page}
      onBack={closeCategory}
    />
  );
  if (closingDestination?.category === 'notifications') {
    detailPage = <NotificationSettingsPage {...notificationActions} onBack={closeCategory} />;
  } else if (closingDestination?.category === 'stickers') {
    detailPage = <StickerSettingsPage onBack={closeCategory} />;
  } else if (closingDestination?.category === 'devices') {
    detailPage = <DevicesSettingsPage onBack={closeCategory} />;
  } else if (closingDestination?.category === 'shortcuts') {
    detailPage = <KeyboardSettingsPage onBack={closeCategory} />;
  }

  const overview = (
    <section
      className={`${styles.page} ${searchStyles.layers}`}
      aria-label="Settings"
      data-searching={isSearching}
    >
      <div className={searchStyles.mainLayer} inert={isSearching} aria-hidden={isSearching}>
        <SettingsProfile
          identity={DEMO_PROFILE}
          header={
            <SettingsHeader title="Settings" backLabel="Back from settings" onBack={navigateBack}>
              <div className={styles.headerActions}>
                <IconButton
                  ref={searchButtonRef}
                  label="Search settings"
                  onClick={() => setIsSearching(true)}
                >
                  <Search />
                </IconButton>
                <SettingsOverflowMenu />
              </div>
            </SettingsHeader>
          }
        >
          <SettingsAccountDetails profile={DEMO_PROFILE} />
          <div className={styles.section}>
            {SETTINGS_CATEGORIES.map((entry) => (
              <SettingsRow
                key={entry.id}
                label={entry.label}
                icon={entry.icon}
                color={entry.color}
                onClick={() =>
                  setDestination({
                    id: entry.id,
                    category: entry.id,
                    title: entry.label,
                    path: '',
                    keywords: entry.keywords,
                  })
                }
              />
            ))}
          </div>
        </SettingsProfile>
      </div>
      <SettingsSearchPanel
        isOpen={isSearching}
        isCovered={Boolean(destination)}
        onClose={closeSearch}
        onSelect={openSearchResult}
      />
    </section>
  );

  return (
    <div
      className={styles.page}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          navigateBack();
        }
      }}
    >
      <SidebarNavigation
        isSecondaryOpen={Boolean(destination)}
        primary={overview}
        secondary={
          <div ref={detailRef} className={styles.page}>
            {detailPage}
          </div>
        }
      />
    </div>
  );
}
