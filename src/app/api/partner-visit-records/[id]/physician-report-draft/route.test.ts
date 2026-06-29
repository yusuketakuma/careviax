import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withOrgContextMock,
  createPartnerVisitPhysicianReportDraftMock,
  MockPartnerVisitPhysicianReportDraftError,
} = vi.hoisted(() => {
  class MockPartnerVisitPhysicianReportDraftError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly details?: Record<string, unknown>,
    ) {
      super(message);
      this.name = 'PartnerVisitPhysicianReportDraftError';
    }
  }
  return {
    withOrgContextMock: vi.fn(),
    createPartnerVisitPhysicianReportDraftMock: vi.fn(),
    MockPartnerVisitPhysicianReportDraftError,
  };
});

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => Promise<Response>) => {
    return (req: NextRequest, routeContext?: unknown) =>
      handler(
        req,
        {
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist',
        },
        routeContext,
      );
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/partner-visit-report-drafts', () => ({
  createPartnerVisitPhysicianReportDraft: createPartnerVisitPhysicianReportDraftMock,
  PartnerVisitPhysicianReportDraftError: MockPartnerVisitPhysicianReportDraftError,
}));

import { POST as rawPOST } from './route';

function routeContext(id: string | undefined = 'partner_visit_record_1') {
  return { params: Promise.resolve({ id }) };
}

function createRequest() {
  return new NextRequest(
    'http://localhost/api/partner-visit-records/partner_visit_record_1/physician-report-draft',
    { method: 'POST' },
  );
}

describe('/api/partner-visit-records/[id]/physician-report-draft POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createPartnerVisitPhysicianReportDraftMock.mockResolvedValue({
      reused: false,
      report: {
        id: 'report_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        partner_visit_record_id: 'partner_visit_record_1',
        report_type: 'physician_report',
        status: 'draft',
        created_at: '2026-06-19T00:00:00.000Z',
        updated_at: '2026-06-19T00:00:00.000Z',
        has_content: true,
      },
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback({ tx: true }));
  });

  it('creates a physician report draft through a serializable transaction with no-store response headers', async () => {
    const response = await rawPOST(createRequest(), routeContext());

    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(withOrgContextMock).toHaveBeenCalledWith(
      'org_1',
      expect.any(Function),
      expect.objectContaining({ isolationLevel: expect.any(String) }),
    );
    expect(createPartnerVisitPhysicianReportDraftMock).toHaveBeenCalledWith(
      { tx: true },
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      { partnerVisitRecordId: 'partner_visit_record_1' },
    );
    await expect(response.json()).resolves.toMatchObject({
      message: '医師向け報告書ドラフトを作成しました',
      reused_existing_draft: false,
      report: {
        id: 'report_1',
        partner_visit_record_id: 'partner_visit_record_1',
        has_content: true,
      },
    });
  });

  it('returns an existing draft idempotently', async () => {
    createPartnerVisitPhysicianReportDraftMock.mockResolvedValue({
      reused: true,
      report: {
        id: 'report_existing',
        patient_id: 'patient_1',
        case_id: 'case_1',
        partner_visit_record_id: 'partner_visit_record_1',
        report_type: 'physician_report',
        status: 'draft',
        created_at: '2026-06-18T00:00:00.000Z',
        updated_at: '2026-06-18T00:00:00.000Z',
        has_content: true,
      },
    });

    const response = await rawPOST(createRequest(), routeContext());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: '既存の医師向け報告書ドラフトを返しました',
      reused_existing_draft: true,
      report: { id: 'report_existing' },
    });
  });

  it('rejects invalid route ids before transaction side effects', async () => {
    const response = await rawPOST(createRequest(), routeContext('   '));

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(createPartnerVisitPhysicianReportDraftMock).not.toHaveBeenCalled();
  });

  it('maps non-confirmed source errors to conflict responses', async () => {
    createPartnerVisitPhysicianReportDraftMock.mockRejectedValue(
      new MockPartnerVisitPhysicianReportDraftError(
        'PARTNER_VISIT_RECORD_NOT_CONFIRMED',
        '確認済みの協力訪問記録のみ医師向け報告書を作成できます',
        { status: 'submitted' },
      ),
    );

    const response = await rawPOST(createRequest(), routeContext());

    expect(response.status).toBe(409);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '確認済みの協力訪問記録のみ医師向け報告書を作成できます',
    });
  });

  it('does not echo raw draft error messages or unsafe details', async () => {
    createPartnerVisitPhysicianReportDraftMock.mockRejectedValue(
      new MockPartnerVisitPhysicianReportDraftError(
        'PARTNER_VISIT_SOURCE_INACTIVE',
        'patient 山田太郎 source inactive token=secret',
        {
          share_case_status: 'inactive',
          visit_request_status: 'patient 山田太郎 token=secret',
          raw_message: 'SOAP patient 山田太郎',
        },
      ),
    );

    const response = await rawPOST(createRequest(), routeContext());
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(payload).toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '有効な患者共有ケースと確認済み協力訪問のみ医師向け報告書を作成できます',
      details: {
        share_case_status: 'inactive',
      },
    });
    const serializedPayload = JSON.stringify(payload);
    expect(serializedPayload).not.toContain('山田太郎');
    expect(serializedPayload).not.toContain('token=secret');
    expect(serializedPayload).not.toContain('raw_message');
    expect(serializedPayload).not.toContain('visit_request_status');
  });
});
