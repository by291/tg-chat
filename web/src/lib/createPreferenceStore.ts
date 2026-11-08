import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

interface PreferenceStoreOptions<State> {
  storageKey: string;
  parse: (value: unknown) => State;
}

/** Share validated preference state while preserving the existing browser storage format. */
export function createPreferenceStore<State>({ storageKey, parse }: PreferenceStoreOptions<State>) {
  let hasSavedValue = false;
  let subscriberCount = 0;

  function readStoredValue(): State {
    try {
      const stored = localStorage.getItem(storageKey);
      hasSavedValue = stored !== null;
      return parse(stored ? JSON.parse(stored) : {});
    } catch {
      return parse({});
    }
  }

  const store = createStore(() => ({ preferences: readStoredValue() }));
  const subscribeToStore = store.subscribe;

  function synchronizeStorage(event: StorageEvent) {
    if (event.key === storageKey || event.key === null) {
      store.setState({ preferences: readStoredValue() });
    }
  }

  // React selectors and imperative playback owners share one cross-tab event subscription.
  store.subscribe = (listener) => {
    if (subscriberCount === 0) {
      window.addEventListener('storage', synchronizeStorage);
    }

    subscriberCount += 1;
    const unsubscribe = subscribeToStore(listener);

    return () => {
      unsubscribe();
      subscriberCount -= 1;

      if (subscriberCount === 0) {
        window.removeEventListener('storage', synchronizeStorage);
      }
    };
  };

  function save(value: State) {
    const next = parse(value);
    hasSavedValue = true;
    let isSaved = true;

    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // A failed write must still leave the user's choice active for this session.
      isSaved = false;
    }

    store.setState({ preferences: next });

    return isSaved;
  }

  function selectSnapshot(snapshot: State) {
    return snapshot;
  }

  function useValue(): State;
  function useValue<Selection>(selector: (snapshot: State) => Selection): Selection;
  function useValue(selector: (snapshot: State) => unknown = selectSnapshot) {
    return useStore(store, (snapshot) => selector(snapshot.preferences));
  }

  return {
    getSnapshot: () => store.getState().preferences,
    subscribe: store.subscribe,
    hasSavedValue: () => hasSavedValue,
    save,
    useValue,
  };
}
