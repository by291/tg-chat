const MAX_SAMPLES = 12;
const MIN_SAMPLES = 4;
const GESTURE_GAP = 200;
const INERTIA_INTERVAL = 40;
const INERTIA_DECAY_RATIO = 0.6;
const INERTIA_SPREAD_RATIO = 0.8;
const INPUT_MAGNITUDE = 25;
const INPUT_DECAY_RATIO = 0.4;

interface WheelSample {
  time: number;
  magnitude: number;
}

/** Separate deliberate pulls from decaying trackpad momentum, following TWeb's classifier. */
export function createProfileWheelGesture() {
  const samples: WheelSample[] = [];
  let isInertia = false;
  let previousDirection = 0;

  return ({ delta, time }: { delta: number; time: number }) => {
    const direction = Math.sign(delta);
    const previous = samples.at(-1);
    const isNewGesture =
      previous && (time - previous.time > GESTURE_GAP || direction !== previousDirection);
    if (isNewGesture) {
      samples.length = 0;
      isInertia = false;
    }

    previousDirection = direction;
    samples.push({ time, magnitude: Math.abs(delta) });
    if (samples.length > MAX_SAMPLES) {
      samples.shift();
    }
    if (samples.length < MIN_SAMPLES) {
      return isInertia;
    }

    let totalMagnitude = 0;
    let totalInterval = 0;
    let decayCount = 0;
    for (let i = 0; i < samples.length; i += 1) {
      totalMagnitude += samples[i].magnitude;
      if (i > 0) {
        totalInterval += samples[i].time - samples[i - 1].time;
        decayCount += Number(samples[i].magnitude < samples[i - 1].magnitude);
      }
    }

    const meanMagnitude = totalMagnitude / samples.length;
    const meanInterval = totalInterval / (samples.length - 1);
    const decayRatio = decayCount / (samples.length - 1);
    let variance = 0;
    for (const sample of samples) {
      variance += (sample.magnitude - meanMagnitude) ** 2;
    }

    const deviation = Math.sqrt(variance / samples.length);
    const hasDecayingMomentum =
      meanInterval < INERTIA_INTERVAL &&
      decayRatio > INERTIA_DECAY_RATIO &&
      deviation < meanMagnitude * INERTIA_SPREAD_RATIO;
    const hasDeliberateInput = meanMagnitude > INPUT_MAGNITUDE && decayRatio < INPUT_DECAY_RATIO;

    // Ambiguous samples keep the prior classification instead of toggling during momentum.
    if (hasDecayingMomentum) {
      isInertia = true;
    } else if (hasDeliberateInput) {
      isInertia = false;
    }

    return isInertia;
  };
}
