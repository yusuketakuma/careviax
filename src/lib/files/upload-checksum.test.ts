import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeUploadSha256Hex } from './upload-checksum';

describe('computeUploadSha256Hex', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('computes the lowercase SHA-256 digest for the exact upload bytes', async () => {
    const file = new Blob(['abc'], { type: 'text/plain' });

    await expect(computeUploadSha256Hex(file)).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('fails with fixed PHI-safe copy when Web Crypto is unavailable', async () => {
    vi.stubGlobal('crypto', undefined);

    await expect(computeUploadSha256Hex(new Blob(['abc']))).rejects.toThrow(
      'ファイルの整合性確認に失敗しました。ブラウザーを更新して再試行してください',
    );
  });

  it('does not expose browser crypto errors when digesting fails', async () => {
    vi.stubGlobal('crypto', {
      subtle: {
        digest: vi.fn().mockRejectedValue(new Error('provider detail must stay hidden')),
      },
    });

    await expect(computeUploadSha256Hex(new Blob(['abc']))).rejects.toThrow(
      'ファイルの整合性確認に失敗しました。ブラウザーを更新して再試行してください',
    );
  });
});
