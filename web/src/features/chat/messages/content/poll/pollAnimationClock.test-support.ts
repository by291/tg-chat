import { act } from '@testing-library/react';
import { MotionGlobalConfig, processFrame } from 'motion/react';
import { vi } from 'vitest';

const FRAME_DURATION_MS = 16;

/** Drive real Motion animations and their deadlines on one controlled timeline. */
export function createPollAnimationClock() {
  const previousManualTiming = MotionGlobalConfig.useManualTiming;
  vi.useFakeTimers();
  MotionGlobalConfig.useManualTiming = true;
  processFrame(performance.now());

  async function advance(milliseconds: number) {
    await act(async () => {
      let remaining = milliseconds;
      while (remaining > 0) {
        const step = Math.min(FRAME_DURATION_MS, remaining);
        await vi.advanceTimersByTimeAsync(step);
        processFrame(performance.now());
        remaining -= step;
      }
    });
  }

  function restore() {
    MotionGlobalConfig.useManualTiming = previousManualTiming;
    vi.useRealTimers();
  }

  return { advance, restore };
}
