// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceMessage } from './VoiceMessage';

const voice = {
  kind: 'voice' as const,
  url: '/voice.ogg',
  duration: 24,
  waveform: [0.2, 0.8],
};

beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('voice message playback', () => {
  it('shows elapsed zero when playback begins instead of the full duration', () => {
    const { container } = render(<VoiceMessage media={voice} />);
    const audio = container.querySelector('audio')!;

    expect(screen.getByText('0:24')).toBeTruthy();
    fireEvent.play(audio);

    expect(screen.getByText('0:00')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pause voice message' })).toBeTruthy();
  });

  it('seeks the actual audio and keeps elapsed zero when rewinding during playback', () => {
    const { container } = render(<VoiceMessage media={voice} />);
    const audio = container.querySelector('audio')!;
    const seekControl = screen.getByRole('slider');
    fireEvent.play(audio);
    fireEvent.change(seekControl, { target: { value: '12' } });

    expect(audio.currentTime).toBe(12);
    expect(screen.getByText('0:12')).toBeTruthy();
    fireEvent.change(seekControl, { target: { value: '0' } });

    expect(audio.currentTime).toBe(0);
    expect(screen.getByText('0:00')).toBeTruthy();
  });

  it('reports a playback failure without switching to a pause control', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('Playback denied'));
    render(<VoiceMessage media={voice} />);

    fireEvent.click(screen.getByRole('button', { name: 'Play voice message' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Audio could not be played.',
    );
    expect(screen.getByRole('button', { name: 'Play voice message' })).toBeTruthy();
  });
});
