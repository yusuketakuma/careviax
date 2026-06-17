import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  careReportFindFirstMock,
  careReportUpdateMock,
  auditLogCreateMock,
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
  careReportUpdateMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
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

function createRequest(body?: unknown) {
  return new NextRequest('http://localhost/api/care-reports/report_1', {
    method: body === undefined ? 'GET' : 'PATCH',
    headers: {
      'x-org-id': 'org_1',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
      content: {},
      template_id: null,
      pdf_url: null,
      created_by: 'user_1',
      created_at: new Date('2026-03-30T00:00:00.000Z'),
      updated_at: new Date('2026-03-30T00:10:00.000Z'),
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
    });
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'visit_record_1',
      visit_date: new Date('2026-03-29T09:00:00.000Z'),
    });
    careReportUpdateMock.mockResolvedValue({
      id: 'report_1',
      status: 'draft',
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        careReport: {
          update: careReportUpdateMock,
        },
        auditLog: {
          create: auditLogCreateMock,
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
        },
        visit_summary: {
          id: 'visit_record_1',
          visit_date: '2026-03-29T09:00:00.000Z',
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
  });

  it('rejects blank report ids before updating the report', async () => {
    const response = await PATCH(createRequest({ content: { summary: '更新後メモ' } }), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '報告書IDが不正です',
    });
    expect(careReportFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careReportUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects non-object request bodies before loading or updating the report', async () => {
    const response = await PATCH(createRequest(['unexpected']), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(careReportFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careReportUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before loading or updating the report', async () => {
    const response = await PATCH(createMalformedPatchRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(careReportFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careReportUpdateMock).not.toHaveBeenCalled();
  });

  it('updates report content through the persisted JSON normalizer', async () => {
    const response = await PATCH(createRequest({ content: { summary: '更新後メモ' } }), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(careReportUpdateMock).toHaveBeenCalledWith({
      where: { id: 'report_1' },
      data: {
        content: { summary: '更新後メモ' },
      },
    });
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
    expect(careReportUpdateMock).toHaveBeenCalledWith({
      where: { id: 'report_1' },
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
    expect(careReportUpdateMock).not.toHaveBeenCalled();
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
    expect(careReportUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects report type changes because content and provenance are generated per type', async () => {
    const response = await PATCH(createRequest({ report_type: 'care_manager_report' }), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expect(careReportUpdateMock).not.toHaveBeenCalled();
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
    careReportUpdateMock.mockResolvedValue({
      id: 'report_1',
      status: 'confirmed',
    });

    const response = await PATCH(createRequest({ status: 'confirmed' }), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(careReportUpdateMock).toHaveBeenCalledWith({
      where: { id: 'report_1' },
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
    expect(careReportUpdateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });
});
