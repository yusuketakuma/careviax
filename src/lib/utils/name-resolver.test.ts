import { describe, expect, it, vi } from 'vitest';
import { batchResolveNames } from './name-resolver';

describe('batchResolveNames', () => {
  it('returns an id-to-name map for the requested users', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'user_1', name: '佐藤 薬剤師' },
      { id: 'user_2', name: '青木 薬剤師' },
    ]);
    const prisma = {
      user: {
        findMany,
      },
    };

    const result = await batchResolveNames(prisma, 'org_1', ['user_1', 'user_2']);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: { in: ['user_1', 'user_2'] },
      },
      select: {
        id: true,
        name: true,
      },
    });
    expect(result.get('user_1')).toBe('佐藤 薬剤師');
    expect(result.get('user_2')).toBe('青木 薬剤師');
  });

  it('skips prisma access when no ids are requested', async () => {
    const findMany = vi.fn();
    const prisma = {
      user: {
        findMany,
      },
    };

    const result = await batchResolveNames(prisma, 'org_1', []);

    expect(result.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});
