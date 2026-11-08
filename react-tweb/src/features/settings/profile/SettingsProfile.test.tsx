// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SettingsProfile } from './SettingsProfile';

const identity = {
  name: 'You',
  initials: 'Y',
  photoUrl: '/assets/settings-avatar.jpg',
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderProfile(photoUrl: string | undefined = identity.photoUrl) {
  render(
    <SettingsProfile identity={{ ...identity, photoUrl }} header={<button>Search settings</button>}>
      <button>General Settings</button>
    </SettingsProfile>,
  );
  return screen.getByRole('region', { name: 'Settings content' });
}

it('expands at the top after the photo loads and folds on the reverse gesture', () => {
  const content = renderProfile();
  fireEvent.load(screen.getByAltText('Your profile photo'));
  const photo = screen.getByRole('button', { name: 'Expand profile photo' });

  fireEvent.wheel(content, { deltaY: -40 });
  expect(photo.getAttribute('aria-expanded')).toBe('true');
  fireEvent.wheel(content, { deltaY: 40 });
  expect(photo.getAttribute('aria-expanded')).toBe('false');
});

it('leaves ordinary scrolling and pinch zoom alone', () => {
  const content = renderProfile();
  fireEvent.load(screen.getByAltText('Your profile photo'));
  const photo = screen.getByRole('button', { name: 'Expand profile photo' });

  content.scrollTop = 100;
  expect(fireEvent.wheel(content, { deltaY: -40 })).toBe(true);
  expect(photo.getAttribute('aria-expanded')).toBe('false');
  content.scrollTop = 0;
  fireEvent.wheel(content, { deltaY: -40, ctrlKey: true });
  expect(photo.getAttribute('aria-expanded')).toBe('false');
});

it('keeps a missing or failed photo collapsed', () => {
  const content = renderProfile();
  fireEvent.wheel(content, { deltaY: -40 });
  expect(screen.queryByRole('button', { name: 'Expand profile photo' })).toBeNull();
  fireEvent.error(screen.getByAltText('Your profile photo'));
  fireEvent.wheel(content, { deltaY: -40 });
  expect(screen.queryByRole('button', { name: 'Expand profile photo' })).toBeNull();
  expect(screen.getByText('Y')).toBeTruthy();
});

it('expands on a vertical touch pull without hijacking a horizontal gesture', () => {
  const content = renderProfile();
  fireEvent.load(screen.getByAltText('Your profile photo'));
  const photo = screen.getByRole('button', { name: 'Expand profile photo' });

  fireEvent.touchStart(content, { touches: [{ clientX: 100, clientY: 100 }] });
  fireEvent.touchMove(content, { touches: [{ clientX: 140, clientY: 102 }] });
  expect(photo.getAttribute('aria-expanded')).toBe('false');
  fireEvent.touchEnd(content);
  fireEvent.touchStart(content, { touches: [{ clientX: 100, clientY: 100 }] });
  fireEvent.touchMove(content, { touches: [{ clientX: 101, clientY: 130 }] });
  expect(photo.getAttribute('aria-expanded')).toBe('true');
});

it('does not unfold when momentum carries a scrolled list back to its top', () => {
  const content = renderProfile();
  fireEvent.load(screen.getByAltText('Your profile photo'));
  content.scrollTop = 100;
  fireEvent.wheel(content, { deltaY: -100 });
  fireEvent.wheel(content, { deltaY: -90 });
  fireEvent.wheel(content, { deltaY: -80 });
  content.scrollTop = 0;
  fireEvent.wheel(content, { deltaY: -70 });
  const photo = screen.getByRole('button', { name: 'Expand profile photo' });
  expect(photo.getAttribute('aria-expanded')).toBe('false');
});

it('keeps the profile folded when content is scrolled with the keyboard', () => {
  const content = renderProfile();
  fireEvent.load(screen.getByAltText('Your profile photo'));
  const photo = screen.getByRole('button', { name: 'Expand profile photo' });
  fireEvent.click(photo);
  expect(photo.getAttribute('aria-expanded')).toBe('true');
  content.scrollTop = 20;
  fireEvent.scroll(content);
  expect(photo.getAttribute('aria-expanded')).toBe('false');
});

it('returns to the top without smooth scrolling after reduced motion is enabled', () => {
  let shouldReduceMotion = false;
  vi.stubGlobal('matchMedia', () => ({ matches: shouldReduceMotion }));
  const content = renderProfile();
  fireEvent.load(screen.getByAltText('Your profile photo'));
  const photo = screen.getByRole('button', { name: 'Expand profile photo' });
  const scrollTo = vi.fn();
  content.scrollTo = scrollTo;
  content.scrollTop = 100;

  fireEvent.click(photo);
  expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' });
  shouldReduceMotion = true;
  fireEvent.click(photo);

  expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' });
  expect(photo.getAttribute('aria-expanded')).toBe('false');
});
