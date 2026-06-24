import { describe, expect, it, vi } from 'vitest';
import { maybeUnrefTimeout } from './abort-timeout';

describe('maybeUnrefTimeout', () => {
  it('unrefs Node-style timeout handles', () => {
    const unref = vi.fn();
    const timeout = { unref } as unknown as ReturnType<typeof setTimeout>;

    maybeUnrefTimeout(timeout);

    expect(unref).toHaveBeenCalledTimes(1);
  });

  it('ignores browser-style numeric timeout handles', () => {
    expect(() => {
      maybeUnrefTimeout(123 as unknown as ReturnType<typeof setTimeout>);
    }).not.toThrow();
  });

  it('ignores object timeout handles without unref', () => {
    expect(() => {
      maybeUnrefTimeout({} as ReturnType<typeof setTimeout>);
    }).not.toThrow();
  });
});
