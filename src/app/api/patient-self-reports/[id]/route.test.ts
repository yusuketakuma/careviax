import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  patientSelfReportFindFirstMock,
  patientSelfReportTxFindFirstMock,
  patientSelfReportUpdateManyMock,
  patientSelfReportFindUniqueMock,
  patientFindFirstMock,
  patientTxFindFirstMock,
  patientSelfReportUpdateMock,
  auditLogCreateMock,
  withOrgContextMock,
  authRoleMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  patientSelfReportFindFirstMock: vi.fn(),
  patientSelfReportTxFindFirstMock: vi.fn(),
  patientSelfReportUpdateManyMock: vi.fn(),
  patientSelfReportFindUniqueMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  patientTxFindFirstMock: vi.fn(),
  patientSelfReportUpdateMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  authRoleMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: authRoleMock() }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patientSelfReport: {
      findFirst: patientSelfReportFindFirstMock,
    },
    patient: {
      findFirst: patientFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, PATCH } from './route';

const CURRENT_UPDATED_AT = '2026-03-28T00:00:00.000Z';
const STALE_UPDATED_AT = '2026-03-27T00:00:00.000Z';

function createGetRequest(reportId: string) {
  return new NextRequest(`http://localhost/api/patient-self-reports/${reportId}`);
}

function createPatchRequest(reportId: string, body: unknown) {
  return new NextRequest(`http://localhost/api/patient-self-reports/${reportId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonPatchRequest(reportId: string) {
  return new NextRequest(`http://localhost/api/patient-self-reports/${reportId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: '{"status":',
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

function mockSelfReportDetail() {
  patientSelfReportFindFirstMock
    .mockResolvedValueOnce({
      id: 'report_1',
      patient_id: 'patient_1',
    })
    .mockResolvedValueOnce({
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
      updated_at: new Date('2026-03-28T01:00:00.000Z'),
    });
}

function buildSelfReportResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'report_1',
    patient_id: 'patient_1',
    reported_by_name: '家族A',
    relation: 'child',
    category: 'adherence',
    subject: '飲み忘れ',
    content: '夕食後を飲み忘れ',
    requested_callback: true,
    preferred_contact_time: '18時以降',
    status: 'resolved',
    triaged_by: 'user_1',
    triaged_at: new Date('2026-03-28T00:00:00.000Z'),
    created_at: new Date('2026-03-28T00:00:00.000Z'),
    updated_at: new Date('2026-03-28T01:00:00.000Z'),
    ...overrides,
  };
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

describe('/api/patient-self-reports/[id] PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRoleMock.mockReturnValue('pharmacist');
    patientSelfReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      patient_id: 'patient_1',
      triaged_at: null,
      updated_at: new Date('2026-03-28T00:00:00.000Z'),
    });
    patientSelfReportTxFindFirstMock.mockResolvedValue({
      id: 'report_1',
      patient_id: 'patient_1',
      status: 'submitted',
      requested_callback: true,
      triaged_at: null,
      updated_at: new Date('2026-03-28T00:00:00.000Z'),
    });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    patientTxFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    requireAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' },
    });
    patientSelfReportUpdateMock.mockResolvedValue({ id: 'report_1', status: 'resolved' });
    patientSelfReportUpdateManyMock.mockResolvedValue({ count: 1 });
    patientSelfReportFindUniqueMock.mockResolvedValue(buildSelfReportResponse());
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        patientSelfReport: {
          findFirst: patientSelfReportTxFindFirstMock,
          updateMany: patientSelfReportUpdateManyMock,
          findUnique: patientSelfReportFindUniqueMock,
          update: patientSelfReportUpdateMock,
        },
        patient: {
          findFirst: patientTxFindFirstMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('stamps triage metadata when moving out of submitted', async () => {
    const response = (await PATCH(
      createPatchRequest('report_1', {
        status: 'resolved',
        updated_at: CURRENT_UPDATED_AT,
      }),
      {
        params: Promise.resolve({ id: 'report_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(patientSelfReportTxFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'report_1',
        org_id: 'org_1',
        updated_at: new Date('2026-03-28T00:00:00.000Z'),
      },
      select: {
        id: true,
        patient_id: true,
        status: true,
        requested_callback: true,
        triaged_at: true,
        updated_at: true,
      },
    });
    expect(patientTxFindFirstMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'patient_1',
        org_id: 'org_1',
      }),
      select: { id: true },
    });
    expect(patientSelfReportUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'report_1',
        org_id: 'org_1',
        updated_at: new Date('2026-03-28T00:00:00.000Z'),
      },
      data: expect.objectContaining({
        status: 'resolved',
        triaged_by: 'user_1',
      }),
    });
    expect(patientSelfReportUpdateManyMock.mock.calls[0]?.[0].data).not.toHaveProperty(
      'updated_at',
    );
    expect(patientSelfReportFindUniqueMock).toHaveBeenCalledWith({
      where: { id: 'report_1' },
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
        action: 'patient_self_report_updated',
        target_type: 'patient_self_report',
        target_id: 'report_1',
        changes: {
          patient_id: 'patient_1',
          changed_fields: ['status'],
          status_before: 'submitted',
          status_after: 'resolved',
          requested_callback_before: true,
          requested_callback_after: true,
          triage_stamped: true,
        },
        ip_address: undefined,
        user_agent: undefined,
      },
    });
    expectNoRawSelfReportAuditFields(
      auditLogCreateMock.mock.calls[0]?.[0].data.changes as Record<string, unknown>,
    );
    expect(patientSelfReportUpdateMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: expect.objectContaining({
        reported_by_name: '家族A',
        content: '夕食後を飲み忘れ',
        preferred_contact_time: '18時以降',
        sensitive_fields_masked: false,
      }),
    });
  });

  it('rejects non-object patch payloads before loading the self report', async () => {
    const response = (await PATCH(createPatchRequest('report_1', ['resolved']), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(patientSelfReportFindFirstMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientSelfReportUpdateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON patch payloads before loading the self report', async () => {
    const response = (await PATCH(createMalformedJsonPatchRequest('report_1'), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(patientSelfReportFindFirstMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientSelfReportUpdateManyMock).not.toHaveBeenCalled();
    expect(patientSelfReportUpdateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects missing version timestamps before loading the self report', async () => {
    const response = (await PATCH(createPatchRequest('report_1', { status: 'resolved' }), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        updated_at: expect.any(Array),
      },
    });
    expect(patientSelfReportFindFirstMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientSelfReportUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects no-op patch payloads before loading the self report', async () => {
    const response = (await PATCH(
      createPatchRequest('report_1', {
        updated_at: CURRENT_UPDATED_AT,
      }),
      {
        params: Promise.resolve({ id: 'report_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '更新する項目を指定してください',
      details: {
        body: ['更新する項目を指定してください'],
      },
    });
    expect(patientSelfReportFindFirstMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientSelfReportUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects invalid version timestamps before loading the self report', async () => {
    const response = (await PATCH(
      createPatchRequest('report_1', {
        status: 'resolved',
        updated_at: 'not-a-date',
      }),
      {
        params: Promise.resolve({ id: 'report_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        updated_at: ['updated_at の日時形式が不正です'],
      },
    });
    expect(patientSelfReportFindFirstMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientSelfReportUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects blank self report ids before loading detail', async () => {
    const response = await GET(createGetRequest('report_1'), {
      params: Promise.resolve({ id: '   ' }),
    });

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者自己申告IDが不正です',
    });
    expect(patientSelfReportFindFirstMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientSelfReportUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when self report detail lookup fails unexpectedly', async () => {
    patientSelfReportFindFirstMock.mockRejectedValueOnce(
      new Error('raw self report detail secret'),
    );

    const response = await GET(createGetRequest('report_1'), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const bodyText = await response.text();
    expect(bodyText).toContain('INTERNAL_ERROR');
    expect(bodyText).not.toContain('raw self report detail secret');
  });

  it('rejects blank self report ids before parsing or updating', async () => {
    const response = (await PATCH(createMalformedJsonPatchRequest('report_1'), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者自己申告IDが不正です',
    });
    expect(patientSelfReportFindFirstMock).not.toHaveBeenCalled();
    expect(patientSelfReportTxFindFirstMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(patientTxFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientSelfReportUpdateManyMock).not.toHaveBeenCalled();
    expect(patientSelfReportFindUniqueMock).not.toHaveBeenCalled();
    expect(patientSelfReportUpdateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('does not return detail for an unassigned self report', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = await GET(createGetRequest('report_1'), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_NOT_FOUND',
    });
    expect(patientSelfReportFindFirstMock).toHaveBeenCalledTimes(1);
    expect(patientSelfReportUpdateMock).not.toHaveBeenCalled();
  });

  it('returns unmasked detail for pharmacist users', async () => {
    mockSelfReportDetail();

    const response = await GET(createGetRequest('report_1'), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: expect.objectContaining({
        reported_by_name: '家族A',
        relation: 'child',
        category: 'adherence',
        subject: '飲み忘れ',
        content: '夕食後を飲み忘れ',
        preferred_contact_time: '18時以降',
        sensitive_fields_masked: false,
      }),
    });
  });

  it('masks sensitive self report detail fields for clerk users', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      ctx: { orgId: 'org_1', userId: 'user_1', role: 'clerk' },
    });
    mockSelfReportDetail();

    const response = await GET(createGetRequest('report_1'), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    expect(response.status).toBe(200);
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

  it('does not update an unassigned self report', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = (await PATCH(
      createPatchRequest('report_1', {
        status: 'resolved',
        updated_at: CURRENT_UPDATED_AT,
      }),
      {
        params: Promise.resolve({ id: 'report_1' }),
      },
    ))!;

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(patientSelfReportUpdateMock).not.toHaveBeenCalled();
    expect(patientSelfReportUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('masks sensitive self report fields in patch responses for clerk users', async () => {
    authRoleMock.mockReturnValue('clerk');

    const response = (await PATCH(
      createPatchRequest('report_1', {
        status: 'resolved',
        updated_at: CURRENT_UPDATED_AT,
      }),
      {
        params: Promise.resolve({ id: 'report_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
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

  it('returns conflict without updating when the report changed after loading', async () => {
    patientSelfReportTxFindFirstMock.mockResolvedValueOnce(null);

    const response = (await PATCH(
      createPatchRequest('report_1', {
        status: 'resolved',
        updated_at: STALE_UPDATED_AT,
      }),
      {
        params: Promise.resolve({ id: 'report_1' }),
      },
    ))!;

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message:
        '患者自己申告が他のユーザーによって更新されています。最新のデータを取得してください。',
    });
    expect(patientTxFindFirstMock).not.toHaveBeenCalled();
    expect(patientSelfReportUpdateManyMock).not.toHaveBeenCalled();
    expect(patientSelfReportFindUniqueMock).not.toHaveBeenCalled();
    expect(patientSelfReportUpdateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(patientSelfReportTxFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'report_1',
        org_id: 'org_1',
        updated_at: new Date(STALE_UPDATED_AT),
      },
      select: {
        id: true,
        patient_id: true,
        status: true,
        requested_callback: true,
        triaged_at: true,
        updated_at: true,
      },
    });
  });

  it('returns conflict without updating when assignment changes after loading', async () => {
    patientTxFindFirstMock.mockResolvedValueOnce(null);

    const response = (await PATCH(
      createPatchRequest('report_1', {
        status: 'resolved',
        updated_at: CURRENT_UPDATED_AT,
      }),
      {
        params: Promise.resolve({ id: 'report_1' }),
      },
    ))!;

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message:
        '患者自己申告が他のユーザーによって更新されています。最新のデータを取得してください。',
    });
    expect(patientSelfReportUpdateManyMock).not.toHaveBeenCalled();
    expect(patientSelfReportFindUniqueMock).not.toHaveBeenCalled();
    expect(patientSelfReportUpdateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns conflict without returning a stale row when the guarded update loses the race', async () => {
    patientSelfReportUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = (await PATCH(
      createPatchRequest('report_1', {
        status: 'resolved',
        updated_at: CURRENT_UPDATED_AT,
      }),
      {
        params: Promise.resolve({ id: 'report_1' }),
      },
    ))!;

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message:
        '患者自己申告が他のユーザーによって更新されています。最新のデータを取得してください。',
    });
    expect(patientSelfReportFindUniqueMock).not.toHaveBeenCalled();
    expect(patientSelfReportUpdateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });
});
