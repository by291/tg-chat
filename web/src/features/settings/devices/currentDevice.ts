export const DEVICE_NAME_KEY = 'react-tweb.device-name.v1';
export const MAX_DEVICE_NAME_LENGTH = 32;

interface BrowserEnvironment {
  userAgent: string;
  maxTouchPoints: number;
}

export interface CurrentDevice {
  browser: string;
  system: string;
}

// Chromium-based browsers include Chrome in their agent string, so test their brands first.
const BROWSER_PATTERNS = [
  { pattern: /(?:Edg|EdgA|EdgiOS)\/([\d.]+)/, name: 'Microsoft Edge' },
  { pattern: /(?:OPR|Opera)\/([\d.]+)/, name: 'Opera' },
  { pattern: /(?:Firefox|FxiOS)\/([\d.]+)/, name: 'Firefox' },
  { pattern: /(?:Chrome|CriOS)\/([\d.]+)/, name: 'Chrome' },
  { pattern: /Version\/([\d.]+).*Safari/, name: 'Safari' },
];

function describeBrowser(userAgent: string) {
  for (const browser of BROWSER_PATTERNS) {
    const match = browser.pattern.exec(userAgent);
    if (match) {
      return `${browser.name} ${match[1].split('.')[0]}`;
    }
  }

  return 'Web browser';
}

function describeSystem({ userAgent, maxTouchPoints }: BrowserEnvironment) {
  const isDesktopIPad = /Macintosh/.test(userAgent) && maxTouchPoints > 1;
  if (/iPad/.test(userAgent) || isDesktopIPad) {
    return 'iPadOS';
  }
  if (/iPhone|iPod/.test(userAgent)) {
    return 'iOS';
  }
  if (/Android/.test(userAgent)) {
    return 'Android';
  }
  if (/Windows/.test(userAgent)) {
    return 'Windows';
  }
  if (/CrOS/.test(userAgent)) {
    return 'ChromeOS';
  }
  if (/Macintosh|Mac OS X/.test(userAgent)) {
    return 'macOS';
  }
  if (/Linux/.test(userAgent)) {
    return 'Linux';
  }

  return 'Unknown system';
}

/** Describe browser-reported information without inferring location or hardware identity. */
export function describeCurrentDevice(environment: BrowserEnvironment): CurrentDevice {
  return {
    browser: describeBrowser(environment.userAgent),
    system: describeSystem(environment),
  };
}

/** Read the local device label, falling back safely when storage is unavailable. */
export function readDeviceName() {
  try {
    return (localStorage.getItem(DEVICE_NAME_KEY) ?? '').trim().slice(0, MAX_DEVICE_NAME_LENGTH);
  } catch {
    return '';
  }
}

/** Save only the local device label; an empty label restores the browser-derived name. */
export function saveDeviceName(name: string) {
  const normalizedName = name.trim().slice(0, MAX_DEVICE_NAME_LENGTH);

  try {
    localStorage.setItem(DEVICE_NAME_KEY, normalizedName);
    return true;
  } catch {
    return false;
  }
}
