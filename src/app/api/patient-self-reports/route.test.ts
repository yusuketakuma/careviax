import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  patientSelfReportFindManyMock,
  patientFindManyMock,
  patientFindFirstMock,
  patientSelfReportCreateMock,
  auditLogCreateMock,
  withOrgContextMock,
  authRoleMock,
} = vi.hoisted(() => ({
  patientSelfReportFindManyMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  patientSelfReportCreateMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  authRoleMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: authRoleMock() });
  },
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
    await expect(response.json()).resolves.toMatchObject({
      data: [],
      hasMore: false,
    });
    expect(patientSelfReportFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid status filter before resolving accessible patients', async () => {
    const response = (await GET(createGetRequest('?status=archived'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(400);
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
        ip_address: undefined,
        user_agent: undefined,
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
    expect(patientSelfReportCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });
});
