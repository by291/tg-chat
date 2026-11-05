import { describe, expect, it } from 'vitest';
import { getMediaGeometry } from './mediaGeometry';

describe('media geometry before decoding', () => {
  it('fits a landscape into the Telegram desktop frame', () => {
    const frame = getMediaGeometry({ width: 1200, height: 800, hasCaption: false });
    expect(frame).toEqual({ width: 420, height: 280 });
  });

  it('widens a portrait caption without changing the reserved height', () => {
    const frame = getMediaGeometry({ width: 300, height: 900, hasCaption: true });
    expect(frame).toEqual({ width: 320, height: 400 });
  });

  it('scales the entire reserved frame to the narrow viewport', () => {
    const frame = getMediaGeometry({
      width: 1200,
      height: 800,
      hasCaption: false,
      availableWidth: 240,
    });
    expect(frame).toEqual({ width: 240, height: 160 });
  });
});
