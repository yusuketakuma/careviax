import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getLabelDictionaryValueMock } = vi.hoisted(() => ({
  getLabelDictionaryValueMock: vi.fn(),
}));

vi.mock('@/server/services/label-dictionary', () => ({
  getLabelDictionaryValue: getLabelDictionaryValueMock,
}));

import {
  type ApiSuccess,
  conflict,
  error,
  localizedError,
  notFound,
  rateLimited,
  registeredError,
  success,
  successWithMeasuredJsonPayload,
  unauthorized,
  validationError,
} from '../response';

function assertApiSuccessInputContract() {
  const exactEnvelope = {
    data: { ok: true },
    meta: { source: 'type-probe' },
  } satisfies ApiSuccess<{ ok: boolean }>;
  void success(exactEnvelope);
  void successWithMeasuredJsonPayload(exactEnvelope);

  // @ts-expect-error success metadata belongs under meta, never at the root.
  void success({ data: { ok: true }, legacy_metadata: true });
  // @ts-expect-error every success response requires a data root.
  void success({ meta: { source: 'type-probe' } });
}

void assertApiSuccessInputContract;

function assertRegisteredErrorInputContract() {
  void registeredError('VALIDATION_ERROR', '入力値が不正です');
  // @ts-expect-error shared registered errors reject unknown codes at compile time.
  void registeredError('UNREGISTERED_ERROR', '処理に失敗しました');
}

void assertRegisteredErrorInputContract;

describe('api response helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLabelDictionaryValueMock.mockImplementation(
      async (_key: string, fallback: string) => fallback,
    );
  });

  it('preserves exact success envelopes and explicit status codes', async () => {
    const response = success({ data: { ok: true }, meta: { source: 'test' } }, 201);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      data: { ok: true },
      meta: { source: 'test' },
    });
  });

  it('measures the encoded exact success envelope', async () => {
    const payload = { data: { ok: true } };
    const response = successWithMeasuredJsonPayload(payload);

    expect(response.headers.get('Content-Length')).toBe(
      String(new TextEncoder().encode(JSON.stringify(payload)).length),
    );
    await expect(response.json()).resolves.toEqual(payload);
  });

  it('returns standard errors without legacy root aliases', async () => {
    const response = error('EXAMPLE_ERROR', '処理に失敗しました', 503, { retryable: true });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: 'EXAMPLE_ERROR',
      message: '処理に失敗しました',
      details: { retryable: true },
    });
  });

  it('keeps validation details under details only', async () => {
    const response = validationError('入力値が不正です', { url: ['URLが不正です'] });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
      details: { url: ['URLが不正です'] },
    });
  });

  it('derives registered helper status from the canonical definition', async () => {
    const response = registeredError('WORKFLOW_CONFLICT', '再読み込みしてください');

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: 'WORKFLOW_CONFLICT',
      message: '再読み込みしてください',
    });
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
