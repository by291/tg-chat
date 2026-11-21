const WAVEFORM_SAMPLE_RATE_HZ = 16_000;
const SECONDS_PER_PEAK = 0.04;

function collectPeaks(recording: AudioBuffer): number[] {
  const bucketCount = Math.max(1, Math.ceil(recording.duration / SECONDS_PER_PEAK));
  const peaks = Array<number>(bucketCount).fill(0);

  for (let channel = 0; channel < recording.numberOfChannels; channel++) {
    const samples = recording.getChannelData(channel);
    for (let bucket = 0; bucket < bucketCount; bucket++) {
      const start = Math.floor((bucket * samples.length) / bucketCount);
      const end = Math.floor(((bucket + 1) * samples.length) / bucketCount);
      let peak = peaks[bucket];
      for (let index = start; index < end; index++) {
        peak = Math.max(peak, Math.abs(samples[index]));
      }
      peaks[bucket] = peak;
    }
  }

  return peaks;
}

/** Extract peaks from the actual playable take in recorded time order. */
export async function readRecordedVoicePeaks(blob: Blob): Promise<number[] | undefined> {
  if (typeof OfflineAudioContext === 'undefined') {
    return;
  }

  try {
    const bytes = await blob.arrayBuffer();
    // The context only decodes. Speech-rate resampling limits PCM memory for long previews.
    const decoder = new OfflineAudioContext({
      length: 1,
      numberOfChannels: 1,
      sampleRate: WAVEFORM_SAMPLE_RATE_HZ,
    });
    const recording = await decoder.decodeAudioData(bytes);
    return collectPeaks(recording);
  } catch {
    // A native codec can play a partial recording even when offline decoding cannot read it.
    return undefined;
  }
}
