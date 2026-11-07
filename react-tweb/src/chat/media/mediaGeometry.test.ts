import { describe, expect, it } from 'vitest';
import { getMediaGeometry, getPhotoGeometry } from './mediaGeometry';

describe('media geometry before decoding', () => {
  it('fills a panorama without introducing side bars from rounded height', () => {
    const frame = getPhotoGeometry({
      width: 1600,
      height: 300,
      hasCaption: false,
    });
    expect(frame.imageWidth).toBe(frame.width);
    expect(frame.isFitted).toBe(false);
  });

  it('keeps extreme aspect ratios visible after pixel rounding', () => {
    const portrait = getPhotoGeometry({
      width: 2,
      height: 1000,
      hasCaption: false,
    });
    const panorama = getPhotoGeometry({
      width: 1000,
      height: 2,
      hasCaption: false,
    });
    expect(portrait.imageWidth).toBeGreaterThan(0);
    expect(panorama.height).toBeGreaterThan(0);
    expect(panorama.imageWidth).toBeGreaterThan(0);
  });

  it('uses the handheld height limit while retaining space for a portrait caption', () => {
    const frame = getPhotoGeometry({
      width: 300,
      height: 900,
      hasCaption: true,
      isMobile: true,
    });

    expect(frame.width).toBe(320);
    expect(frame.height).toBe(340);
    expect(frame.imageWidth).toBe(113);
    expect(frame.isFitted).toBe(true);
  });

  it('fits a handheld landscape without cropping or widening its image', () => {
    const frame = getPhotoGeometry({
      width: 1200,
      height: 800,
      hasCaption: false,
      isMobile: true,
    });

    expect(frame.width).toBe(340);
    expect(frame.height).toBe(226);
    expect(frame.imageWidth).toBe(frame.width);
    expect(frame.isFitted).toBe(false);
  });

  it('fits a landscape into the Telegram desktop frame', () => {
    const frame = getMediaGeometry({
      width: 1200,
      height: 800,
      hasCaption: false,
    });
    expect(frame).toEqual({ width: 420, height: 280 });
  });

  it('widens a portrait caption without changing the reserved height', () => {
    const frame = getMediaGeometry({
      width: 300,
      height: 900,
      hasCaption: true,
    });
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

  it('preserves the full portrait within a wider caption frame', () => {
    const frame = getPhotoGeometry({
      width: 300,
      height: 900,
      hasCaption: true,
    });
    expect(frame.imageWidth).toBe(133);
    expect(frame.isFitted).toBe(true);
    expect(frame.height).toBe(400);
  });

  it('keeps a narrow photo visible inside the minimum readable time width', () => {
    const frame = getPhotoGeometry({
      width: 100,
      height: 1000,
      hasCaption: false,
    });
    expect(frame.width).toBe(120);
    expect(frame.imageWidth).toBe(40);
    expect(frame.isFitted).toBe(true);
  });
});
