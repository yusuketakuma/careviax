import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';

const VALID_ORG_ID = 'corgabcdefghijklmnopqrstu';

const {
  checkAuthRateLimitMock,
  getClientIpMock,
  validateExternalAccessGrantMock,
  withOrgContextMock,
  patientSelfReportFindFirstMock,
  patientSelfReportCreateMock,
  communicationEventCreateMock,
} = vi.hoisted(() => ({
  checkAuthRateLimitMock: vi.fn(),
  getClientIpMock: vi.fn(),
  validateExternalAccessGrantMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  patientSelfReportFindFirstMock: vi.fn(),
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

function createSelfReportRequest(
  url: string,
  body: unknown,
  otpHeader: string | null = null,
  idempotencyKey?: string,
) {
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(otpHeader === null ? {} : { 'x-otp': otpHeader }),
      ...(idempotencyKey === undefined ? {} : { 'Idempotency-Key': idempotencyKey }),
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
      request_fingerprint: null,
    });
    patientSelfReportFindFirstMock.mockResolvedValue(null);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        patientSelfReport: {
          findFirst: patientSelfReportFindFirstMock,
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
    await expect(response.json()).resolves.toEqual({
      data: {
        accepted: true,
        replayed: false,
      },
    });
    expect(validateExternalAccessGrantMock).toHaveBeenCalledWith('token_1', '1234');
    expect(withOrgContextMock).toHaveBeenCalledWith(VALID_ORG_ID, expect.any(Function));
    expect(patientSelfReportCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idempotency_key_hash: null,
          request_fingerprint: null,
        }),
      }),
    );
    expect(communicationEventCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event_type: 'patient_self_report',
        counterpart_name: null,
        counterpart_contact: null,
        subject: '外部共有ポータルから自己申告を受信',
        content: null,
      }),
    });
  });

  it('stores a hashed idempotency key and PHI-minimal response for keyed self reports', async () => {
    const response = await POST(
      createSelfReportRequest(
        'http://localhost/api/external-access/token_1/self-report',
        {
          reported_by_name: '家族A',
          relation: '長女',
          category: 'adherence',
          subject: '飲み忘れ',
          content: '夕食後を飲み忘れ',
          requested_callback: true,
          preferred_contact_time: '平日18時以降',
        },
        '1234',
        'self-report-submit-1',
      ),
      {
        params: Promise.resolve({ token: 'token_1' }),
      },
    );

    expect(response.status).toBe(201);
    const responseText = await response.text();
    expect(responseText).toBe('{"data":{"accepted":true,"replayed":false}}');
    expect(responseText).not.toContain('patient_1');
    expect(responseText).not.toContain('家族A');
    expect(responseText).not.toContain('飲み忘れ');
    expect(responseText).not.toContain('平日18時以降');

    expect(patientSelfReportFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: VALID_ORG_ID,
        external_access_grant_id: 'grant_1',
        idempotency_key_hash: expect.stringMatching(/^patient-self-report:v1:[a-f0-9]{64}$/),
      },
      select: {
        id: true,
        request_fingerprint: true,
      },
    });
    expect(patientSelfReportCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idempotency_key_hash: expect.stringMatching(/^patient-self-report:v1:[a-f0-9]{64}$/),
          request_fingerprint: expect.stringMatching(
            /^patient-self-report-request:v1:[a-f0-9]{64}$/,
          ),
        }),
      }),
    );
    const createData = patientSelfReportCreateMock.mock.calls[0]?.[0]?.data;
    expect(createData.idempotency_key_hash).not.toContain('self-report-submit-1');
    expect(createData.request_fingerprint).not.toContain('1234');
    expect(createData.request_fingerprint).not.toContain('token_1');
    expect(communicationEventCreateMock.mock.calls[0]?.[0]?.data).toEqual(
      expect.objectContaining({
        counterpart_name: null,
        counterpart_contact: null,
        subject: '外部共有ポータルから自己申告を受信',
        content: null,
      }),
    );
  });

  it('replays the same idempotency key and normalized body without duplicate side effects', async () => {
    patientSelfReportFindFirstMock.mockResolvedValueOnce(null);

    const firstResponse = await POST(
      createSelfReportRequest(
        'http://localhost/api/external-access/token_1/self-report',
        {
          reported_by_name: '家族A',
          category: 'adherence',
          subject: '飲み忘れ',
          content: '夕食後を飲み忘れ',
        },
        '1234',
        'self-report-submit-1',
      ),
      {
        params: Promise.resolve({ token: 'token_1' }),
      },
    );
    expect(firstResponse.status).toBe(201);
    const requestFingerprint = patientSelfReportCreateMock.mock.calls[0]?.[0]?.data
      ?.request_fingerprint as string;

    patientSelfReportFindFirstMock.mockResolvedValueOnce({
      id: 'report_1',
      request_fingerprint: requestFingerprint,
    });

    const replayResponse = await POST(
      createSelfReportRequest(
        'http://localhost/api/external-access/token_1/self-report',
        {
          reported_by_name: '家族A',
          category: 'adherence',
          subject: '飲み忘れ',
          content: '夕食後を飲み忘れ',
        },
        '1234',
        'self-report-submit-1',
      ),
      {
        params: Promise.resolve({ token: 'token_1' }),
      },
    );

    expect(replayResponse.status).toBe(200);
    await expect(replayResponse.json()).resolves.toEqual({
      data: {
        accepted: true,
        replayed: true,
      },
    });
    expect(patientSelfReportCreateMock).toHaveBeenCalledTimes(1);
    expect(communicationEventCreateMock).toHaveBeenCalledTimes(1);
  });

  it('rejects the same idempotency key with a different body without PHI in the conflict body', async () => {
    patientSelfReportFindFirstMock.mockResolvedValueOnce({
      id: 'report_1',
      request_fingerprint: 'patient-self-report-request:v1:different',
    });

    const response = await POST(
      createSelfReportRequest(
        'http://localhost/api/external-access/token_1/self-report',
        {
          reported_by_name: '家族A',
          category: 'adherence',
          subject: '飲み忘れ',
          content: '夕食後を飲み忘れ',
          preferred_contact_time: '平日18時以降',
        },
        '1234',
        'self-report-submit-1',
      ),
      {
        params: Promise.resolve({ token: 'token_1' }),
      },
    );

    expect(response.status).toBe(409);
    const responseText = await response.text();
    expect(responseText).toBe(
      '{"code":"IDEMPOTENCY_CONFLICT","message":"Idempotency-Keyが別の自己申告で使用されています","details":{"reason":"key_reused_with_different_request"}}',
    );
    expect(responseText).not.toContain('家族A');
    expect(responseText).not.toContain('飲み忘れ');
    expect(responseText).not.toContain('平日18時以降');
    expect(responseText).not.toContain('self-report-submit-1');
    expect(patientSelfReportCreateMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
  });

  it('re-reads the race winner after a unique idempotency collision', async () => {
    patientSelfReportFindFirstMock.mockResolvedValueOnce(null);
    patientSelfReportCreateMock.mockImplementationOnce(async (args) => {
      patientSelfReportFindFirstMock.mockResolvedValueOnce({
        id: 'report_1',
        request_fingerprint: args.data.request_fingerprint,
      });
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['org_id', 'external_access_grant_id', 'idempotency_key_hash'] },
      });
    });

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
        'self-report-submit-1',
      ),
      {
        params: Promise.resolve({ token: 'token_1' }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        accepted: true,
        replayed: true,
      },
    });
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed Idempotency-Key values before validating the grant or writing reports', async () => {
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
        'bad key with spaces',
      ),
      {
        params: Promise.resolve({ token: 'token_1' }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Idempotency-Keyが不正です',
    });
    expect(validateExternalAccessGrantMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
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
