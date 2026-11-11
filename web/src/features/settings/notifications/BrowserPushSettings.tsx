import { useSyncExternalStore } from 'react';
import type { BrowserPushOwner } from './BrowserPushOwner';

const captions = {
  loading: 'Checking browser availability…',
  unsupported: 'This browser does not support Web Push.',
  unavailable: 'Web Push is unavailable on this deployment.',
  denied: 'Allow notifications for this site in your browser settings.',
  disabled: 'Receive new-message alerts when this browser is in the background.',
  enabled: 'This browser can receive alerts when it is in the background.',
};

/** Show the browser-specific Web Push control next to connected account alert preferences. */
export function BrowserPushSettings({ owner }: { owner: BrowserPushOwner }) {
  const { status, isBusy, error } = useSyncExternalStore(owner.subscribe, owner.getSnapshot);
  return (
    <section aria-label="Browser notifications">
      <h2>Browser notifications</h2>
      <p role={status === 'loading' ? 'status' : undefined}>{captions[status]}</p>
      {status === 'disabled' && (
        <button type="button" disabled={isBusy} onClick={() => void owner.enable()}>
          {isBusy ? 'Enabling…' : 'Enable browser notifications'}
        </button>
      )}
      {status === 'enabled' && (
        <button type="button" disabled={isBusy} onClick={() => void owner.disable()}>
          {isBusy ? 'Disabling…' : 'Disable browser notifications'}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
