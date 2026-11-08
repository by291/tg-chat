import { createContext, useContext } from 'react';
import { CURRENT_USER_ID } from '@/domain/identity';

const CurrentUserContext = createContext(CURRENT_USER_ID);
export const CurrentUserProvider = CurrentUserContext.Provider;

/** Resolve connected ownership while retaining the existing demo identity outside a provider. */
export function useCurrentUserId(): string {
  return useContext(CurrentUserContext);
}
