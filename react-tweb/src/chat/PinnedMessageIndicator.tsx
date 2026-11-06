import { useId } from 'react';
import styles from './PinnedMessageIndicator.module.css';

const INDICATOR_HEIGHT = 40;
const INDICATOR_WIDTH = 3;
const SEGMENT_GAP = 2;
const TWO_PIN_HEIGHT = 19;
const THREE_PIN_HEIGHT = 12;
const MANY_PIN_HEIGHT = 10;
const SEGMENT_RADIUS = 1.5;

interface PinnedMessageIndicatorProps {
  count: number;
  index: number;
}

function getSegmentHeight(count: number) {
  if (count === 1) {
    return INDICATOR_HEIGHT;
  }
  if (count === 2) {
    return TWO_PIN_HEIGHT;
  }
  if (count === 3) {
    return THREE_PIN_HEIGHT;
  }
  return MANY_PIN_HEIGHT;
}

function getTrackOffset({
  count,
  index,
  trackHeight,
}: {
  count: number;
  index: number;
  trackHeight: number;
}) {
  if (count <= 3 || index <= 1) {
    return 0;
  }
  if (index >= count - 2) {
    return trackHeight - INDICATOR_HEIGHT;
  }
  return (index - 2) * MANY_PIN_HEIGHT + index * SEGMENT_GAP;
}

/** Match Web K's segmented pin track, moving highlight, and overflow edge fades. */
export function PinnedMessageIndicator({ count, index }: PinnedMessageIndicatorProps) {
  const clipId = useId();
  const segmentHeight = getSegmentHeight(count);
  const segmentStride = segmentHeight + SEGMENT_GAP;
  const trackHeight =
    count <= 3 ? INDICATOR_HEIGHT : segmentHeight * count + SEGMENT_GAP * (count - 1);
  const trackOffset = getTrackOffset({ count, index, trackHeight });
  // These offsets preserve the upstream two-pin gap and three-pin bottom alignment.
  const clipStride = count === 2 ? segmentHeight + SEGMENT_GAP * 2 : segmentStride;
  const markOffset = count === 3 && index === 2 ? segmentStride * index + 1 : segmentStride * index;
  const hasEdgeFades = count > 4;
  const hasTopFade = hasEdgeFades && index > 1;
  const hasBottomFade = hasEdgeFades && index < count - 2;

  return (
    <span
      className={styles.indicator}
      data-fade-top={hasTopFade}
      data-fade-bottom={hasBottomFade}
      aria-hidden="true"
    >
      <span
        className={styles.track}
        style={{
          height: trackHeight,
          transform: `translateY(-${trackOffset}px)`,
          clipPath: `url(#${clipId})`,
        }}
      >
        <svg width="0" height="0" className={styles.definitions}>
          <defs>
            <clipPath id={clipId}>
              {Array.from({ length: count }, (_, segmentIndex) => (
                <rect
                  key={segmentIndex}
                  y={segmentIndex * clipStride}
                  width={INDICATOR_WIDTH}
                  height={segmentHeight}
                  rx={SEGMENT_RADIUS}
                />
              ))}
            </clipPath>
          </defs>
        </svg>
        <span
          className={styles.mark}
          style={{ height: segmentHeight, transform: `translateY(${markOffset}px)` }}
        />
      </span>
    </span>
  );
}
