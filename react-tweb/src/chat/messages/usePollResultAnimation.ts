import { useLayoutEffect, useRef, useState } from 'react';

const PATH_DURATION = 400;
const BAR_DURATION = 600;
const PERCENTAGE_DURATION = 900;
const PERCENTAGE_SCALE = 100;

interface PollResultFrame {
  stage: 'choice' | 'path' | 'result';
  percentage: number;
  progress: number;
}

/** Reveal new results in sequence while restored history renders its final values immediately. */
export function usePollResultAnimation({
  hasResults,
  percentage,
}: {
  hasResults: boolean;
  percentage: number;
}) {
  const [frame, setFrame] = useState<PollResultFrame>(() => ({
    stage: hasResults ? 'result' : 'choice',
    percentage: hasResults ? percentage : 0,
    progress: hasResults ? percentage / PERCENTAGE_SCALE : 0,
  }));
  const currentFrame = useRef(frame);
  const pathStartedAt = useRef(0);

  useLayoutEffect(() => {
    let animationFrame = 0;
    let delay: ReturnType<typeof setTimeout> | undefined;

    function display(nextFrame: PollResultFrame) {
      currentFrame.current = nextFrame;
      setFrame(nextFrame);
    }

    if (!hasResults) {
      display({
        stage: 'choice',
        percentage: 0,
        progress: 0,
      });
      return;
    }

    const targetProgress = percentage / PERCENTAGE_SCALE;
    const shouldReduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (shouldReduceMotion) {
      display({
        stage: 'result',
        percentage,
        progress: targetProgress,
      });
      return;
    }

    function animateResult() {
      const previous = currentFrame.current;
      const percentageDistance = percentage - previous.percentage;
      const progressDistance = targetProgress - previous.progress;
      const percentageDuration =
        (PERCENTAGE_DURATION * Math.abs(percentageDistance)) / PERCENTAGE_SCALE;
      const progressDuration = BAR_DURATION * Math.abs(progressDistance);
      const startedAt = performance.now();
      display({ ...previous, stage: 'result' });

      function advance(now: number) {
        const elapsed = now - startedAt;
        const percentageFraction = percentageDuration
          ? Math.min(1, elapsed / percentageDuration)
          : 1;
        const progressFraction = progressDuration ? Math.min(1, elapsed / progressDuration) : 1;
        display({
          stage: 'result',
          percentage: previous.percentage + percentageDistance * percentageFraction,
          progress: previous.progress + progressDistance * progressFraction,
        });
        if (percentageFraction < 1 || progressFraction < 1) {
          animationFrame = requestAnimationFrame(advance);
        }
      }

      animationFrame = requestAnimationFrame(advance);
    }

    if (currentFrame.current.stage === 'choice') {
      pathStartedAt.current = performance.now();
      display({
        stage: 'path',
        percentage: 0,
        progress: 0,
      });
    }

    if (currentFrame.current.stage === 'path') {
      // Keep the same deadline if an updated vote arrives while the dot is travelling.
      const elapsed = performance.now() - pathStartedAt.current;
      delay = setTimeout(animateResult, Math.max(0, PATH_DURATION - elapsed));
    } else if (
      currentFrame.current.percentage !== percentage ||
      currentFrame.current.progress !== targetProgress
    ) {
      animateResult();
    }

    return () => {
      clearTimeout(delay);
      cancelAnimationFrame(animationFrame);
    };
  }, [hasResults, percentage]);

  return frame;
}
