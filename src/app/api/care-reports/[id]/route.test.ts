import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  requireAuthContextMock,
  careReportFindFirstMock,
  careReportUpdateManyMock,
  auditLogCreateMock,
  documentDeliveryRuleFindFirstMock,
  patientFindFirstMock,
  visitRecordFindFirstMock,
  withOrgContextMock,
  findLatestPrescriberInstitutionSuggestionMock,
  findExternalProfessionalSuggestionsMock,
  getChannelStatsByNameMock,
  getRecommendedChannelsMock,
  careCaseFindManyMock,
  canAccessCareReportSourceMock,
  recordPhiReadAuditForRequestMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  careReportFindFirstMock: vi.fn(),
  careReportUpdateManyMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  documentDeliveryRuleFindFirstMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  visitRecordFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  findLatestPrescriberInstitutionSuggestionMock: vi.fn(),
  findExternalProfessionalSuggestionsMock: vi.fn(),
  getChannelStatsByNameMock: vi.fn(),
  getRecommendedChannelsMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  canAccessCareReportSourceMock: vi.fn(),
  recordPhiReadAuditForRequestMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; userId: string; role: string },
      routeContext: { params: Promise<{ id: string }> },
    ) => Promise<Response>,
    options: unknown,
  ) => {
    return async (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) => {
      let response: Response;
      try {
        const authResult = await requireAuthContextMock(req, options);
        response =
          authResult && typeof authResult === 'object' && 'response' in authResult
            ? authResult.response
            : await handler(req, authResult.ctx, routeContext);
      } catch {
        response = new Response(
          JSON.stringify({
            code: 'INTERNAL_ERROR',
            message: 'サーバー内部でエラーが発生しました',
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        );
      }
      response.headers.set('Cache-Control', 'private, no-store, max-age=0');
      response.headers.set('Pragma', 'no-cache');
      response.headers.set('X-Request-Id', '00000000-0000-4000-8000-000000000001');
      response.headers.set(
        'X-Correlation-Id',
        req.headers.get('x-correlation-id') ?? '00000000-0000-4000-8000-000000000001',
      );
      return response;
    };
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    careReport: {
      findFirst: careReportFindFirstMock,
    },
    patient: {
      findFirst: patientFindFirstMock,
    },
    visitRecord: {
      findFirst: visitRecordFindFirstMock,
    },
    documentDeliveryRule: {
      findFirst: documentDeliveryRuleFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/audit/phi-read-audit', () => ({
  recordPhiReadAuditForRequest: recordPhiReadAuditForRequestMock,
}));

vi.mock('@/server/services/care-report-access', () => ({
  canAccessCareReportSource: canAccessCareReportSourceMock,
}));

vi.mock('@/lib/prescriptions/prescriber-institutions', () => ({
  findLatestPrescriberInstitutionSuggestion: findLatestPrescriberInstitutionSuggestionMock,
}));

vi.mock('@/lib/contact-profiles', () => ({
  findExternalProfessionalSuggestions: findExternalProfessionalSuggestionsMock,
  getChannelStatsByName: getChannelStatsByNameMock,
  getRecommendedChannels: getRecommendedChannelsMock,
}));

import { GET } from './route';

const REPORT_UPDATED_AT = new Date('2026-03-30T00:10:00.000Z');
const REPORT_UPDATED_AT_ISO = REPORT_UPDATED_AT.toISOString();

function createRequest(body?: unknown) {
  const effectiveBody =
    body !== undefined &&
    typeof body === 'object' &&
    body !== null &&
    !Array.isArray(body) &&
    !('expected_updated_at' in body)
      ? { expected_updated_at: REPORT_UPDATED_AT_ISO, ...body }
      : body;
  return new NextRequest('http://localhost/api/care-reports/report_1', {
    method: body === undefined ? 'GET' : 'PATCH',
    headers: {
      'x-org-id': 'org_1',
      'x-correlation-id': body === undefined ? 'care_report_get_test' : 'care_report_patch_test',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(effectiveBody) }),
  });
}

describe('care-reports/[id] route', () => {
  const originalTimezone = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = 'Asia/Tokyo';
  });

  afterAll(() => {
    if (originalTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimezone;
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        userId: 'user_1',
        orgId: 'org_1',
        role: 'admin',
      },
    });
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      org_id: 'org_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      visit_record_id: 'visit_record_1',
      report_type: 'physician_report',
      status: 'draft',
      content: { summary: '医師へ共有する本文' },
      template_id: null,
      pdf_url: '/api/files/file_1/download',
      created_by: 'user_1',
      created_at: new Date('2026-03-30T00:00:00.000Z'),
      updated_at: REPORT_UPDATED_AT,
      delivery_records: [],
      case_: {
        required_visit_support: null,
      },
    });
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '山田 太郎',
      name_kana: 'ヤマダ タロウ',
      birth_date: new Date('1940-01-01T00:00:00.000Z'),
      archived_at: null,
    });
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'visit_record_1',
      visit_date: new Date('2026-03-29T09:00:00.000Z'),
    });
    documentDeliveryRuleFindFirstMock.mockResolvedValue(null);
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1', patient_id: 'patient_1' }]);
    canAccessCareReportSourceMock.mockResolvedValue(true);
    careReportUpdateManyMock.mockResolvedValue({ count: 1 });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        careReport: {
          updateMany: careReportUpdateManyMock,
          findFirst: careReportFindFirstMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
        documentDeliveryRule: {
          findFirst: documentDeliveryRuleFindFirstMock,
        },
        patient: {
          findFirst: patientFindFirstMock,
        },
        visitRecord: {
          findFirst: visitRecordFindFirstMock,
        },
        careCase: {
          findMany: careCaseFindManyMock,
        },
      }),
    );
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    findLatestPrescriberInstitutionSuggestionMock.mockResolvedValue({
      id: 'institution_1',
      name: 'みなとクリニック',
      phone: '03-1111-2222',
      fax: '03-1111-3333',
      address: '東京都港区1-1-1',
      prescribed_date: new Date('2026-03-28T00:00:00.000Z'),
      prescriber_name: '田中 一郎',
    });
    findExternalProfessionalSuggestionsMock.mockResolvedValue([]);
    getChannelStatsByNameMock.mockResolvedValue(
      new Map([
        [
          'みなとクリニック',
          {
            fax: { success: 2, failure: 0 },
            phone: { success: 1, failure: 1 },
            email: { success: 0, failure: 0 },
            ses: { success: 0, failure: 0 },
            postal: { success: 0, failure: 0 },
            in_person: { success: 0, failure: 0 },
          },
        ],
      ]),
    );
    getRecommendedChannelsMock.mockReturnValue(['fax', 'phone', 'postal']);
  });

  it('returns report detail with prescriber institution delivery recommendations', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(response.headers.get('X-Request-Id')).toBe('00000000-0000-4000-8000-000000000001');
    expect(response.headers.get('X-Correlation-Id')).toBe('care_report_get_test');
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'admin',
      }),
    });
    expect(findLatestPrescriberInstitutionSuggestionMock).toHaveBeenCalledWith(
      expect.anything(),
      'org_1',
      {
        caseId: 'case_1',
        patientId: 'patient_1',
      },
    );
    expect(getChannelStatsByNameMock).toHaveBeenCalledWith(expect.anything(), 'org_1', [
      'みなとクリニック',
    ]);
    const payload = await response.json();
    expect(payload).toMatchObject({
      data: {
        id: 'report_1',
        patient_summary: {
          id: 'patient_1',
          name: '山田 太郎',
          name_kana: 'ヤマダ タロウ',
          birth_date: '1940-01-01',
          archive: { status: 'active', archived: false, archived_at: null },
        },
        visit_summary: {
          id: 'visit_record_1',
          visit_date: '2026-03-29T09:00:00.000Z',
        },
        permissions: {
          can_edit: true,
          can_send: true,
          can_create_external_share: true,
          can_create_followup_task: true,
          can_view_patient: true,
          can_view_related_requests: true,
        },
        prescriber_institution_suggestion: {
          id: 'institution_1',
          recommended_channels: ['fax', 'phone', 'postal'],
          contact_reliability: {
            ready: true,
            warnings: [],
            missing_channel_labels: [],
          },
          prescribed_date: '2026-03-28T00:00:00.000Z',
        },
      },
    });
    expect(payload.data).not.toHaveProperty('org_id');
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(careReportFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'report_1', org_id: 'org_1' },
        select: expect.objectContaining({
          delivery_records: expect.objectContaining({
            orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
            take: 20,
            select: expect.objectContaining({
              id: true,
              channel: true,
              recipient_name: true,
              recipient_contact: true,
              status: true,
              sent_at: true,
              created_at: true,
            }),
          }),
        }),
      }),
    );
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledTimes(1);
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'admin',
      }),
      {
        patientId: 'patient_1',
        targetType: 'care_report',
        targetId: 'report_1',
        view: 'care_report_detail',
      },
    );
    const serializedAudit = JSON.stringify(recordPhiReadAuditForRequestMock.mock.calls);
    expect(serializedAudit).not.toContain('医師へ共有する本文');
    expect(serializedAudit).not.toContain('山田 太郎');
    expect(serializedAudit).not.toContain('みなとクリニック');
    expect(serializedAudit).not.toContain('03-1111-2222');
    expect(serializedAudit).not.toContain('田中 一郎');
  });

  it('returns minimal archived-patient state in the report patient summary', async () => {
    patientFindFirstMock.mockResolvedValueOnce({
      id: 'patient_archived',
      name: '山田 アーカイブ',
      name_kana: 'ヤマダ アーカイブ',
      birth_date: new Date('1940-01-01T00:00:00.000Z'),
      archived_at: new Date('2026-06-30T09:00:00.000Z'),
      archived_by: 'internal_user',
    });

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const payload = await response.json();
    expect(payload.data.patient_summary).toMatchObject({
      id: 'patient_archived',
      name: '山田 アーカイブ',
      archive: {
        status: 'archived',
        archived: true,
        archived_at: '2026-06-30T09:00:00.000Z',
      },
    });
    expect(JSON.stringify(payload)).not.toContain('archived_by');
    expect(JSON.stringify(payload)).not.toContain('internal_user');
  });

  it('returns a fixed sensitive no-store 500 when scoped report loading fails', async () => {
    withOrgContextMock.mockRejectedValueOnce(
      new Error('raw report detail load patient 山田 太郎 token secret'),
    );

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('raw report detail');
    expect(bodyText).not.toContain('山田 太郎');
    expect(bodyText).not.toContain('token secret');
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('does not audit a report detail that does not exist', async () => {
    careReportFindFirstMock.mockResolvedValueOnce(null);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'missing_report' }),
    });

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(canAccessCareReportSourceMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('does not audit a report detail when source access is forbidden', async () => {
    canAccessCareReportSourceMock.mockResolvedValueOnce(false);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(findLatestPrescriberInstitutionSuggestionMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('does not audit a report detail when enrichment fails', async () => {
    findExternalProfessionalSuggestionsMock.mockRejectedValueOnce(
      new Error('raw report recipient doctor@example.com'),
    );

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain('doctor@example.com');
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when report detail auth context fails', async () => {
    requireAuthContextMock.mockRejectedValueOnce(
      new Error('raw report detail auth patient 山田 太郎 token secret'),
    );

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('raw report detail auth');
    expect(bodyText).not.toContain('山田 太郎');
    expect(bodyText).not.toContain('token secret');
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('does not audit a report detail rejected by authorization', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: new Response(
        JSON.stringify({ code: 'FORBIDDEN', message: '報告書の閲覧権限がありません' }),
        { status: 403 },
      ),
    });

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('returns report action permissions for the current role without widening view access', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      ctx: {
        userId: 'user_clerk',
        orgId: 'org_1',
        role: 'clerk',
      },
    });
    careReportFindFirstMock.mockResolvedValueOnce({
      id: 'report_1',
      org_id: 'org_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      visit_record_id: 'visit_record_1',
      report_type: 'physician_report',
      status: 'confirmed',
      content: {},
      template_id: null,
      pdf_url: null,
      created_by: 'user_1',
      created_at: new Date('2026-03-30T00:00:00.000Z'),
      updated_at: new Date('2026-03-30T00:10:00.000Z'),
      delivery_records: [
        {
          id: 'delivery_1',
          channel: 'email',
          recipient_name: '山田 医師',
          recipient_contact: 'doctor@example.com',
          status: 'sent',
          sent_at: new Date('2026-03-30T01:00:00.000Z'),
          created_at: new Date('2026-03-30T01:00:00.000Z'),
        },
      ],
      case_: {
        required_visit_support: null,
      },
    });

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const payload = await response.json();
    expect(payload).toMatchObject({
      data: {
        id: 'report_1',
        pdf_url: null,
        patient_summary: null,
        visit_summary: null,
        permissions: {
          can_edit: false,
          can_send: false,
          can_create_external_share: false,
          can_create_followup_task: true,
          can_view_patient: false,
          can_view_related_requests: false,
        },
        prescriber_institution_suggestion: null,
        external_professional_suggestions: [],
        delivery_rule_suggestion: null,
        delivery_records: [
          expect.objectContaining({
            id: 'delivery_1',
            recipient_contact: null,
          }),
        ],
      },
    });
    expect(payload.data).not.toHaveProperty('content');
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(findLatestPrescriberInstitutionSuggestionMock).not.toHaveBeenCalled();
    expect(findExternalProfessionalSuggestionsMock).not.toHaveBeenCalled();
    expect(getChannelStatsByNameMock).not.toHaveBeenCalled();
    expect(careCaseFindManyMock).toHaveBeenCalledTimes(1);
    const select = careReportFindFirstMock.mock.calls[0]?.[0]?.select;
    expect(select).toMatchObject({
      content: false,
      pdf_url: true,
    });
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledTimes(1);
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_clerk',
        role: 'clerk',
      }),
      {
        patientId: 'patient_1',
        targetType: 'care_report',
        targetId: 'report_1',
        view: 'care_report_detail',
      },
    );
    const serializedAudit = JSON.stringify(recordPhiReadAuditForRequestMock.mock.calls);
    expect(serializedAudit).not.toContain('山田 医師');
    expect(serializedAudit).not.toContain('doctor@example.com');
  });

  it('returns editable draft content for author-only roles without delivery support fields', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      ctx: {
        userId: 'trainee_1',
        orgId: 'org_1',
        role: 'pharmacist_trainee',
      },
    });

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      data: {
        id: 'report_1',
        content: { summary: '医師へ共有する本文' },
        pdf_url: null,
        permissions: {
          can_edit: true,
          can_send: false,
          can_create_external_share: false,
          can_create_followup_task: true,
        },
        prescriber_institution_suggestion: null,
        external_professional_suggestions: [],
        delivery_rule_suggestion: null,
      },
    });
    expect(findLatestPrescriberInstitutionSuggestionMock).not.toHaveBeenCalled();
    expect(findExternalProfessionalSuggestionsMock).not.toHaveBeenCalled();
    const select = careReportFindFirstMock.mock.calls[0]?.[0]?.select;
    expect(select).toMatchObject({
      content: true,
      pdf_url: true,
    });
    expect(careCaseFindManyMock).toHaveBeenCalledTimes(1);
  });

  it.each(['pharmacist', 'pharmacist_trainee'] as const)(
    'keeps %s report readable but disables follow-up creation for an unassigned patient',
    async (role) => {
      requireAuthContextMock.mockResolvedValueOnce({
        ctx: {
          userId: `${role}_1`,
          orgId: 'org_1',
          role,
        },
      });
      careCaseFindManyMock.mockResolvedValueOnce([]);

      const response = await GET(createRequest(), {
        params: Promise.resolve({ id: 'report_1' }),
      });

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        data: {
          id: 'report_1',
          permissions: {
            can_create_followup_task: false,
          },
        },
      });
      expect(careCaseFindManyMock).toHaveBeenCalledWith({
        where: {
          org_id: 'org_1',
          AND: [
            {
              OR: [
                { primary_pharmacist_id: `${role}_1` },
                { backup_pharmacist_id: `${role}_1` },
                { visit_schedules: { some: { pharmacist_id: `${role}_1` } } },
              ],
            },
          ],
        },
        select: { id: true, patient_id: true },
      });
    },
  );

  it('serializes patient birth date by the local pharmacy calendar day', async () => {
    patientFindFirstMock.mockResolvedValueOnce({
      id: 'patient_1',
      name: '山田 太郎',
      name_kana: 'ヤマダ タロウ',
      birth_date: new Date('1940-01-01T15:30:00.000Z'),
    });

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        patient_summary: {
          birth_date: '1940-01-02',
        },
      },
    });
  });

  it('rejects blank report ids before loading the report', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '報告書IDが不正です',
    });
    expect(careReportFindFirstMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });
});
