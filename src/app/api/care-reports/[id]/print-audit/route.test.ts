import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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

function createRequest() {
  return new NextRequest('http://localhost/api/care-reports/report_1/print-audit', {
    method: 'POST',
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
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
      content: { summary: '印刷本文' },
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
    await expect(response.json()).resolves.toMatchObject({
      data: {
        audited: true,
        report: {
          id: 'report_1',
          report_type: 'physician_report',
          content: { summary: '印刷本文' },
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
        intent: 'preview_rendered',
      }),
    );
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

  it('does not audit inaccessible reports', async () => {
    canAccessCareReportSourceMock.mockResolvedValueOnce(false);

    const response = (await POST(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(recordCareReportPrintAuditMock).not.toHaveBeenCalled();
  });

  it('fails closed when the print audit cannot be recorded', async () => {
    recordCareReportPrintAuditMock.mockRejectedValueOnce(new Error('DB down'));

    const response = (await POST(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
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
