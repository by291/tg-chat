import { createContext, useContext, type ReactNode } from 'react';
import { STICKER_PACKS } from '@/features/stickers/stickerCatalog';

const DEFAULT_PACK_IDS = STICKER_PACKS.map((pack) => pack.id);
const ConnectedPackIds = createContext<readonly string[] | null>(null);

interface StickerPackScopeProps {
  packIds?: readonly string[];
  children: ReactNode;
}

/** Supply account-owned sticker selections to the connected composer. */
export function ConnectedStickerPackScope({ packIds, children }: StickerPackScopeProps) {
  return <ConnectedPackIds value={packIds ?? DEFAULT_PACK_IDS}>{children}</ConnectedPackIds>;
}

/** Return the connected selection, or null outside an authenticated sticker scope. */
export function useConnectedStickerPackIds() {
  return useContext(ConnectedPackIds);
}
