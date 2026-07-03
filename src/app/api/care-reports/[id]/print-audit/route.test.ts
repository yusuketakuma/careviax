import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  requireAuthContextMock,
  careReportFindFirstMock,
  recordCareReportPrintAuditMock,
  canAccessCareReportSourceMock,
  prismaMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  careReportFindFirstMock: vi.fn(),
  recordCareReportPrintAuditMock: vi.fn(),
  canAccessCareReportSourceMock: vi.fn(),
  prismaMock: {
    careReport: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

vi.mock('@/server/services/export-audit', () => ({
  recordCareReportPrintAudit: recordCareReportPrintAuditMock,
}));

vi.mock('@/server/services/care-report-access', () => ({
  canAccessCareReportSource: canAccessCareReportSourceMock,
}));

import { POST } from './route';
import { careReportPrintAuditResponseSchema } from '@/lib/reports/care-report-print-audit-contract';

const REPORT_UPDATED_AT_ISO = '2026-06-18T01:02:03.000Z';

function createRequest(
  body: Record<string, unknown> = {
    intent: 'print_requested',
    expected_report_updated_at: REPORT_UPDATED_AT_ISO,
  },
) {
  return new NextRequest('http://localhost/api/care-reports/report_1/print-audit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function familyShareContent() {
  return {
    report_audience: 'family',
    patient: { name: '佐藤 花子', birth_date: '1940-01-01' },
    report_date: '2026-06-19',
    visit_date: '2026-06-18',
    pharmacist_name: '薬剤師 太郎',
    summary: '家族共有向け印刷本文',
    medication: '服薬状況',
    residual: '残薬なし',
    evaluation: '安定',
    requests: '継続確認',
    warnings: [],
  };
}

function physicianReportContent() {
  return {
    patient: { name: '佐藤 花子', birth_date: '1940-01-01', gender: 'F' },
    report_date: '2026-06-19',
    visit_date: '2026-06-18',
    pharmacist_name: '薬剤師 太郎',
    prescriber: { name: '主治医 一郎', institution: '在宅診療所' },
    prescriptions: [
      {
        drug_name: 'アムロジピン錠5mg',
        dose: '1錠',
        frequency: '1日1回朝食後',
        days: 28,
      },
    ],
    medication_management: {
      compliance_summary: '概ね良好',
      adherence_score: 4,
      self_management: '家族支援あり',
      calendar_used: true,
    },
    adverse_events: { has_events: false, events: [] },
    functional_assessment: {
      sleep: '良好',
      cognition: '変化なし',
      diet_oral: '良好',
      mobility: '杖歩行',
      excretion: '自立',
    },
    residual_medications: [],
    assessment: '服薬継続可能',
    plan: '次回も残薬確認',
    physician_communication: '処方継続で問題ありません',
    warnings: [],
  };
}

async function expectErrorBodyWithoutPrintContent(
  response: Response,
  expected: { code: string; message: string },
) {
  const body = await response.json();
  expect(body).toMatchObject(expected);
  const bodyText = JSON.stringify(body);
  expect(bodyText).not.toContain('山田花子');
  expect(bodyText).not.toContain('印刷本文');
}

describe('/api/care-reports/[id]/print-audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.careReport.findFirst = careReportFindFirstMock;
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
        actorSiteId: 'site_1',
        ipAddress: '127.0.0.1',
        userAgent: 'Vitest',
      },
    });
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      status: 'confirmed',
      patient_id: 'patient_1',
      case_id: 'case_1',
      visit_record_id: 'visit_record_1',
      report_type: 'physician_report',
      content: physicianReportContent(),
      updated_at: new Date('2026-06-18T01:02:03.000Z'),
    });
    canAccessCareReportSourceMock.mockResolvedValue(true);
    recordCareReportPrintAuditMock.mockResolvedValue(undefined);
  });

  it('records a print audit for confirmed care reports', async () => {
    const response = (await POST(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(careReportPrintAuditResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({
      data: {
        audited: true,
        report: {
          id: 'report_1',
          report_type: 'physician_report',
          updated_at: REPORT_UPDATED_AT_ISO,
          content: { patient: { name: '佐藤 花子' }, assessment: '服薬継続可能' },
        },
      },
    });
    expect(careReportFindFirstMock).toHaveBeenCalledTimes(2);
    expect(careReportFindFirstMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: 'report_1', org_id: 'org_1', status: 'confirmed' },
      }),
    );
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canSendCareReport',
      message: '報告書の印刷権限がありません',
    });
    expect(recordCareReportPrintAuditMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        orgId: 'org_1',
        actorId: 'user_1',
        actorSiteId: 'site_1',
        patientId: 'patient_1',
        reportId: 'report_1',
        intent: 'print_requested',
        reportUpdatedAt: new Date('2026-06-18T01:02:03.000Z'),
      }),
    );
  });

  it('records preview-rendered audits without conflating them with print requests', async () => {
    const response = (await POST(
      new NextRequest('http://localhost/api/care-reports/report_1/print-audit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ intent: 'preview_rendered' }),
      }),
      {
        params: Promise.resolve({ id: 'report_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(recordCareReportPrintAuditMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        reportId: 'report_1',
        actorSiteId: 'site_1',
        patientId: 'patient_1',
        intent: 'preview_rendered',
      }),
    );
  });

  it('records print audits for family share reports rendered by audience print views', async () => {
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      status: 'confirmed',
      patient_id: 'patient_1',
      case_id: 'case_1',
      visit_record_id: 'visit_record_1',
      report_type: 'family_share',
      content: familyShareContent(),
      updated_at: new Date('2026-06-18T01:02:03.000Z'),
    });

    const response = (await POST(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(careReportPrintAuditResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({
      data: {
        audited: true,
        report: {
          id: 'report_1',
          report_type: 'family_share',
          updated_at: REPORT_UPDATED_AT_ISO,
          content: { report_audience: 'family', summary: '家族共有向け印刷本文' },
        },
      },
    });
    expect(recordCareReportPrintAuditMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        reportId: 'report_1',
        intent: 'print_requested',
      }),
    );
  });

  it('does not audit family share reports when the audience print content is malformed', async () => {
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      status: 'confirmed',
      patient_id: 'patient_1',
      case_id: 'case_1',
      visit_record_id: 'visit_record_1',
      report_type: 'family_share',
      content: { summary: '山田花子 / 印刷本文' },
      updated_at: new Date('2026-06-18T01:02:03.000Z'),
    });

    const response = (await POST(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expectErrorBodyWithoutPrintContent(response, {
      code: 'WORKFLOW_CONFLICT',
      message: '印刷用の報告書形式が不正です',
    });
    expect(recordCareReportPrintAuditMock).not.toHaveBeenCalled();
  });

  it('does not audit physician reports when printable content is malformed', async () => {
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      status: 'confirmed',
      patient_id: 'patient_1',
      case_id: 'case_1',
      visit_record_id: 'visit_record_1',
      report_type: 'physician_report',
      content: { summary: '山田花子 / 印刷本文' },
      updated_at: new Date('2026-06-18T01:02:03.000Z'),
    });

    const response = (await POST(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expectErrorBodyWithoutPrintContent(response, {
      code: 'WORKFLOW_CONFLICT',
      message: '印刷用の報告書形式が不正です',
    });
    expect(recordCareReportPrintAuditMock).not.toHaveBeenCalled();
  });

  it('does not audit care manager reports when printable content is malformed', async () => {
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      status: 'confirmed',
      patient_id: 'patient_1',
      case_id: 'case_1',
      visit_record_id: 'visit_record_1',
      report_type: 'care_manager_report',
      content: { summary: '山田花子 / 印刷本文' },
      updated_at: new Date('2026-06-18T01:02:03.000Z'),
    });

    const response = (await POST(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expectErrorBodyWithoutPrintContent(response, {
      code: 'WORKFLOW_CONFLICT',
      message: '印刷用の報告書形式が不正です',
    });
    expect(recordCareReportPrintAuditMock).not.toHaveBeenCalled();
  });

  it('rejects invalid print audit intents before loading the report', async () => {
    const response = (await POST(
      new NextRequest('http://localhost/api/care-reports/report_1/print-audit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ intent: 'downloaded' }),
      }),
      {
        params: Promise.resolve({ id: 'report_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(careReportFindFirstMock).not.toHaveBeenCalled();
    expect(recordCareReportPrintAuditMock).not.toHaveBeenCalled();
  });

  it('requires the report version for print-requested audits before loading the report', async () => {
    const response = (await POST(createRequest({ intent: 'print_requested' }), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        expected_report_updated_at: expect.any(Array),
      },
    });
    expect(careReportFindFirstMock).not.toHaveBeenCalled();
    expect(recordCareReportPrintAuditMock).not.toHaveBeenCalled();
  });

  it('rejects stale print-requested audits before audit persistence or content output', async () => {
    const response = (await POST(
      createRequest({
        intent: 'print_requested',
        expected_report_updated_at: '2026-06-18T01:00:00.000Z',
      }),
      {
        params: Promise.resolve({ id: 'report_1' }),
      },
    ))!;

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expectErrorBodyWithoutPrintContent(response, {
      code: 'WORKFLOW_CONFLICT',
      message: '報告書が更新されています。再読み込みしてから印刷してください',
    });
    expect(careReportFindFirstMock).toHaveBeenCalledTimes(2);
    expect(recordCareReportPrintAuditMock).not.toHaveBeenCalled();
  });

  it('requires report send permission before loading or auditing the report', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: new Response(
        JSON.stringify({ code: 'FORBIDDEN', message: '報告書の印刷権限がありません' }),
        { status: 403 },
      ),
    });

    const response = (await POST(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(careReportFindFirstMock).not.toHaveBeenCalled();
    expect(recordCareReportPrintAuditMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when auth context fails before report loading', async () => {
    requireAuthContextMock.mockRejectedValueOnce(
      new Error('raw print auth patient 山田花子 token secret'),
    );

    const response = (await POST(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('raw print auth');
    expect(bodyText).not.toContain('山田花子');
    expect(bodyText).not.toContain('token secret');
    expect(careReportFindFirstMock).not.toHaveBeenCalled();
    expect(recordCareReportPrintAuditMock).not.toHaveBeenCalled();
  });

  it('rejects blank ids before loading or auditing the report', async () => {
    const response = (await POST(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(careReportFindFirstMock).not.toHaveBeenCalled();
    expect(recordCareReportPrintAuditMock).not.toHaveBeenCalled();
  });

  it('does not audit missing or unconfirmed reports', async () => {
    careReportFindFirstMock.mockResolvedValueOnce(null);

    const missingResponse = (await POST(createRequest(), {
      params: Promise.resolve({ id: 'missing_report' }),
    }))!;

    expect(missingResponse.status).toBe(404);
    expectSensitiveNoStore(missingResponse);
    expect(recordCareReportPrintAuditMock).not.toHaveBeenCalled();

    careReportFindFirstMock.mockResolvedValueOnce({
      id: 'report_1',
      status: 'draft',
      patient_id: 'patient_1',
      case_id: 'case_1',
      visit_record_id: 'visit_record_1',
    });

    const draftResponse = (await POST(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(draftResponse.status).toBe(409);
    expectSensitiveNoStore(draftResponse);
    expect(recordCareReportPrintAuditMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when report loading fails unexpectedly', async () => {
    careReportFindFirstMock.mockRejectedValueOnce(
      new Error('raw print report load patient 山田花子 印刷本文 token secret'),
    );

    const response = (await POST(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('raw print report load');
    expect(bodyText).not.toContain('山田花子');
    expect(bodyText).not.toContain('印刷本文');
    expect(bodyText).not.toContain('token secret');
    expect(recordCareReportPrintAuditMock).not.toHaveBeenCalled();
  });

  it('does not audit inaccessible reports', async () => {
    canAccessCareReportSourceMock.mockResolvedValueOnce(false);

    const response = (await POST(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(recordCareReportPrintAuditMock).not.toHaveBeenCalled();
  });

  it('does not audit or return content for non-printable report types', async () => {
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      status: 'confirmed',
      patient_id: 'patient_1',
      case_id: 'case_1',
      visit_record_id: 'visit_record_1',
      report_type: 'internal_record',
      content: { summary: '患者名 山田花子 / 印刷本文' },
      updated_at: new Date('2026-06-18T01:02:03.000Z'),
    });

    const response = (await POST(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expectErrorBodyWithoutPrintContent(response, {
      code: 'WORKFLOW_CONFLICT',
      message: '印刷対象外の報告書です',
    });
    expect(canAccessCareReportSourceMock).toHaveBeenCalledTimes(2);
    expect(recordCareReportPrintAuditMock).not.toHaveBeenCalled();
  });

  it('does not audit or return content when the printable report body is empty', async () => {
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      status: 'confirmed',
      patient_id: 'patient_1',
      case_id: 'case_1',
      visit_record_id: 'visit_record_1',
      report_type: 'physician_report',
      content: null,
      updated_at: new Date('2026-06-18T01:02:03.000Z'),
    });

    const response = (await POST(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expectErrorBodyWithoutPrintContent(response, {
      code: 'WORKFLOW_CONFLICT',
      message: '報告書本文がないため印刷できません',
    });
    expect(recordCareReportPrintAuditMock).not.toHaveBeenCalled();
  });

  it('does not audit when report access is lost before content output', async () => {
    canAccessCareReportSourceMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const response = (await POST(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    await expectErrorBodyWithoutPrintContent(response, {
      code: 'AUTH_FORBIDDEN',
      message: 'この報告書を印刷する権限がありません',
    });
    expect(canAccessCareReportSourceMock).toHaveBeenCalledTimes(2);
    expect(recordCareReportPrintAuditMock).not.toHaveBeenCalled();
  });

  it('fails closed when the print audit cannot be recorded', async () => {
    recordCareReportPrintAuditMock.mockRejectedValueOnce(new Error('DB down'));

    const response = (await POST(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    await expectErrorBodyWithoutPrintContent(response, {
      code: 'PRINT_AUDIT_FAILED',
      message: '報告書の印刷監査を記録できませんでした',
    });
    expect(careReportFindFirstMock).toHaveBeenCalledTimes(2);
  });

  it('does not audit or return print content when the report is no longer confirmed after access check', async () => {
    careReportFindFirstMock
      .mockResolvedValueOnce({
        id: 'report_1',
        status: 'confirmed',
        patient_id: 'patient_1',
        case_id: 'case_1',
        visit_record_id: 'visit_record_1',
      })
      .mockResolvedValueOnce(null);

    const response = (await POST(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '薬剤師確認済みの報告書のみ印刷できます',
    });
    expect(recordCareReportPrintAuditMock).not.toHaveBeenCalled();
    expect(careReportFindFirstMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: 'report_1', org_id: 'org_1', status: 'confirmed' },
      }),
    );
  });
});
