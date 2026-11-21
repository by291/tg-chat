import { useLocation, useNavigate, useSearchParams } from 'react-router';

type SearchChanges = Record<string, string | undefined>;

interface DestinationChange {
  changes: SearchChanges;
  isReturning?: boolean;
  entryState?: Record<string, string>;
}

/** Traverse only known parent entries and preserve unrelated query parameters. */
export function useSearchDestination() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  function changeDestination({ changes, isReturning = false, entryState }: DestinationChange) {
    const nextParams = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value) {
        nextParams.set(key, value);
      } else {
        nextParams.delete(key);
      }
    }

    const nextSearch = nextParams.toString();
    const currentSearch = searchParams.toString();
    if (nextSearch === currentSearch) {
      return;
    }

    // Only traverse entries created by this navigation owner; a deep link has no known parent.
    const hasParent = !location.state?.chatPanels && location.state?.previousSearch === nextSearch;
    if (isReturning && hasParent) {
      navigate(-1);
      return;
    }

    navigate(
      { search: nextSearch, hash: window.location.hash },
      {
        replace: isReturning,
        preventScrollReset: true,
        state: isReturning ? null : { previousSearch: currentSearch, ...entryState },
      },
    );
  }

  return { searchParams, changeDestination, entryState: location.state };
}
