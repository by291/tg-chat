const WAVEFORM_BAR_COUNT = 30;
const MIDPOINT = 128;
const INPUT_GAIN = 5;

export interface VoiceRecordingMeter {
  read: () => number[];
  dispose: () => void;
}

/** Sample live microphone levels without affecting the recorded audio stream. */
export function createVoiceRecordingMeter(stream: MediaStream): VoiceRecordingMeter | undefined {
  let context: AudioContext | undefined;
  try {
    context = new AudioContext();
    const analyser = context.createAnalyser();
    const source = context.createMediaStreamSource(stream);
    const samples = new Uint8Array(analyser.fftSize);
    const levels: number[] = [];
    const audioContext = context;
    source.connect(analyser);
    void audioContext.resume().catch(() => undefined);

    return {
      read() {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) {
          sum += ((sample - MIDPOINT) / MIDPOINT) ** 2;
        }
        const rms = Math.sqrt(sum / samples.length);
        levels.push(Math.min(rms * INPUT_GAIN, 1));
        return levels.slice(-WAVEFORM_BAR_COUNT);
      },
      dispose() {
        source.disconnect();
        analyser.disconnect();
        void audioContext.close().catch(() => undefined);
      },
    };
  } catch {
    // Recording remains available if Web Audio analysis is unsupported.
    void context?.close().catch(() => undefined);
    return undefined;
  }
}
