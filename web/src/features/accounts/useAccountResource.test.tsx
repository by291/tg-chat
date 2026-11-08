// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useAccountResource } from './useAccountResource';

afterEach(cleanup);

it('does not present a previous directory under the actions of a newly selected scope', async () => {
  const contacts = async () => ['Alice'];
  const blocks = async () => new Promise<string[]>(() => undefined);
  const page = renderHook(({ load }) => useAccountResource(load), {
    initialProps: { load: contacts },
  });
  await waitFor(() => expect(page.result.current.value).toEqual(['Alice']));
  page.rerender({ load: blocks });

  expect(page.result.current.value).toBeUndefined();
  expect(page.result.current.isLoading).toBe(true);
});
