import {
  animate,
  useMotionValue,
  useTransform,
  type AnimationPlaybackControls,
} from 'motion/react';
import { useLayoutEffect, useRef, useState } from 'react';

const PATH_DURATION = 400;
const BAR_DURATION = 0.6;
const PERCENTAGE_DURATION = 0.9;
const PERCENTAGE_SCALE = 100;

type PollResultStage = 'choice' | 'path' | 'result';

/** Reveal results with Motion values while React owns only the choice/path/result stages. */
export function usePollResultAnimation({
  hasResults,
  percentage,
}: {
  hasResults: boolean;
  percentage: number;
}) {
  const [stage, setStage] = useState<PollResultStage>(hasResults ? 'result' : 'choice');
  const stageRef = useRef(stage);
  const pathStartedAt = useRef(0);
  const animatedPercentage = useMotionValue(hasResults ? percentage : 0);
  const progress = useMotionValue(hasResults ? percentage / PERCENTAGE_SCALE : 0);
  const percentageText = useTransform(() => `${Math.floor(animatedPercentage.get())}%`);

  useLayoutEffect(
    () => {
      let delay: ReturnType<typeof setTimeout> | undefined;
      const animations: AnimationPlaybackControls[] = [];

      function changeStage(nextStage: PollResultStage) {
        stageRef.current = nextStage;
        setStage(nextStage);
      }

      if (!hasResults) {
        changeStage('choice');
        animatedPercentage.jump(0);
        progress.jump(0);
        return;
      }

      const targetProgress = percentage / PERCENTAGE_SCALE;
      const shouldReduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (shouldReduceMotion) {
        changeStage('result');
        animatedPercentage.jump(percentage);
        progress.jump(targetProgress);
        return;
      }

      function animateResult() {
        changeStage('result');
        const percentageDistance = Math.abs(percentage - animatedPercentage.get());
        const progressDistance = Math.abs(targetProgress - progress.get());
        animations.push(
          animate(animatedPercentage, percentage, {
            duration: (PERCENTAGE_DURATION * percentageDistance) / PERCENTAGE_SCALE,
            ease: 'linear',
          }),
          animate(progress, targetProgress, {
            duration: BAR_DURATION * progressDistance,
            ease: 'linear',
          }),
        );
      }

      if (stageRef.current === 'choice') {
        pathStartedAt.current = performance.now();
        changeStage('path');
      }

      if (stageRef.current === 'path') {
        // Updated votes retain the original path deadline instead of restarting the reveal.
        const elapsed = performance.now() - pathStartedAt.current;
        delay = setTimeout(animateResult, Math.max(0, PATH_DURATION - elapsed));
      } else if (animatedPercentage.get() !== percentage || progress.get() !== targetProgress) {
        animateResult();
      }

      return () => {
        clearTimeout(delay);
        // Preserve current values so an interrupting vote continues from the visible position.
        for (const animation of animations) {
          animation.stop();
        }
      };
    },
    // prettier-ignore
    [
    hasResults,
    percentage,
    animatedPercentage,
    progress,
  ],
  );

  return {
    stage,
    percentage: animatedPercentage,
    percentageText,
    progress,
  };
}
