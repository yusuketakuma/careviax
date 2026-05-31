import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';

const {
  checkAuthRateLimitMock,
  getClientIpMock,
  validateExternalAccessGrantMock,
  markExternalAccessViewedMock,
  buildExternalAccessPayloadMock,
} = vi.hoisted(() => ({
  checkAuthRateLimitMock: vi.fn(),
  getClientIpMock: vi.fn(),
  validateExternalAccessGrantMock: vi.fn(),
  markExternalAccessViewedMock: vi.fn(),
  buildExternalAccessPayloadMock: vi.fn(),
}));

vi.mock('@/server/services/external-access', () => ({
  validateExternalAccessGrant: validateExternalAccessGrantMock,
  markExternalAccessViewed: markExternalAccessViewedMock,
  buildExternalAccessPayload: buildExternalAccessPayloadMock,
}));

vi.mock('@/lib/api/rate-limit', () => ({
  checkAuthRateLimit: checkAuthRateLimitMock,
}));

vi.mock('@/lib/api/request-ip', () => ({
  getClientIp: getClientIpMock,
}));

import { GET } from './route';

function expectedOtpRateLimitIdentifier(token: string, ipAddress: string) {
  return createHash('sha256').update(`${token}:${ipAddress}`).digest('hex');
}

function makeRequest(
  otpHeader: string | null = '1234',
  url = 'http://localhost/api/external-access/token_1',
) {
  const headersMap: Record<string, string> = {};
  if (otpHeader !== null) {
    headersMap['x-otp'] = otpHeader;
  }

  return new NextRequest(url, {
    headers: headersMap,
  });
}

describe('/api/external-access/[token]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkAuthRateLimitMock.mockResolvedValue({
      allowed: true,
      remaining: 4,
      resetAt: Date.now() + 60_000,
    });
    getClientIpMock.mockReturnValue('203.0.113.10');
    validateExternalAccessGrantMock.mockResolvedValue({
      ok: true,
      grant: { id: 'grant_1' },
    });
    buildExternalAccessPayloadMock.mockResolvedValue({
      patient: { id: 'patient_1' },
    });
  });

  it('returns the external access payload for a valid token and otp', async () => {
    const response = await GET(makeRequest('1234'), {
      params: Promise.resolve({ token: 'token_1' }),
    });

    expect(response.status).toBe(200);
    expect(validateExternalAccessGrantMock).toHaveBeenCalledWith('token_1', '1234');
    expect(markExternalAccessViewedMock).toHaveBeenCalledWith('grant_1');
  });

  it('does not accept OTP values from query params', async () => {
    validateExternalAccessGrantMock.mockResolvedValue({
      ok: false,
      kind: 'validation',
      message: 'OTPが必要です',
    });

    const response = await GET(
      makeRequest(null, 'http://localhost/api/external-access/token_1?otp=1234'),
      {
        params: Promise.resolve({ token: 'token_1' }),
      },
    );

    expect(response.status).toBe(400);
    expect(validateExternalAccessGrantMock).toHaveBeenCalledWith('token_1', null);
    expect(markExternalAccessViewedMock).not.toHaveBeenCalled();
    expect(buildExternalAccessPayloadMock).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'missing OTP', otpHeader: null, message: 'OTPが必要です' },
    { label: 'wrong OTP', otpHeader: '0000', message: 'OTPが正しくありません' },
  ])('does not mark viewed or build payload for $label', async ({ otpHeader, message }) => {
    validateExternalAccessGrantMock.mockResolvedValue({
      ok: false,
      kind: 'validation',
      message,
    });

    const response = await GET(makeRequest(otpHeader), {
      params: Promise.resolve({ token: 'token_1' }),
    });

    expect(response.status).toBe(400);
    expect(validateExternalAccessGrantMock).toHaveBeenCalledWith('token_1', otpHeader);
    expect(markExternalAccessViewedMock).not.toHaveBeenCalled();
    expect(buildExternalAccessPayloadMock).not.toHaveBeenCalled();
  });

  it('does not mark viewed or build payload when the grant is rejected', async () => {
    validateExternalAccessGrantMock.mockResolvedValue({
      ok: false,
      kind: 'not_found',
      message: '共有リンクが無効または期限切れです',
    });

    const response = await GET(makeRequest('1234'), {
      params: Promise.resolve({ token: 'token_1' }),
    });

    expect(response.status).toBe(404);
    expect(markExternalAccessViewedMock).not.toHaveBeenCalled();
    expect(buildExternalAccessPayloadMock).not.toHaveBeenCalled();
  });

  it('does not mark viewed when a validated grant cannot build a safe payload', async () => {
    buildExternalAccessPayloadMock.mockResolvedValue(null);

    const response = await GET(makeRequest('1234'), {
      params: Promise.resolve({ token: 'token_1' }),
    });

    expect(response.status).toBe(404);
    expect(buildExternalAccessPayloadMock).toHaveBeenCalledWith({ id: 'grant_1' });
    expect(markExternalAccessViewedMock).not.toHaveBeenCalled();
  });

  it('rate limits OTP attempts by token and client IP', async () => {
    getClientIpMock.mockReturnValue('198.51.100.25');

    await GET(makeRequest('1234'), {
      params: Promise.resolve({ token: 'token_1' }),
    });

    expect(checkAuthRateLimitMock).toHaveBeenCalledWith(
      expectedOtpRateLimitIdentifier('token_1', '198.51.100.25'),
      '/api/external-access/otp',
    );
  });

  it('returns 429 when OTP verification is rate limited', async () => {
    checkAuthRateLimitMock.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
    });

    const response = await GET(makeRequest('1234'), {
      params: Promise.resolve({ token: 'token_1' }),
    });

    expect(response.status).toBe(429);
    expect(validateExternalAccessGrantMock).not.toHaveBeenCalled();
  });
});
