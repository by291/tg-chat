import { expect, it } from 'vitest';
import { createProfileWheelGesture } from './profileWheelGesture';

it('ignores a decaying scroll tail but accepts a fresh pull after a pause', () => {
  const isMomentum = createProfileWheelGesture();
  let time = 0;
  for (let magnitude = 100; magnitude >= 60; magnitude -= 10) {
    isMomentum({ delta: -magnitude, time });
    time += 16;
  }
  expect(isMomentum({ delta: -50, time })).toBe(true);
  expect(isMomentum({ delta: -30, time: 400 })).toBe(false);
});

it('accepts reversing direction immediately after momentum', () => {
  const isMomentum = createProfileWheelGesture();
  isMomentum({ delta: -100, time: 0 });
  isMomentum({ delta: -90, time: 16 });
  isMomentum({ delta: -80, time: 32 });
  expect(isMomentum({ delta: -70, time: 48 })).toBe(true);
  expect(isMomentum({ delta: 20, time: 64 })).toBe(false);
});
