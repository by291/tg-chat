// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useAuthorizedMediaUrl } from './useAuthorizedMediaUrl';

it('ignores a signing response after its reference is removed', async () => {
  let resolve: (url: string) => void = () => undefined;
  const promise = new Promise<string>((complete) => {
    resolve = complete;
  });
  const authorize = () => promise;
  const { result, rerender } = renderHook(({ key }) => useAuthorizedMediaUrl({ key, authorize }), {
    initialProps: { key: 'visible' as string | undefined },
  });
  rerender({ key: undefined });

  await act(async () => {
    resolve('https://media.example.test/old');
    await promise;
  });

  expect(result.current.url).toBeUndefined();
});
