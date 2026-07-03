import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getLabelDictionaryValueMock } = vi.hoisted(() => ({
  getLabelDictionaryValueMock: vi.fn(),
}));

vi.mock('@/server/services/label-dictionary', () => ({
  getLabelDictionaryValue: getLabelDictionaryValueMock,
}));

import { conflict, localizedError, notFound, rateLimited, unauthorized } from '../response';

describe('api response helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLabelDictionaryValueMock.mockImplementation(
      async (_key: string, fallback: string) => fallback,
    );
  });

  it('localizes messages through LabelDictionary fallbacks', async () => {
    getLabelDictionaryValueMock.mockResolvedValue('認証が必要です（辞書）');

    const response = await unauthorized();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_UNAUTHENTICATED',
      message: '認証が必要です（辞書）',
    });
  });

  it('uses workflow-prefixed codes for not found and conflict helpers', async () => {
    await expect(notFound().json()).resolves.toMatchObject({
      code: 'WORKFLOW_NOT_FOUND',
    });
    await expect(conflict().json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
    });
  });

  it('accepts explicit label keys for localized errors', async () => {
    getLabelDictionaryValueMock.mockResolvedValue('外部送信エラー');

    const response = await localizedError(
      'EXTERNAL_EMAIL_SEND_FAILED',
      '報告送付に失敗しました',
      502,
      { reportId: 'report_1' },
      'api.error.external.email_send_failed',
    );

    expect(getLabelDictionaryValueMock).toHaveBeenCalledWith(
      'api.error.external.email_send_failed',
      '報告送付に失敗しました',
    );
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      code: 'EXTERNAL_EMAIL_SEND_FAILED',
      message: '外部送信エラー',
      details: { reportId: 'report_1' },
    });
  });

  describe('rateLimited', () => {
    it('returns a 429 with a Retry-After header and a Japanese default message', async () => {
      const response = rateLimited(30);

      expect(response.status).toBe(429);
      expect(response.headers.get('Retry-After')).toBe('30');
      await expect(response.json()).resolves.toEqual({
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'リクエストが多すぎます。しばらくしてから再度お試しください',
      });
    });

    it('rounds up fractional retry-after seconds', () => {
      const response = rateLimited(0.2);
      expect(response.headers.get('Retry-After')).toBe('1');
    });

    it('guards against non-finite or non-positive retry-after values', () => {
      expect(rateLimited(Number.NaN).headers.get('Retry-After')).toBe('1');
      expect(rateLimited(-5).headers.get('Retry-After')).toBe('1');
      expect(rateLimited(0).headers.get('Retry-After')).toBe('1');
    });

    it('accepts a custom message', async () => {
      const response = rateLimited(10, 'カスタムメッセージ');
      await expect(response.json()).resolves.toMatchObject({ message: 'カスタムメッセージ' });
    });
  });
});
