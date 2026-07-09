import { describe, expect, it } from 'vitest';
import { useStaleAfterRefetchError } from './use-stale-after-refetch-error';

describe('useStaleAfterRefetchError', () => {
  it('treats a first-load error without data as blocking', () => {
    expect(
      useStaleAfterRefetchError({
        data: undefined,
        isError: true,
        isRefetchError: false,
      }),
    ).toMatchObject({
      hasData: false,
      isInitialError: true,
      isStaleAfterRefetchError: false,
    });
  });

  it('keeps existing data visible when a background refetch fails', () => {
    expect(
      useStaleAfterRefetchError({
        data: { rows: [1] },
        isError: true,
        isRefetchError: true,
      }),
    ).toMatchObject({
      hasData: true,
      isInitialError: false,
      isStaleAfterRefetchError: true,
    });
  });

  it('also treats data plus a generic error result as stale instead of blocking', () => {
    expect(
      useStaleAfterRefetchError({
        data: { rows: [1] },
        isError: true,
      }),
    ).toMatchObject({
      hasData: true,
      isInitialError: false,
      isStaleAfterRefetchError: true,
    });
  });

  it('does not treat cached data as an initial loading state', () => {
    expect(
      useStaleAfterRefetchError({
        data: { rows: [] },
        isLoading: true,
      }),
    ).toMatchObject({
      hasData: true,
      isInitialLoading: false,
    });
  });
});
