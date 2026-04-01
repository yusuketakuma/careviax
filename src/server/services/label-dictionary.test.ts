import { beforeEach, describe, expect, it, vi } from 'vitest';

const { labelFindManyMock } = vi.hoisted(() => ({
  labelFindManyMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    labelDictionary: {
      findMany: labelFindManyMock,
    },
  },
}));

import { getLabelDictionaryValues, getLabelDictionaryValue } from './label-dictionary';

describe('getLabelDictionaryValues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns DB labels when found', async () => {
    labelFindManyMock.mockResolvedValue([
      { key: 'mail.subject', label_ja: 'メール件名' },
      { key: 'mail.footer', label_ja: 'フッタ文' },
    ]);

    const result = await getLabelDictionaryValues([
      { key: 'mail.subject', fallback: 'Subject' },
      { key: 'mail.footer', fallback: 'Footer' },
    ]);

    expect(result).toEqual({
      'mail.subject': 'メール件名',
      'mail.footer': 'フッタ文',
    });
  });

  it('returns fallback when DB has no matching row', async () => {
    labelFindManyMock.mockResolvedValue([]);

    const result = await getLabelDictionaryValues([
      { key: 'missing.key', fallback: 'デフォルト値' },
    ]);

    expect(result).toEqual({
      'missing.key': 'デフォルト値',
    });
  });

  it('deduplicates requests with the same key', async () => {
    labelFindManyMock.mockResolvedValue([
      { key: 'dup.key', label_ja: 'ラベル' },
    ]);

    const result = await getLabelDictionaryValues([
      { key: 'dup.key', fallback: 'A' },
      { key: 'dup.key', fallback: 'B' },
    ]);

    expect(labelFindManyMock).toHaveBeenCalledOnce();
    // Last entry wins during dedup (Map behavior)
    expect(result['dup.key']).toBe('ラベル');
  });
});

describe('getLabelDictionaryValue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the single label value', async () => {
    labelFindManyMock.mockResolvedValue([
      { key: 'single.key', label_ja: '値' },
    ]);

    const result = await getLabelDictionaryValue('single.key', 'fallback');
    expect(result).toBe('値');
  });

  it('returns fallback when not found', async () => {
    labelFindManyMock.mockResolvedValue([]);

    const result = await getLabelDictionaryValue('missing', 'デフォルト');
    expect(result).toBe('デフォルト');
  });
});
