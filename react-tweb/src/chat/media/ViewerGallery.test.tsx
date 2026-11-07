// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createInitialState } from '../demo/fixtures';
import { ViewerGallery } from './ViewerGallery';

const firstPhoto = {
  ...createInitialState().messages[0],
  id: 'first-photo',
  attachment: {
    url: '/first.png',
    name: 'First photo',
    width: 800,
    height: 600,
  },
};
const secondPhoto = {
  ...firstPhoto,
  id: 'second-photo',
  attachment: {
    url: '/second.png',
    name: 'Second photo',
    width: 400,
    height: 800,
  },
};
const finishAnimations: Array<() => void> = [];

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  HTMLElement.prototype.animate = () => {
    return {
      finished: new Promise<void>((resolve) => finishAnimations.push(resolve)),
      cancel: () => {},
    } as unknown as Animation;
  };
});

afterEach(() => {
  cleanup();
  finishAnimations.length = 0;
  vi.unstubAllGlobals();
});

async function finishMotion() {
  await act(async () => {
    for (const finish of finishAnimations.splice(0)) {
      finish();
    }
  });
}

it('keeps the outgoing photo mounted until the incoming photo finishes sliding', async () => {
  const view = render(<ViewerGallery message={firstPhoto} isOpen activeIndex={0} />);
  fireEvent.load(screen.getByAltText('First photo'));
  await finishMotion();
  view.rerender(<ViewerGallery message={secondPhoto} isOpen activeIndex={1} />);

  expect(screen.getByAltText('First photo')).toBeTruthy();
  expect(screen.getByAltText('Second photo')).toBeTruthy();
  fireEvent.load(screen.getByAltText('Second photo'));
  await finishMotion();
  expect(screen.queryByAltText('First photo')).toBeNull();
  expect(screen.getByAltText('Second photo')).toBeTruthy();
});
