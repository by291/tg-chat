import type { ReactNode } from 'react';
import { SidebarNavigation } from '@/layouts/sidebar/SidebarNavigation';
import { useExitingSidebarPage } from '@/layouts/sidebar/useExitingSidebarPage';
import type { AccountPage } from './useAccountNavigation';

interface AccountPageLayersProps {
  path: AccountPage[];
  renderPage: (page: AccountPage) => ReactNode;
}

/** Retain each parent and its focused control as deeper account pages slide over it. */
export function AccountPageLayers({ path, renderPage }: AccountPageLayersProps) {
  const [current, ...children] = path;
  const secondaryPath = useExitingSidebarPage(children.length ? children : undefined);
  return (
    <SidebarNavigation
      isSecondaryOpen={children.length > 0}
      primary={renderPage(current)}
      secondary={
        secondaryPath && (
          <AccountPageLayers key={secondaryPath[0]} path={secondaryPath} renderPage={renderPage} />
        )
      }
    />
  );
}
