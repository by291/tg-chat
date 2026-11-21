import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import styles from './VoiceRecordingBar.module.css';

const WAVEFORM_HEIGHT = 28;
const BAR_WIDTH = 3;
const BAR_GAP = 3;
const BAR_STRIDE = BAR_WIDTH + BAR_GAP;
const MINIMUM_PEAK = 0.001;
const UNPLAYED_OPACITY = 0.3;
const BAR_CENTER_OFFSET = 0.5;

interface RecordingWaveformProps {
  levels: readonly number[];
  isPreview?: boolean;
  progress?: number;
  children?: ReactNode;
}

interface WaveformFit {
  levels: readonly number[];
  width: number;
  isPreview: boolean;
}

function fitWaveform({ levels, width, isPreview }: WaveformFit) {
  const capacity = Math.max(1, Math.floor((width + BAR_GAP) / BAR_STRIDE));
  const count = Math.min(levels.length, capacity);
  const firstLiveSample = Math.max(0, levels.length - count);
  const fitted: number[] = [];
  let maximumPeak = isPreview ? MINIMUM_PEAK : 1;

  for (let index = 0; index < count; index++) {
    // Preview buckets span the whole take. The live meter shows only its newest samples.
    const start = isPreview ? Math.floor((index * levels.length) / count) : firstLiveSample + index;
    const end = isPreview ? Math.floor(((index + 1) * levels.length) / count) : start + 1;
    let peak = 0;
    for (let sampleIndex = start; sampleIndex < end; sampleIndex++) {
      peak = Math.max(peak, levels[sampleIndex]);
    }
    fitted.push(peak);
    maximumPeak = Math.max(maximumPeak, peak);
  }

  const liveStart = Math.max(0, width + BAR_GAP - count * BAR_STRIDE);
  return fitted.map((peak, index) => {
    const left = isPreview
      ? ((index + BAR_CENTER_OFFSET) * width) / count - BAR_WIDTH / 2
      : liveStart + index * BAR_STRIDE;
    const height = Math.max(BAR_WIDTH, (peak / maximumPeak) * WAVEFORM_HEIGHT);
    return { left, height };
  });
}

/** Draw the live meter or a fitted full-take waveform under the native seek control. */
export function RecordingWaveform({
  levels,
  isPreview = false,
  progress = 1,
  children,
}: RecordingWaveformProps) {
  const track = useRef<HTMLDivElement>(null);
  const gradientId = useId();
  const [width, setWidth] = useState(0);
  // prettier-ignore
  const bars = useMemo(
    () => fitWaveform({
      levels,
      width,
      isPreview,
    }),
    [
      isPreview,
      levels,
      width,
    ],
  );

  useEffect(() => {
    const element = track.current;
    if (!element) {
      return;
    }

    setWidth(element.clientWidth);
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={styles.waveform} ref={track}>
      <svg
        className={styles.waveformDrawing}
        viewBox={`0 0 ${Math.max(1, width)} ${WAVEFORM_HEIGHT}`}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradientId} x2={width} y2="0" gradientUnits="userSpaceOnUse">
            <stop offset={progress} stopColor="currentColor" />
            <stop offset={progress} stopColor="currentColor" stopOpacity={UNPLAYED_OPACITY} />
          </linearGradient>
        </defs>
        <g fill={`url(#${gradientId})`}>
          {bars.map(({ left, height }) => (
            <rect
              key={left}
              x={left}
              y={(WAVEFORM_HEIGHT - height) / 2}
              width={BAR_WIDTH}
              height={height}
              rx={BAR_WIDTH / 2}
            />
          ))}
          {bars.length === 0 && (
            <rect
              x="0"
              y={(WAVEFORM_HEIGHT - BAR_WIDTH) / 2}
              width={width}
              height={BAR_WIDTH}
              rx={BAR_WIDTH / 2}
            />
          )}
        </g>
      </svg>
      {children}
    </div>
  );
}
