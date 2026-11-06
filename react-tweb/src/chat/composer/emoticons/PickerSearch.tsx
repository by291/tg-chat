import { ArrowLeft, Search, X } from 'lucide-react';
import { useRef } from 'react';
import styles from '../EmojiPicker.module.css';

const SEARCH_FILTERS = [
  {
    label: 'Love',
    symbol: '♡',
    query: 'love',
  },
  {
    label: 'Approval',
    symbol: '👍',
    query: 'thumbsup',
  },
  {
    label: 'Cheers',
    symbol: '🎉',
    query: 'party',
  },
  {
    label: 'Laughter',
    symbol: '☺',
    query: 'laugh',
  },
];

interface PickerSearchProps {
  label: string;
  query: string;
  isSearching: boolean;
  onQueryChange: (query: string) => void;
  onSearchingChange: (isSearching: boolean) => void;
}

/** Expand text search without letting palette clicks replace the composer's selection. */
export function PickerSearch({
  label,
  query,
  isSearching,
  onQueryChange,
  onSearchingChange,
}: PickerSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className={styles.searchRow}>
      {isSearching && (
        <button
          className={styles.searchBack}
          aria-label="Back from search"
          onClick={() => {
            onQueryChange('');
            onSearchingChange(false);
            inputRef.current?.blur();
          }}
        >
          <ArrowLeft size={22} />
        </button>
      )}
      <label className={styles.search}>
        <Search size={18} />
        <input
          ref={inputRef}
          value={query}
          placeholder={label}
          aria-label={label}
          onFocus={() => onSearchingChange(true)}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        {query && (
          <button
            aria-label="Clear search"
            onClick={() => {
              onQueryChange('');
              inputRef.current?.focus();
            }}
          >
            <X size={16} />
          </button>
        )}
        {!isSearching && (
          <span className={styles.searchFilters}>
            {SEARCH_FILTERS.map((filter) => (
              <button
                key={filter.label}
                aria-label={filter.label}
                onClick={(event) => {
                  event.preventDefault();
                  onSearchingChange(true);
                  onQueryChange(filter.query);
                }}
              >
                {filter.symbol}
              </button>
            ))}
          </span>
        )}
      </label>
    </div>
  );
}
