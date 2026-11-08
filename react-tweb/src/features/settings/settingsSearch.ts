import { Bell, Keyboard, MonitorSmartphone, Settings, Sticker } from 'lucide-react';

export const SETTINGS_CATEGORIES = [
  {
    id: 'notifications',
    label: 'Notifications and Sounds',
    keywords: 'alerts desktop push offline volume sound preview mute exceptions',
    icon: Bell,
    color: 'red',
  },
  {
    id: 'general',
    label: 'General Settings',
    keywords:
      'appearance theme light dark mode wallpaper background color text size time format autoplay video power animation',
    icon: Settings,
    color: 'gray',
  },
  {
    id: 'stickers',
    label: 'Stickers and Emoji',
    keywords: 'animation loop packs emoticons large emoji dynamic order sort',
    icon: Sticker,
    color: 'pink',
  },
  {
    id: 'devices',
    label: 'Devices',
    keywords: 'sessions browser login device rename terminate logout inactive',
    icon: MonitorSmartphone,
    color: 'blue',
  },
  {
    id: 'shortcuts',
    label: 'Keyboard Shortcuts',
    keywords: 'keyboard send message enter newline escape',
    icon: Keyboard,
    color: 'orange',
  },
] as const;

export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number]['id'];

export const RECENT_SETTINGS_KEY = 'react-tweb.settings-search.v1';
const MAX_RECENT_SETTINGS = 12;

export interface SettingsSearchItem {
  id: string;
  title: string;
  category: SettingsCategory;
  path: string;
  keywords: string;
  anchor?: string;
  page?: 'power' | 'wallpaper';
  scope?: string;
}

interface SearchGroup {
  category: SettingsCategory;
  labels: string[];
  page?: SettingsSearchItem['page'];
  path?: string;
}

const SEARCH_GROUPS: SearchGroup[] = [
  {
    category: 'notifications',
    labels: [
      'Show notifications',
      'Show offline notifications',
      'Sound',
      'Notification Sound',
      'Sound Volume',
      'Sound Effects',
      'Message Sent',
      'Private Chats',
      'Groups',
      'Channels',
      'Reset All Notifications',
    ],
  },
  {
    category: 'notifications',
    path: 'Private Chats',
    // prettier-ignore
    labels: [
      'Notifications for private chats',
      'Message Preview',
      'Exceptions',
    ],
  },
  {
    category: 'notifications',
    path: 'Groups',
    // prettier-ignore
    labels: [
      'Notifications for groups',
      'Message Preview',
      'Exceptions',
    ],
  },
  {
    category: 'notifications',
    path: 'Channels',
    // prettier-ignore
    labels: [
      'Notifications for channels',
      'Message Preview',
      'Exceptions',
    ],
  },
  {
    category: 'general',
    // prettier-ignore
    labels: [
      'Message Text Size',
      'Color theme',
      'Time Format',
    ],
  },
  {
    category: 'general',
    page: 'wallpaper',
    path: 'Chat Wallpaper',
    // prettier-ignore
    labels: [
      'Chat Wallpaper',
      'Upload Wallpaper',
      'Set a color',
      'Reset to Defaults',
    ],
  },
  {
    category: 'general',
    page: 'power',
    path: 'Power Saving',
    labels: [
      'Power Saving',
      'Autoplay Videos',
      'Animated Stickers and Emoji',
      'Autoplay in Chat',
      'Autoplay in Panel',
    ],
  },
  {
    category: 'stickers',
    // prettier-ignore
    labels: [
      'Loop Animated Stickers',
      'Large Emoji',
      'Dynamic Pack Order',
      'Stickers',
      'Emoji',
    ],
  },
  {
    category: 'devices',
    // prettier-ignore
    labels: [
      'This device',
      'Active sessions',
      'Automatically Terminate Old Sessions',
    ],
  },
  {
    category: 'shortcuts',
    labels: [
      'Text Formatting',
      'Send message',
      'Messages',
      'Chat',
      'Navigation',
      'Media Viewer',
      'Stories',
      'Media Editor',
      'Other',
    ],
  },
];

const SEARCH_ALIASES: Record<string, string> = {
  'Color theme': 'appearance dark light night colors accent skin',
  'Chat Wallpaper': 'background image photo',
  'Sound Volume': 'audio loud quiet',
  'Message Sent': 'sound effects audio',
  'Show notifications': 'desktop alerts',
  'Power Saving': 'battery energy performance',
  'Message Text Size': 'font lettering',
  'Send message': 'enter command control keyboard',
  'This device': 'rename browser computer',
};

function buildSearchItems(): SettingsSearchItem[] {
  const items: SettingsSearchItem[] = SETTINGS_CATEGORIES.map((category) => ({
    id: category.id,
    category: category.id,
    title: category.label,
    keywords: category.keywords,
    path: '',
  }));
  for (const group of SEARCH_GROUPS) {
    const category = SETTINGS_CATEGORIES.find((entry) => entry.id === group.category)!;
    for (const label of group.labels) {
      const categoryTitle = category.id === 'notifications' ? 'Notifications' : category.label;
      const path = [categoryTitle, group.path].filter(Boolean).join(' › ');
      items.push({
        id: `${group.category}:${group.path ?? 'main'}:${label}`,
        title: label,
        category: group.category,
        page: group.page,
        scope: group.category === 'notifications' ? group.path : undefined,
        anchor: label,
        path,
        keywords: SEARCH_ALIASES[label] ?? '',
      });
    }
  }
  return items;
}

export const SETTINGS_SEARCH_ITEMS = buildSearchItems();

function matchScore(item: SettingsSearchItem, query: string) {
  const title = item.title.toLowerCase();
  if (title.startsWith(query)) {
    return 0;
  }
  return title.includes(query) ? 1 : 2;
}

/** Match individual settings and synonyms, keeping each category's results together. */
export function searchSettings(query: string): SettingsSearchItem[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return [];
  }
  const words = normalized.split(/\s+/);
  const matches = SETTINGS_SEARCH_ITEMS.filter((item) => {
    const searchable = `${item.title} ${item.path} ${item.keywords}`.toLowerCase();
    return words.every((word) => searchable.includes(word));
  });
  matches.sort((first, second) => matchScore(first, normalized) - matchScore(second, normalized));
  const groups = new Map<SettingsCategory, SettingsSearchItem[]>();
  for (const item of matches) {
    const group = groups.get(item.category) ?? [];
    group.push(item);
    groups.set(item.category, group);
  }
  return Array.from(groups.values()).flat();
}

/** Recover known recent result identifiers without trusting malformed local storage. */
export function readRecentSettings(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(RECENT_SETTINGS_KEY) ?? '[]');
    if (!Array.isArray(saved)) {
      return [];
    }
    const knownIds = new Set(SETTINGS_SEARCH_ITEMS.map((item) => item.id));
    const validIds = saved.filter((id): id is string => typeof id === 'string' && knownIds.has(id));
    return Array.from(new Set(validIds)).slice(0, MAX_RECENT_SETTINGS);
  } catch {
    return [];
  }
}

/** Persist recent picks; blocked storage must not prevent opening a setting. */
export function rememberSetting(id: string) {
  const recent = readRecentSettings().filter((entry) => entry !== id);
  const updated = [id, ...recent].slice(0, MAX_RECENT_SETTINGS);
  try {
    localStorage.setItem(RECENT_SETTINGS_KEY, JSON.stringify(updated));
  } catch {
    // Search navigation remains usable even when this browser cannot persist recents.
  }
}
