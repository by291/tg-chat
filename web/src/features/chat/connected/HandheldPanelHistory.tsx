import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router';
import { useHandheldLayout } from '@/layouts/chat/useHandheldLayout';

type PanelKind = 'information' | 'voter';
type PanelTokens = Partial<Record<PanelKind, string>>;

export interface PanelEntry<Value> {
  token: string;
  value: Value;
}

interface PanelNavigation {
  tokens: PanelTokens;
  isTraversing: boolean;
  push: (kind: PanelKind, token: string) => void;
  back: () => void;
}

const HistoryContext = createContext<PanelNavigation | undefined>(undefined);

/** Put opaque panel tokens in browser entries while private targets stay in session memory. */
export function HandheldPanelHistory(props: {
  children: ReactNode;
  captureIntent: () => () => boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const isTraversing = useNavigationType() === 'POP';
  const tokens: PanelTokens = location.state?.chatPanels ?? {};
  function ownsEntry() {
    const browserKey = window.history.state?.key ?? 'default';
    return browserKey === location.key;
  }

  function push(kind: PanelKind, token: string) {
    // A resize can run before React commits the account route already in browser history.
    if (!ownsEntry()) {
      return;
    }
    props.captureIntent();
    const chatPanels =
      kind === 'information' ? { information: token } : { ...tokens, voter: token };
    navigate(location.pathname + location.search + location.hash, {
      preventScrollReset: true,
      state: { ...location.state, chatPanels },
    });
  }
  function back() {
    if (!ownsEntry()) {
      return;
    }
    props.captureIntent();
    navigate(-1);
  }

  const navigation = {
    tokens,
    isTraversing,
    push,
    back,
  };
  return <HistoryContext value={navigation}>{props.children}</HistoryContext>;
}

/** Resolve browser traversal against the panel targets still authorized by their mounted owner. */
export function useHandheldPanel<Value>(options: {
  kind: PanelKind;
  remembered?: RefObject<PanelEntry<Value> | undefined>;
  isValid: (value: Value) => boolean;
}) {
  const navigation = useContext(HistoryContext);
  const isHandheld = useHandheldLayout();
  const ownEntry = useRef<PanelEntry<Value>>(undefined);
  const entry = options.remembered ?? ownEntry;
  const [local, setLocal] = useState<Value>();
  const rejected = useRef<string>(undefined);
  const token = navigation?.tokens[options.kind];
  const recorded = entry.current;
  const isRecorded = recorded !== undefined && recorded.token === token;
  const candidate = isRecorded ? recorded.value : local;
  const selection = candidate !== undefined && options.isValid(candidate) ? candidate : undefined;

  function open(value: Value) {
    if (!isHandheld || !navigation) {
      setLocal(value);
      return;
    }
    const nextToken = crypto.randomUUID();
    // A fresh push replaces the previous Forward branch for this panel.
    entry.current = { token: nextToken, value };
    setLocal(undefined);
    navigation.push(options.kind, nextToken);
  }

  useLayoutEffect(() => {
    // Forget invalid targets even while Back has hidden them, before Forward can present one.
    if (recorded && !options.isValid(recorded.value)) {
      entry.current = undefined;
    }
    const isInvalidTraversal = navigation?.isTraversing && !isRecorded;
    const mustReturn =
      token && selection === undefined && (options.kind === 'voter' || isInvalidTraversal);
    if (mustReturn && rejected.current !== token) {
      // Avoid an invisible Back step when Forward visits a formerly authorized target.
      rejected.current = token;
      navigation?.back();
    } else if (!mustReturn) {
      rejected.current = undefined;
    }
    if (local === undefined) {
      return;
    }
    if (!options.isValid(local)) {
      setLocal(undefined);
    } else if (isHandheld && navigation && !token) {
      open(local);
    }
  });

  function close() {
    if (isRecorded) {
      navigation?.back();
    }
    setLocal(undefined);
  }

  return {
    selection,
    open,
    close,
  };
}
