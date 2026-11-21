import { useState } from 'react';

export interface AccountDetailNavigation {
  value?: string;
  open: (value?: string) => void;
}

/** Use the workspace detail route or keep a local selection in a standalone panel. */
export function useAccountDetail(navigation?: AccountDetailNavigation) {
  const [value, open] = useState<string>();
  return navigation ?? { value, open };
}
