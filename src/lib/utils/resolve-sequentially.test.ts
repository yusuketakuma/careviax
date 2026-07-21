import { describe, expect, it, vi } from 'vitest';

import { resolveSequentially } from './resolve-sequentially';

describe('resolveSequentially', () => {
  it('does not start the next task before the current task resolves', async () => {
    let resolveFirst!: (value: string) => void;
    const firstPromise = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    const second = vi.fn().mockResolvedValue(2);

    const resultPromise = resolveSequentially([() => firstPromise, second] as const);
    await Promise.resolve();
    expect(second).not.toHaveBeenCalled();

    resolveFirst('first');
    await expect(resultPromise).resolves.toEqual(['first', 2]);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
