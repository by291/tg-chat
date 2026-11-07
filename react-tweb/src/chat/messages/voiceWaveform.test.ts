import { describe, expect, it } from 'vitest';
import { createVoiceWaveform } from './voiceWaveform';

describe('voice waveform geometry', () => {
  it('preserves a final peak when reducing a waveform to fit the available width', () => {
    const waveform = Array<number>(100).fill(0);
    waveform[99] = 1;
    const geometry = createVoiceWaveform({
      waveform,
      duration: 12,
      isMobile: false,
    });
    const lastBar = geometry.bars.at(-1)!;

    expect(geometry.bars.length).toBeGreaterThan(0);
    expect(geometry.bars.length).toBeLessThan(waveform.length);
    expect(lastBar.height).toBeGreaterThan(geometry.bars[0].height);
    expect(lastBar.left + lastBar.width).toBeLessThanOrEqual(geometry.width);
  });

  it('keeps silent samples visible without invalid heights', () => {
    const geometry = createVoiceWaveform({
      waveform: [0, 0],
      duration: 10,
      isMobile: false,
    });

    expect(geometry.bars).toHaveLength(2);
    for (const bar of geometry.bars) {
      expect(Number.isFinite(bar.height)).toBe(true);
      expect(bar.height).toBeGreaterThan(0);
      expect(bar.height).toBeLessThanOrEqual(geometry.height);
    }
  });

  it('leaves missing waveform samples empty for the progress-line fallback', () => {
    const geometry = createVoiceWaveform({
      waveform: [],
      duration: 10,
      isMobile: false,
    });

    expect(geometry.bars).toEqual([]);
    expect(geometry.width).toBeGreaterThan(0);
  });
});
