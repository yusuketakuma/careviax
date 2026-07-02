import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  loggerErrorMock,
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  withRoutePerformanceMock,
  patientSelfReportFindManyMock,
  patientFindManyMock,
  patientFindFirstMock,
  patientSelfReportCreateMock,
  auditLogCreateMock,
  withOrgContextMock,
  authRoleMock,
} = vi.hoisted(() => ({
  loggerErrorMock: vi.fn(),
  requireAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback: () => unknown) => callback()),
  withRoutePerformanceMock: vi.fn((_req, callback: () => unknown) => callback()),
  patientSelfReportFindManyMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  patientSelfReportCreateMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  authRoleMock: vi.fn(),
}));

function buildAuthContext() {
  return {
    orgId: 'org_1',
    userId: 'user_1',
    role: authRoleMock(),
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
  };
}

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/auth/request-context', () => ({
  runWithRequestAuthContext: runWithRequestAuthContextMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

vi.mock('@/lib/utils/performance', () => ({
  withRoutePerformance: withRoutePerformanceMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patientSelfReport: {
      findMany: patientSelfReportFindManyMock,
    },
    patient: {
      findMany: patientFindManyMock,
      findFirst: patientFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

function createGetRequest(search = '') {
  return new NextRequest(`http://localhost/api/patient-self-reports${search}`);
}

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/patient-self-reports', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonPostRequest() {
  return new NextRequest('http://localhost/api/patient-self-reports', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"patient_id":',
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

function expectNoRawSelfReportAuditFields(changes: Record<string, unknown>) {
  for (const field of [
    'reported_by_name',
    'relation',
    'category',
    'subject',
    'content',
    'preferred_contact_time',
  ]) {
    expect(changes).not.toHaveProperty(field);
  }
}

describe('/api/patient-self-reports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRoleMock.mockReturnValue('pharmacist');
    requireAuthContextMock.mockImplementation(async () => ({ ctx: buildAuthContext() }));
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    withRoutePerformanceMock.mockImplementation((_req, callback) => callback());
    patientSelfReportFindManyMock.mockResolvedValue([
      {
        id: 'report_1',
        patient_id: 'patient_1',
        reported_by_name: '家族A',
        relation: 'child',
        category: 'adherence',
        subject: '飲み忘れ',
        content: '夕食後を飲み忘れ',
        requested_callback: true,
        preferred_contact_time: '18時以降',
        status: 'triaged',
        triaged_by: 'user_1',
        triaged_at: new Date('2026-03-28T00:00:00.000Z'),
        created_at: new Date('2026-03-28T00:00:00.000Z'),
        updated_at: new Date('2026-03-28T00:00:00.000Z'),
      },
    ]);
    patientFindManyMock.mockResolvedValue([
      {
        id: 'patient_1',
        name: '患者A',
        name_kana: 'カンジャエー',
      },
    ]);
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
    });
    patientSelfReportCreateMock.mockResolvedValue({
      id: 'report_2',
      patient_id: 'patient_1',
      reported_by_name: '家族B',
      relation: 'spouse',
      category: 'adherence',
      subject: '飲み忘れ',
      content: '朝食後を飲み忘れ',
      requested_callback: false,
      preferred_contact_time: null,
      status: 'triaged',
      triaged_by: 'user_1',
      triaged_at: new Date('2026-03-29T00:00:00.000Z'),
      created_at: new Date('2026-03-29T00:00:00.000Z'),
      updated_at: new Date('2026-03-29T00:00:00.000Z'),
    });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        patientSelfReport: {
          create: patientSelfReportCreateMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('lists self reports with patient display names', async () => {
    const response = (await GET(createGetRequest('?patient_id=%20patient_1%20&status=triaged'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(withRoutePerformanceMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.any(Function),
    );
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canReport',
      message: '患者自己申告の閲覧権限がありません',
    });
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }),
      expect.any(Function),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          id: 'report_1',
          patient_name: '患者A',
          patient_name_kana: 'カンジャエー',
          reported_by_name: '家族A',
          relation: 'child',
          category: 'adherence',
          subject: '飲み忘れ',
          content: '夕食後を飲み忘れ',
          preferred_contact_time: '18時以降',
          sensitive_fields_masked: false,
          updated_at: '2026-03-28T00:00:00.000Z',
        }),
      ],
    });
    expect(patientSelfReportFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'patient_1',
        }),
      }),
    );
  });

  it('masks sensitive self report fields for clerk list responses', async () => {
    authRoleMock.mockReturnValue('clerk');

    const response = (await GET(createGetRequest('?status=triaged'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          id: 'report_1',
          patient_name: null,
          patient_name_kana: null,
          reported_by_name: null,
          relation: null,
          category: '非表示',
          subject: '自己申告内容は非表示',
          content: null,
          preferred_contact_time: null,
          sensitive_fields_masked: true,
        }),
      ],
    });
  });

  it('returns no reports when the requested patient is outside assignment scope', async () => {
    patientFindManyMock.mockResolvedValue([]);

    const response = (await GET(createGetRequest('?patient_id=patient_unassigned'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: [],
      hasMore: false,
    });
    expect(patientSelfReportFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when self report listing fails unexpectedly', async () => {
    const err = new Error('raw self report secret');
    err.name = 'PatientSelfReportSecretError';
    patientSelfReportFindManyMock.mockRejectedValueOnce(err);

    const response = (await GET(createGetRequest(), { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const bodyText = await response.text();
    expect(bodyText).toContain('INTERNAL_ERROR');
    expect(bodyText).not.toContain('raw self report secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'patient_self_reports_get_unhandled_error',
        route: '/api/patient-self-reports',
        method: 'GET',
        status: 500,
      }),
      err,
    );
    const [logContext, logError] = loggerErrorMock.mock.calls[0] ?? [];
    expect(logError).toBe(err);
    expect(logContext).not.toHaveProperty('error_name');
    const logContextText = JSON.stringify(logContext);
    expect(logContextText).not.toContain('raw self report secret');
    expect(logContextText).not.toContain('PatientSelfReportSecretError');
  });

  it.each([
    ['patient_id', '?patient_id=', { patient_id: ['患者IDを指定してください'] }],
    ['blank patient_id', '?patient_id=%20%20', { patient_id: ['患者IDを指定してください'] }],
    ['status', '?status=', { status: ['ステータスを指定してください'] }],
    ['blank status', '?status=%20%20', { status: ['ステータスを指定してください'] }],
  ])(
    'rejects explicitly empty %s filters before resolving accessible patients',
    async (_label, query, details) => {
      const response = (await GET(createGetRequest(query), {
        params: Promise.resolve({}),
      }))!;

      expect(response.status).toBe(400);
      expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '検索条件が不正です',
        details,
      });
      expect(patientFindManyMock).not.toHaveBeenCalled();
      expect(patientSelfReportFindManyMock).not.toHaveBeenCalled();
    },
  );

  it('rejects an invalid status filter before resolving accessible patients', async () => {
    const response = (await GET(createGetRequest('?status=archived'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        status: ['対応していないステータスです'],
      },
    });
    expect(patientFindManyMock).not.toHaveBeenCalled();
    expect(patientSelfReportFindManyMock).not.toHaveBeenCalled();
  });

  it('creates a triaged self report', async () => {
    const response = (await POST(
      createPostRequest({
        patient_id: ' patient_1 ',
        reported_by_name: ' 家族B ',
        relation: ' ',
        category: ' adherence ',
        subject: ' 飲み忘れ ',
        content: ' 朝食後を飲み忘れ ',
        preferred_contact_time: '\t',
      }),
      { params: Promise.resolve({}) },
    ))!;

    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    expect(withRoutePerformanceMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.any(Function),
    );
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canReport',
      message: '患者自己申告の登録権限がありません',
    });
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }),
      expect.any(Function),
    );
    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'patient_1',
        org_id: 'org_1',
      }),
      select: { id: true },
    });
    expect(patientSelfReportCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        patient_id: 'patient_1',
        reported_by_name: '家族B',
        relation: null,
        category: 'adherence',
        subject: '飲み忘れ',
        content: '朝食後を飲み忘れ',
        preferred_contact_time: null,
        triaged_by: 'user_1',
        status: 'triaged',
      }),
      select: expect.objectContaining({
        reported_by_name: true,
        content: true,
        preferred_contact_time: true,
      }),
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        actor_id: 'user_1',
        actor_pharmacy_id: 'org_1',
        actor_site_id: undefined,
        patient_id: undefined,
        action: 'patient_self_report_created',
        target_type: 'patient_self_report',
        target_id: 'report_2',
        changes: {
          patient_id: 'patient_1',
          status_after: 'triaged',
          requested_callback: false,
          relation_provided: false,
          preferred_contact_time_provided: false,
        },
        ip_address: '127.0.0.1',
        user_agent: 'vitest',
      },
    });
    expectNoRawSelfReportAuditFields(
      auditLogCreateMock.mock.calls[0]?.[0].data.changes as Record<string, unknown>,
    );
    await expect(response.json()).resolves.toMatchObject({
      data: expect.objectContaining({
        reported_by_name: '家族B',
        relation: 'spouse',
        category: 'adherence',
        subject: '飲み忘れ',
        content: '朝食後を飲み忘れ',
        preferred_contact_time: null,
        sensitive_fields_masked: false,
      }),
    });
  });

  it('masks sensitive self report fields for clerk create responses', async () => {
    authRoleMock.mockReturnValue('clerk');

    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        reported_by_name: '家族B',
        relation: 'spouse',
        category: 'adherence',
        subject: '飲み忘れ',
        content: '朝食後を飲み忘れ',
        preferred_contact_time: '18時以降',
      }),
      { params: Promise.resolve({}) },
    ))!;

    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: expect.objectContaining({
        reported_by_name: null,
        relation: null,
        category: '非表示',
        subject: '自己申告内容は非表示',
        content: null,
        preferred_contact_time: null,
        sensitive_fields_masked: true,
      }),
    });
  });

  it('rejects non-object create payloads before resolving patient access', async () => {
    const response = (await POST(createPostRequest(['patient_1']), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientSelfReportCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before resolving patient access', async () => {
    const response = (await POST(createMalformedJsonPostRequest(), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientSelfReportCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects blank patient ids before resolving patient access or creating a report', async () => {
    const response = (await POST(
      createPostRequest({
        patient_id: '   ',
        reported_by_name: '家族B',
        category: 'adherence',
        subject: '飲み忘れ',
        content: '朝食後を飲み忘れ',
      }),
      { params: Promise.resolve({}) },
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        patient_id: ['患者IDは必須です'],
      },
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientSelfReportCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('does not create a self report for an unassigned patient', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_unassigned',
        reported_by_name: '家族B',
        category: 'adherence',
        subject: '飲み忘れ',
        content: '朝食後を飲み忘れ',
      }),
      { params: Promise.resolve({}) },
    ))!;

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(patientSelfReportCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 without raw logging when self report creation fails', async () => {
    const err = new Error('raw self report create secret');
    err.name = 'PatientSelfReportCreateSecretError';
    withOrgContextMock.mockRejectedValueOnce(err);

    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        reported_by_name: '家族B',
        category: 'adherence',
        subject: '飲み忘れ',
        content: '朝食後を飲み忘れ',
      }),
      { params: Promise.resolve({}) },
    ))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const bodyText = await response.text();
    expect(bodyText).toContain('INTERNAL_ERROR');
    expect(bodyText).not.toContain('raw self report create secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'patient_self_reports_post_unhandled_error',
        route: '/api/patient-self-reports',
        method: 'POST',
        status: 500,
      }),
      err,
    );
    const [logContext, logError] = loggerErrorMock.mock.calls[0] ?? [];
    expect(logError).toBe(err);
    expect(logContext).not.toHaveProperty('error_name');
    const logContextText = JSON.stringify(logContext);
    expect(logContextText).not.toContain('raw self report create secret');
    expect(logContextText).not.toContain('PatientSelfReportCreateSecretError');
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });
});
