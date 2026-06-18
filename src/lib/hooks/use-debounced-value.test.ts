// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedValue } from './use-debounced-value';

describe('useDebouncedValue', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the initial value immediately', () => {
    const { result } = renderHook(
      ({ value, delay }) => useDebouncedValue(value, delay),
      { initialProps: { value: 'a', delay: 250 } },
    );
    expect(result.current).toBe('a');
  });

  it('delays updates until the debounce window elapses', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebouncedValue(value, delay),
      { initialProps: { value: 'a', delay: 250 } },
    );

    rerender({ value: 'ab', delay: 250 });
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('ab');
  });

  it('coalesces rapid changes to the latest value', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebouncedValue(value, delay),
      { initialProps: { value: 'a', delay: 250 } },
    );

    rerender({ value: 'ab', delay: 250 });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ value: 'abc', delay: 250 });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    // The window restarted on the second change, so nothing has settled yet.
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current).toBe('abc');
  });

  it('returns the live value without delay when delayMs<=0', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebouncedValue(value, delay),
      { initialProps: { value: 'a', delay: 0 } },
    );

    rerender({ value: 'ab', delay: 0 });
    expect(result.current).toBe('ab');

    rerender({ value: 'abc', delay: -1 });
    expect(result.current).toBe('abc');
  });
});
