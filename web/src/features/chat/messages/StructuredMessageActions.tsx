import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type StructuredMessageAction = 'add-task' | 'change-vote';

interface StructuredMessageRequest {
  messageId: string;
  action: StructuredMessageAction;
}

interface StructuredMessageActions {
  request?: StructuredMessageRequest;
  dispatch: (request?: StructuredMessageRequest) => void;
}

const ActionContext = createContext<StructuredMessageActions>({ dispatch: () => {} });

/** Keep menu requests local to one history, including duplicated message previews. */
export function StructuredMessageActionsProvider({ children }: { children: ReactNode }) {
  const [request, dispatch] = useState<StructuredMessageRequest>();
  const value = useMemo(() => ({ request, dispatch }), [request]);
  return <ActionContext value={value}>{children}</ActionContext>;
}

/** Dispatch a structured-message action from the shared message menu. */
export function useStructuredMessageActions() {
  return useContext(ActionContext);
}

/** Consume a menu request once so remounting a virtual row cannot reopen its editor. */
export function useStructuredMessageAction({
  messageId,
  action,
  onAction,
}: {
  messageId?: string;
  action: StructuredMessageAction;
  onAction: () => void;
}) {
  const { request, dispatch } = useContext(ActionContext);
  // prettier-ignore
  useEffect(() => {
    if (!request || request.messageId !== messageId || request.action !== action) {
      return;
    }

    dispatch(undefined);
    onAction();
  }, [
    request,
    messageId,
    action,
    onAction,
    dispatch
  ]);
}
