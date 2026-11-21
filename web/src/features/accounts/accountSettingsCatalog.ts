import {
  type LucideIcon,
  Gavel,
  Keyboard,
  Settings,
  Shield,
  SlidersHorizontal,
  Smartphone,
  UserRound,
} from 'lucide-react';
import type { components } from '@/api/schema';
import {
  SETTINGS_SEARCH_ITEMS,
  searchSettings,
  type SettingsSearchItem,
} from '@/features/settings/settingsSearch';

const SETTINGS_ENTRIES = [
  {
    page: 'profile',
    label: 'Edit Profile',
    icon: UserRound,
    color: 'blue',
  },
  {
    page: 'general',
    label: 'General Settings',
    icon: Settings,
    color: 'gray',
  },
  {
    page: 'shortcuts',
    label: 'Keyboard Shortcuts',
    icon: Keyboard,
    color: 'orange',
  },
  {
    page: 'privacy',
    label: 'Privacy and Security',
    icon: Shield,
    color: 'green',
  },
  {
    page: 'devices',
    label: 'Devices',
    icon: Smartphone,
    color: 'purple',
  },
  {
    page: 'preferences',
    label: 'Preferences',
    icon: SlidersHorizontal,
    color: 'blue',
  },
  {
    page: 'operator',
    label: 'Administration',
    icon: Gavel,
    color: 'blue',
  },
] as const;

export type SettingsPage = (typeof SETTINGS_ENTRIES)[number]['page'];

interface AccountSearchItem {
  id: string;
  title: string;
  page: SettingsPage;
  category: SettingsPage;
  path: string;
  icon: LucideIcon;
  color: string;
  subpage?: SettingsSearchItem['page'];
  anchorId?: string;
}

/** Index only connected destinations available to the authenticated account. */
export function accountSettingsCatalog(profile: components['schemas']['PrivateProfile']) {
  const entries = SETTINGS_ENTRIES.filter(
    (entry) => entry.page !== 'operator' || profile.is_operator,
  );
  const catalog: AccountSearchItem[] = entries.map((entry) => ({
    ...entry,
    id: entry.page,
    category: entry.page,
    title: entry.label,
    path: '',
  }));
  for (const item of SETTINGS_SEARCH_ITEMS) {
    const hasSharedPage = item.category === 'general' || item.category === 'shortcuts';
    if (!item.anchor || !hasSharedPage) {
      continue;
    }
    const category = entries.find((entry) => entry.page === item.category)!;
    catalog.push({
      ...category,
      id: item.id,
      category: category.page,
      title: item.title,
      path: item.path,
      subpage: item.page,
      anchorId: item.id,
    });
  }

  function search(query: string) {
    const matches = new Set(searchSettings(query).map((item) => item.id));
    const text = query.trim().toLowerCase();
    return catalog.filter(
      (item) => matches.has(item.id) || item.title.toLowerCase().includes(text),
    );
  }
  // prettier-ignore
  return {
    entries,
    catalog,
    search,
  };
}
