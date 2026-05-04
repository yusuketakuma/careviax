import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  checkAuthRateLimitMock,
  validateExternalAccessGrantMock,
  transactionMock,
  patientSelfReportCreateMock,
  communicationEventCreateMock,
} = vi.hoisted(() => ({
  checkAuthRateLimitMock: vi.fn(),
  validateExternalAccessGrantMock: vi.fn(),
  transactionMock: vi.fn(),
  patientSelfReportCreateMock: vi.fn(),
  communicationEventCreateMock: vi.fn(),
}));

vi.mock('@/lib/api/rate-limit', () => ({
  checkAuthRateLimit: checkAuthRateLimitMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    $transaction: transactionMock,
  },
}));

vi.mock('@/server/services/external-access', () => ({
  validateExternalAccessGrant: validateExternalAccessGrantMock,
}));

import { POST } from './route';

function createSelfReportRequest(url: string, body: unknown, otpHeader: string | null = null) {
  return {
    nextUrl: new URL(url),
    headers: { get: (key: string) => (key === 'x-otp' ? otpHeader : null) },
    json: async () => body,
  } as unknown as NextRequest;
}

describe('/api/external-access/[token]/self-report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkAuthRateLimitMock.mockResolvedValue({
      allowed: true,
      remaining: 4,
      resetAt: Date.now() + 60_000,
    });
    validateExternalAccessGrantMock.mockResolvedValue({
      ok: true,
      grant: {
        id: 'grant_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
      },
    });
    patientSelfReportCreateMock.mockResolvedValue({
      id: 'report_1',
      patient_id: 'patient_1',
      status: 'triaged',
      created_at: new Date('2026-03-29T00:00:00.000Z'),
    });
    transactionMock.mockImplementation(async (callback) =>
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
    expect(patientSelfReportCreateMock).toHaveBeenCalled();
    expect(communicationEventCreateMock).toHaveBeenCalled();
  });

  it('rejects OTP supplied in the request body (header-only design)', async () => {
    validateExternalAccessGrantMock.mockResolvedValue({
      ok: false,
      kind: 'validation',
      message: 'OTPが必要です',
    });

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
    expect(validateExternalAccessGrantMock).toHaveBeenCalledWith('token_1', undefined);
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
