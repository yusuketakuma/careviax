import { describe, expect, it, vi } from 'vitest';
import { mapWithConcurrency, normalizeConcurrencyLimit, runSequentially } from './concurrency';

describe('normalizeConcurrencyLimit', () => {
  it('uses the default for missing, non-finite, unsafe, and non-positive values', () => {
    const options = { defaultValue: 8, max: 16 };

    for (const value of [undefined, null, Number.NaN, -1, 0, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(normalizeConcurrencyLimit(value, options)).toBe(8);
    }
  });

  it('truncates finite values and caps them at the maximum', () => {
    const options = { defaultValue: 8, max: 16 };

    expect(normalizeConcurrencyLimit(4.9, options)).toBe(4);
    expect(normalizeConcurrencyLimit('12', options)).toBe(12);
    expect(normalizeConcurrencyLimit(99, options)).toBe(16);
  });
});

describe('mapWithConcurrency', () => {
  it('preserves input order while limiting active mapper calls', async () => {
    const releases: Array<() => void> = [];
    let active = 0;
    let maxActive = 0;

    const promise = mapWithConcurrency([1, 2, 3, 4], 2, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
      active -= 1;
      return value * 10;
    });

    expect(releases).toHaveLength(2);
    releases.splice(0).forEach((release) => release());
    for (let attempt = 0; attempt < 10 && releases.length < 2; attempt += 1) {
      await Promise.resolve();
    }
    expect(releases).toHaveLength(2);
    releases.splice(0).forEach((release) => release());

    await expect(promise).resolves.toEqual([10, 20, 30, 40]);
    expect(maxActive).toBe(2);
  });

  it('returns an empty array for empty input', async () => {
    await expect(mapWithConcurrency([], 4, async (value) => value)).resolves.toEqual([]);
  });

  it('passes the source index to the mapper', async () => {
    await expect(
      mapWithConcurrency(['a', 'b', 'c'], 2, async (value, index) => `${index}:${value}`),
    ).resolves.toEqual(['0:a', '1:b', '2:c']);
  });

  it('does not swallow mapper failures', async () => {
    await expect(
      mapWithConcurrency([1, 2], 2, async (value) => {
        if (value === 2) throw new Error('mapper failed');
        return value;
      }),
    ).rejects.toThrow('mapper failed');
  });

  it('falls back to one worker for invalid direct concurrency values', async () => {
    const seen: number[] = [];

    await expect(
      mapWithConcurrency([1, 2, 3], 0, async (value) => {
        seen.push(value);
        return value;
      }),
    ).resolves.toEqual([1, 2, 3]);
    expect(seen).toEqual([1, 2, 3]);
  });
});

describe('runSequentially', () => {
  it('starts each task only after the previous task has settled and preserves tuple order', async () => {
    const events: string[] = [];

    const result = await runSequentially([
      async () => {
        events.push('first:start');
        await Promise.resolve();
        events.push('first:end');
        return 1;
      },
      async () => {
        events.push('second:start');
        return 'two';
      },
    ] as const);

    expect(result).toEqual([1, 'two']);
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('does not start later tasks after a failure', async () => {
    const laterTask = vi.fn();

    await expect(
      runSequentially([
        async () => {
          throw new Error('query failed');
        },
        laterTask,
      ] as const),
    ).rejects.toThrow('query failed');
    expect(laterTask).not.toHaveBeenCalled();
  });
});
