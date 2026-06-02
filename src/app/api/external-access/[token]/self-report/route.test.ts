import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const VALID_ORG_ID = 'corgabcdefghijklmnopqrstu';

const {
  checkAuthRateLimitMock,
  getClientIpMock,
  validateExternalAccessGrantMock,
  withOrgContextMock,
  patientSelfReportCreateMock,
  communicationEventCreateMock,
} = vi.hoisted(() => ({
  checkAuthRateLimitMock: vi.fn(),
  getClientIpMock: vi.fn(),
  validateExternalAccessGrantMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  patientSelfReportCreateMock: vi.fn(),
  communicationEventCreateMock: vi.fn(),
}));

vi.mock('@/lib/api/rate-limit', () => ({
  checkAuthRateLimit: checkAuthRateLimitMock,
}));

vi.mock('@/lib/api/request-ip', () => ({
  getClientIp: getClientIpMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/external-access', () => ({
  validateExternalAccessGrant: validateExternalAccessGrantMock,
}));

import { POST } from './route';

function createSelfReportRequest(url: string, body: unknown, otpHeader: string | null = null) {
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(otpHeader === null ? {} : { 'x-otp': otpHeader }),
    },
    body: JSON.stringify(body),
  });
}

function createMalformedSelfReportRequest(url: string, otpHeader: string | null = null) {
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(otpHeader === null ? {} : { 'x-otp': otpHeader }),
    },
    body: '{"reported_by_name":',
  });
}

describe('/api/external-access/[token]/self-report', () => {
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
      grant: {
        id: 'grant_1',
        org_id: VALID_ORG_ID,
        patient_id: 'patient_1',
      },
    });
    patientSelfReportCreateMock.mockResolvedValue({
      id: 'report_1',
      patient_id: 'patient_1',
      status: 'triaged',
      created_at: new Date('2026-03-29T00:00:00.000Z'),
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        patientSelfReport: {
          create: patientSelfReportCreateMock,
        },
        communicationEvent: {
          create: communicationEventCreateMock,
        },
      }),
    );
  });

  it('creates a self report and communication event for valid external access', async () => {
    const response = await POST(
      createSelfReportRequest(
        'http://localhost/api/external-access/token_1/self-report',
        {
          reported_by_name: '家族A',
          category: 'adherence',
          subject: '飲み忘れ',
          content: '夕食後を飲み忘れ',
        },
        '1234',
      ),
      {
        params: Promise.resolve({ token: 'token_1' }),
      },
    );

    expect(response.status).toBe(201);
    expect(validateExternalAccessGrantMock).toHaveBeenCalledWith('token_1', '1234');
    expect(withOrgContextMock).toHaveBeenCalledWith(VALID_ORG_ID, expect.any(Function));
    expect(patientSelfReportCreateMock).toHaveBeenCalled();
    expect(communicationEventCreateMock).toHaveBeenCalled();
  });

  it('rejects blank tokens before rate limiting, parsing, or validating the grant', async () => {
    const response = await POST(
      createMalformedSelfReportRequest(
        'http://localhost/api/external-access/%20%20/self-report',
        '1234',
      ),
      {
        params: Promise.resolve({ token: '\t\n' }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '共有リンクトークンが不正です',
    });
    expect(getClientIpMock).not.toHaveBeenCalled();
    expect(checkAuthRateLimitMock).not.toHaveBeenCalled();
    expect(validateExternalAccessGrantMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientSelfReportCreateMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
  });

  it('rejects OTP supplied in the request body (header-only design)', async () => {
    const response = await POST(
      createSelfReportRequest('http://localhost/api/external-access/token_1/self-report', {
        otp: '1234',
        reported_by_name: '家族A',
        category: 'adherence',
        subject: '飲み忘れ',
        content: '夕食後を飲み忘れ',
      }),
      {
        params: Promise.resolve({ token: 'token_1' }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'OTPはリクエストボディではなくヘッダーで送信してください',
    });
    expect(checkAuthRateLimitMock).toHaveBeenCalledTimes(1);
    expect(validateExternalAccessGrantMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientSelfReportCreateMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
  });

  it('rejects body OTP even when a valid OTP header is present', async () => {
    const response = await POST(
      createSelfReportRequest(
        'http://localhost/api/external-access/token_1/self-report',
        {
          otp: '1234',
          reported_by_name: '家族A',
          category: 'adherence',
          subject: '飲み忘れ',
          content: '夕食後を飲み忘れ',
        },
        '1234',
      ),
      {
        params: Promise.resolve({ token: 'token_1' }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'OTPはリクエストボディではなくヘッダーで送信してください',
    });
    expect(checkAuthRateLimitMock).toHaveBeenCalledTimes(1);
    expect(validateExternalAccessGrantMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientSelfReportCreateMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
  });

  it('rejects non-object payloads before validating the external grant', async () => {
    const response = await POST(
      createSelfReportRequest('http://localhost/api/external-access/token_1/self-report', [
        'invalid',
      ]),
      {
        params: Promise.resolve({ token: 'token_1' }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(checkAuthRateLimitMock).toHaveBeenCalledTimes(1);
    expect(validateExternalAccessGrantMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientSelfReportCreateMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before validating the external grant or writing reports', async () => {
    const response = await POST(
      createMalformedSelfReportRequest(
        'http://localhost/api/external-access/token_1/self-report',
        '1234',
      ),
      {
        params: Promise.resolve({ token: 'token_1' }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(checkAuthRateLimitMock).toHaveBeenCalledTimes(1);
    expect(validateExternalAccessGrantMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientSelfReportCreateMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
  });

  it('does not accept OTP from the query string', async () => {
    validateExternalAccessGrantMock.mockResolvedValue({
      ok: false,
      kind: 'validation',
      message: 'OTPが必要です',
    });

    const response = await POST(
      createSelfReportRequest('http://localhost/api/external-access/token_1/self-report?otp=1234', {
        reported_by_name: '家族A',
        category: 'adherence',
        subject: '飲み忘れ',
        content: '夕食後を飲み忘れ',
      }),
      {
        params: Promise.resolve({ token: 'token_1' }),
      },
    );

    expect(response.status).toBe(400);
    expect(validateExternalAccessGrantMock).toHaveBeenCalledWith('token_1', undefined);
  });

  it('returns 429 when self-report OTP attempts are rate limited', async () => {
    checkAuthRateLimitMock.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
    });

    const response = await POST(
      createSelfReportRequest('http://localhost/api/external-access/token_1/self-report', {
        reported_by_name: '家族A',
        category: 'adherence',
        subject: '飲み忘れ',
        content: '夕食後を飲み忘れ',
      }),
      {
        params: Promise.resolve({ token: 'token_1' }),
      },
    );

    expect(response.status).toBe(429);
    expect(validateExternalAccessGrantMock).not.toHaveBeenCalled();
  });
});
