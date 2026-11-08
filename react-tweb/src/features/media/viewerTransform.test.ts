import { describe, expect, it } from 'vitest';
import {
  boundViewerTransform,
  getRotatedViewerRect,
  getViewerWheelScale,
  zoomViewerAtPoint,
  type ViewerGeometry,
} from './viewerTransform';

const geometry: ViewerGeometry = {
  media: {
    left: 100,
    top: 100,
    width: 800,
    height: 600,
  },
  viewport: { width: 1000, height: 800 },
  mediaBox: { width: 1000, height: 610 },
};

describe('viewer transform geometry', () => {
  it('keeps the content beneath the cursor stationary when zooming', () => {
    const transformed = zoomViewerAtPoint({
      transform: {
        offsetX: 0,
        offsetY: 0,
        scale: 1,
        rotation: 0,
      },
      scale: 2,
      point: { left: 400, top: 300 },
      geometry,
    });

    expect(transformed.offsetX + 400 * transformed.scale).toBe(400);
    expect(transformed.offsetY + 300 * transformed.scale).toBe(300);
  });

  it('stops panning at the media edges instead of exposing empty space', () => {
    const transformed = boundViewerTransform({
      transform: {
        offsetX: 900,
        offsetY: -900,
        scale: 2,
        rotation: 0,
      },
      geometry,
    });

    expect(transformed.offsetX).toBe(-200);
    expect(transformed.offsetY).toBe(-600);
  });

  it('centers media on axes where the zoomed image is smaller than the viewport', () => {
    const transformed = boundViewerTransform({
      transform: {
        offsetX: 900,
        offsetY: -900,
        scale: 0.5,
        rotation: 0,
      },
      geometry,
    });

    expect(transformed.offsetX).toBe(250);
    expect(transformed.offsetY).toBe(200);
  });

  it('refits a quarter-turn to the available height while preserving its center', () => {
    const rectangle = getRotatedViewerRect({ geometry, rotation: -90 });

    expect(rectangle.height).toBe(610);
    expect(rectangle.width).toBe(457.5);
    expect(rectangle.left + rectangle.width / 2).toBe(500);
    expect(rectangle.top + rectangle.height / 2).toBe(400);
    expect(getRotatedViewerRect({ geometry, rotation: -360 })).toEqual(geometry.media);
  });

  it('bounds panning against the refitted rotated dimensions', () => {
    const transformed = boundViewerTransform({
      transform: {
        offsetX: 900,
        offsetY: -900,
        scale: 2,
        rotation: -90,
      },
      geometry,
    });

    expect(transformed.offsetX).toBe(-500);
    expect(transformed.offsetY).toBe(-610);
  });

  it('limits wheel increments and clamps zoom at both supported endpoints', () => {
    expect(getViewerWheelScale({ scale: 1, deltaY: -100 })).toBe(1.25);
    expect(getViewerWheelScale({ scale: 1, deltaY: 10 })).toBe(0.9);
    expect(getViewerWheelScale({ scale: 4, deltaY: -100 })).toBe(4);
    expect(getViewerWheelScale({ scale: 0.5, deltaY: 100 })).toBe(0.5);
  });
});
