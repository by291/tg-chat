import { ChevronDown, ChevronUp } from 'lucide-react';
import type { Ref } from 'react';
import { IconButton } from '@/components/IconButton';
import styles from './ChatSearch.module.css';

interface MobileSearchNavigationProps {
  activeIndex: number;
  count: number;
  hasMore: boolean;
  isShowingTimeline: boolean;
  toggleRef: Ref<HTMLButtonElement>;
  onToggle: () => void;
  onStep: (direction: number) => void;
}

/** Keep the loaded count and the current match available while viewing the conversation. */
export function MobileSearchNavigation(props: MobileSearchNavigationProps) {
  const { activeIndex, count, hasMore, isShowingTimeline, toggleRef, onToggle, onStep } = props;
  const countLabel = hasMore ? `${count}+` : String(count);
  const resultNoun = count === 1 && !hasMore ? 'result' : 'results';
  const position = activeIndex + 1;

  return (
    <>
      <span className={styles.mobileCount} role="status" aria-label="Search position">
        {isShowingTimeline && position > 0
          ? `${position} of ${countLabel}`
          : `${countLabel} ${resultNoun}`}
      </span>
      <button ref={toggleRef} type="button" className={styles.mobileToggle} onClick={onToggle}>
        {isShowingTimeline ? 'Show search results' : 'Show in chat'}
      </button>
      {isShowingTimeline && count > 1 && (
        <div className={styles.mobileNavigation} aria-label="Navigate search results">
          <IconButton
            label="Previous search result"
            disabled={activeIndex <= 0}
            onClick={() => onStep(-1)}
          >
            <ChevronUp />
          </IconButton>
          <IconButton
            label="Next search result"
            disabled={activeIndex === count - 1}
            onClick={() => onStep(1)}
          >
            <ChevronDown />
          </IconButton>
        </div>
      )}
    </>
  );
}
