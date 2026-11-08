const SECONDS_PER_MINUTE = 60;
const DESKTOP_MIN_WIDTH = 190;
const DESKTOP_MAX_WIDTH = 256;
const MOBILE_MIN_WIDTH = 152;
const MOBILE_MAX_WIDTH = 190;
const BAR_WIDTH = 2;
const BAR_SPACING = 4;
const MIN_BAR_HEIGHT = 4;
const WAVEFORM_HEIGHT = 23;
const TELEGRAM_SAMPLE_MAX = 31;
const NORMALIZATION_OFFSET = 0.5;

interface VoiceWaveformOptions {
  waveform: readonly number[];
  duration: number;
  isMobile: boolean;
}

interface WaveformBar {
  left: number;
  width: number;
  height: number;
}

/** Fit decoded voice samples into a waveform while preserving each interval's peak. */
export function createVoiceWaveform({ waveform, duration, isMobile }: VoiceWaveformOptions) {
  const minimumWidth = isMobile ? MOBILE_MIN_WIDTH : DESKTOP_MIN_WIDTH;
  const maximumWidth = isMobile ? MOBILE_MAX_WIDTH : DESKTOP_MAX_WIDTH;
  const durationWidth = (duration / SECONDS_PER_MINUTE) * maximumWidth;
  const width = Math.min(maximumWidth, Math.max(minimumWidth, durationWidth));
  const barCount = Math.min(Math.floor(width / BAR_SPACING), waveform.length);
  const peakSample = Math.max(0, ...waveform) * TELEGRAM_SAMPLE_MAX;
  const heightRange = WAVEFORM_HEIGHT - MIN_BAR_HEIGHT;
  const bars: WaveformBar[] = [];

  for (let index = 0; index < barCount; index++) {
    const startSample = Math.floor((index * waveform.length) / barCount);
    const endSample = Math.floor(((index + 1) * waveform.length) / barCount);
    let intervalPeak = 0;
    for (let sampleIndex = startSample; sampleIndex < endSample; sampleIndex++) {
      intervalPeak = Math.max(intervalPeak, waveform[sampleIndex] * TELEGRAM_SAMPLE_MAX);
    }

    // Telegram stores five-bit samples; keep its normalization after accepting decoded fractions.
    const normalizedHeight = (intervalPeak * heightRange) / (peakSample + 1) + NORMALIZATION_OFFSET;
    bars.push({
      left: index * BAR_SPACING,
      width: BAR_WIDTH,
      height: Math.max(MIN_BAR_HEIGHT, normalizedHeight),
    });
  }

  return {
    width,
    height: WAVEFORM_HEIGHT,
    bars,
  };
}
