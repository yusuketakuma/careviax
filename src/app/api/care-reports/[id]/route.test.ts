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
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
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

vi.mock('@/lib/prescriptions/prescriber-institutions', () => ({
  findLatestPrescriberInstitutionSuggestion: findLatestPrescriberInstitutionSuggestionMock,
}));

vi.mock('@/lib/contact-profiles', () => ({
  findExternalProfessionalSuggestions: findExternalProfessionalSuggestionsMock,
  getChannelStatsByName: getChannelStatsByNameMock,
  getRecommendedChannels: getRecommendedChannelsMock,
}));

import { GET, PATCH } from './route';

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
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(effectiveBody) }),
  });
}

function createMalformedPatchRequest() {
  return new NextRequest('http://localhost/api/care-reports/report_1', {
    method: 'PATCH',
    headers: {
      'x-org-id': 'org_1',
      'content-type': 'application/json',
    },
    body: '{"content":',
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
          can_create_followup_task: false,
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
    const select = careReportFindFirstMock.mock.calls[0]?.[0]?.select;
    expect(select).toMatchObject({
      content: false,
      pdf_url: true,
    });
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
  });

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
  });

  it('rejects non-draft status updates outside the send workflow', async () => {
    const response = await PATCH(createRequest({ status: 'sent' }), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
  });

  it('requires report author permission before loading or updating the report', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: new Response(
        JSON.stringify({ code: 'FORBIDDEN', message: '報告書の更新権限がありません' }),
        { status: 403 },
      ),
    });

    const response = await PATCH(createRequest({ content: { summary: '更新後メモ' } }), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(careReportFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careReportUpdateManyMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when report update auth context fails', async () => {
    requireAuthContextMock.mockRejectedValueOnce(
      new Error('raw report update auth patient 山田 太郎 token secret'),
    );

    const response = await PATCH(createRequest({ content: { summary: '更新後メモ' } }), {
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
    expect(bodyText).not.toContain('raw report update auth');
    expect(bodyText).not.toContain('山田 太郎');
    expect(bodyText).not.toContain('token secret');
    expect(careReportFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careReportUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects blank report ids before updating the report', async () => {
    const response = await PATCH(createRequest({ content: { summary: '更新後メモ' } }), {
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
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careReportUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects non-object request bodies before loading or updating the report', async () => {
    const response = await PATCH(createRequest(['unexpected']), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(careReportFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careReportUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before loading or updating the report', async () => {
    const response = await PATCH(createMalformedPatchRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(careReportFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careReportUpdateManyMock).not.toHaveBeenCalled();
  });

  it('requires the report version before updating the report', async () => {
    const response = await PATCH(
      createRequest({
        expected_updated_at: undefined,
        content: { summary: '更新後メモ' },
      }),
      {
        params: Promise.resolve({ id: 'report_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        expected_updated_at: expect.any(Array),
      },
    });
    expect(careReportFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careReportUpdateManyMock).not.toHaveBeenCalled();
  });

  it('updates report content through the persisted JSON normalizer', async () => {
    const response = await PATCH(createRequest({ content: { summary: '更新後メモ' } }), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(careReportUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'report_1',
        org_id: 'org_1',
        updated_at: REPORT_UPDATED_AT,
      },
      data: {
        content: { summary: '更新後メモ' },
      },
    });
  });

  it('rejects stale report content updates without changing the report', async () => {
    careReportUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await PATCH(
      createRequest({
        expected_updated_at: '2026-03-30T00:09:00.000Z',
        content: { summary: '更新後メモ' },
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '報告書が同時に更新されました。再読み込みしてください',
    });
    expect(careReportUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          updated_at: new Date('2026-03-30T00:09:00.000Z'),
        }),
      }),
    );
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('preserves server-managed content keys when editing report content', async () => {
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      status: 'draft',
      patient_id: 'patient_1',
      case_id: 'case_1',
      visit_record_id: 'visit_record_1',
      content: {
        billing_context: { billing_evidence_id: 'billing_1' },
        source_provenance: { visit_record_id: 'visit_record_1' },
        report_delivery_targets: [{ delivery_record_id: 'delivery_1' }],
        warnings: ['処方内容が登録されていません。'],
      },
    });

    const response = await PATCH(
      createRequest({
        content: {
          summary: '更新後メモ',
          billing_context: null,
          source_provenance: { forged: true },
          report_delivery_targets: [],
          warnings: [],
        },
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(careReportUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'report_1',
        org_id: 'org_1',
        updated_at: REPORT_UPDATED_AT,
      },
      data: {
        content: {
          summary: '更新後メモ',
          billing_context: { billing_evidence_id: 'billing_1' },
          source_provenance: { visit_record_id: 'visit_record_1' },
          report_delivery_targets: [{ delivery_record_id: 'delivery_1' }],
          warnings: ['処方内容が登録されていません。'],
        },
      },
    });
  });

  it('rejects content edits after pharmacist confirmation', async () => {
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      status: 'confirmed',
      patient_id: 'patient_1',
      case_id: 'case_1',
      visit_record_id: 'visit_record_1',
      content: { summary: '確認済み' },
    });

    const response = await PATCH(createRequest({ content: { summary: '改変' } }), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      message: '薬剤師確認後または送付後の報告書本文はこのAPIから変更できません',
    });
    expect(careReportUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects content edits after legal finalization even if the compatibility status is still draft', async () => {
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      status: 'draft',
      patient_id: 'patient_1',
      case_id: 'case_1',
      visit_record_id: 'visit_record_1',
      content: { summary: '確定済み' },
      finalized_at: new Date('2026-03-30T01:00:00.000Z'),
      locked_at: new Date('2026-03-30T01:00:00.000Z'),
      voided_at: null,
    });

    const response = await PATCH(createRequest({ content: { summary: '改変' } }), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    expect(careReportUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects template changes after the report has been sent', async () => {
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      status: 'sent',
      patient_id: 'patient_1',
      case_id: 'case_1',
      visit_record_id: 'visit_record_1',
      content: { summary: '送付済み' },
    });

    const response = await PATCH(createRequest({ template_id: 'template_2' }), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expect(careReportUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects report type changes because content and provenance are generated per type', async () => {
    const response = await PATCH(createRequest({ report_type: 'care_manager_report' }), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expect(careReportUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects reverting a sent report back to draft', async () => {
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      status: 'sent',
    });

    const response = await PATCH(createRequest({ status: 'draft' }), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
  });

  it('confirms a draft report and writes a pharmacological-judgement audit log', async () => {
    careReportFindFirstMock.mockResolvedValueOnce({
      id: 'report_1',
      org_id: 'org_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      visit_record_id: 'visit_record_1',
      report_type: 'physician_report',
      status: 'draft',
      content: {},
      template_id: null,
      pdf_url: null,
      created_by: 'user_1',
      created_at: new Date('2026-03-30T00:00:00.000Z'),
      updated_at: REPORT_UPDATED_AT,
      delivery_records: [],
      case_: null,
    });
    careReportFindFirstMock.mockResolvedValueOnce({
      id: 'report_1',
      status: 'confirmed',
    });

    const response = await PATCH(createRequest({ status: 'confirmed' }), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(careReportUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'report_1',
        org_id: 'org_1',
        updated_at: REPORT_UPDATED_AT,
      },
      data: {
        status: 'confirmed',
      },
    });
    expect(auditLogCreateMock).toHaveBeenCalledTimes(1);
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'care_report_confirmed',
        target_type: 'care_report',
        target_id: 'report_1',
        changes: { from: 'draft', to: 'confirmed' },
      }),
    });
    await expect(response.json()).resolves.toMatchObject({
      data: { status: 'confirmed' },
    });
  });

  it('rejects pharmacist trainee pharmacological confirmation without changing the report', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      ctx: {
        userId: 'trainee_1',
        orgId: 'org_1',
        role: 'pharmacist_trainee',
      },
    });
    careReportFindFirstMock.mockResolvedValueOnce({
      id: 'report_1',
      org_id: 'org_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      visit_record_id: 'visit_record_1',
      report_type: 'physician_report',
      status: 'draft',
      content: {},
      template_id: null,
      pdf_url: null,
      created_by: 'trainee_1',
      created_at: new Date('2026-03-30T00:00:00.000Z'),
      updated_at: REPORT_UPDATED_AT,
      delivery_records: [],
      case_: null,
      finalized_at: null,
      locked_at: null,
      voided_at: null,
    });

    const response = await PATCH(createRequest({ status: 'confirmed' }), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careReportUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects stale draft confirmation without writing the confirmation audit', async () => {
    careReportUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await PATCH(
      createRequest({
        expected_updated_at: '2026-03-30T00:09:00.000Z',
        status: 'confirmed',
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects confirming a report that is no longer a draft', async () => {
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      status: 'sent',
      patient_id: 'patient_1',
      case_id: 'case_1',
      visit_record_id: 'visit_record_1',
    });

    const response = await PATCH(createRequest({ status: 'confirmed' }), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careReportUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects confirming a legally finalized draft without changing the report', async () => {
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      status: 'draft',
      patient_id: 'patient_1',
      case_id: 'case_1',
      visit_record_id: 'visit_record_1',
      content: {},
      finalized_at: new Date('2026-03-30T01:00:00.000Z'),
      locked_at: new Date('2026-03-30T01:00:00.000Z'),
      voided_at: null,
    });

    const response = await PATCH(createRequest({ status: 'confirmed' }), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careReportUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });
});
