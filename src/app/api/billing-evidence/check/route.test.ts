import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authContext,
  withOrgContextMock,
  txMock,
  billingMonthForJapanTimestampMock,
  todayUtcRangeMock,
  buildTodayOpsRailMock,
} = vi.hoisted(() => {
  const authContext = {
    userId: 'user_1',
    orgId: 'org_1',
    role: 'manager',
  };

  return {
    authContext,
    withOrgContextMock: vi.fn(),
    billingMonthForJapanTimestampMock: vi.fn(),
    todayUtcRangeMock: vi.fn(),
    buildTodayOpsRailMock: vi.fn(),
    txMock: {
      billingEvidence: {
        count: vi.fn(),
      },
      billingCandidate: {
        count: vi.fn(),
        findMany: vi.fn(),
      },
      visitSchedule: {
        count: vi.fn(),
      },
      billingRule: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      template: {
        groupBy: vi.fn(),
      },
      patient: {
        findMany: vi.fn(),
      },
      medicationCycle: {
        findMany: vi.fn(),
      },
    },
  };
});

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (handler: (req: unknown, ctx: typeof authContext, routeContext?: unknown) => unknown) =>
    (req: unknown, routeContext?: unknown) =>
      handler(req, authContext, routeContext),
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/utils/date-boundary', () => ({
  todayUtcRange: todayUtcRangeMock,
}));

vi.mock('@/server/services/billing-evidence', () => ({
  billingMonthForJapanTimestamp: billingMonthForJapanTimestampMock,
}));

vi.mock('@/server/services/today-ops-rail', () => ({
  buildTodayOpsRail: buildTodayOpsRailMock,
}));

import { GET } from './route';

const currentMonthStart = new Date('2026-03-01T00:00:00.000Z');
const previousMonthStart = new Date('2026-02-01T00:00:00.000Z');
const todayRange = {
  gte: new Date('2026-03-01T00:00:00.000Z'),
  lt: new Date('2026-03-02T00:00:00.000Z'),
};
const emptyParams = { params: Promise.resolve({}) };

function createRequest(search = '') {
  return new NextRequest(`http://localhost/api/billing-evidence/check${search}`, {
    headers: {
      'x-org-id': 'org_1',
    },
  });
}

describe('/api/billing-evidence/check GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-28T15:30:00.000Z'));
    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback(txMock));
    billingMonthForJapanTimestampMock.mockReturnValue(currentMonthStart);
    todayUtcRangeMock.mockReturnValue(todayRange);
    buildTodayOpsRailMock.mockResolvedValue({
      next_actions: [],
      blocked_reasons: [],
      evidence_records: [],
    });
    txMock.billingEvidence.count.mockResolvedValue(5);
    txMock.billingCandidate.count.mockResolvedValueOnce(3).mockResolvedValueOnce(2);
    txMock.billingCandidate.findMany.mockResolvedValue([
      {
        id: 'candidate_1',
        patient_id: 'patient_1',
        cycle_id: 'cycle_1',
        rule_id: 'rule_1',
        billing_name: '退院時共同指導料',
        billing_target_name: null,
        exclusion_reason: '退院時カンファレンスの根拠確認が必要です',
      },
    ]);
    txMock.visitSchedule.count.mockResolvedValue(7);
    txMock.billingRule.findFirst.mockResolvedValue({
      effective_from: new Date('2026-04-01T00:00:00.000Z'),
    });
    txMock.template.groupBy.mockResolvedValue([
      { template_type: 'care_report' },
      { template_type: 'billing_summary' },
    ]);
    txMock.patient.findMany.mockResolvedValue([{ id: 'patient_1', name: '山田太郎' }]);
    txMock.medicationCycle.findMany.mockResolvedValue([
      { id: 'cycle_1', case_: { status: 'on_hold' } },
    ]);
    txMock.billingRule.findMany.mockResolvedValue([
      { id: 'rule_1', source_note: '厚労省通知', source_url: 'https://example.test/rule' },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the current monthly billing check dashboard contract', async () => {
    const response = await GET(createRequest(), emptyParams);

    expect(response.status).toBe(200);
    expect(withOrgContextMock).toHaveBeenCalledTimes(2);
    expect(withOrgContextMock).toHaveBeenNthCalledWith(1, 'org_1', expect.any(Function), {
      timeoutMs: 10_000,
    });
    expect(withOrgContextMock).toHaveBeenNthCalledWith(2, 'org_1', expect.any(Function), {
      timeoutMs: 10_000,
    });
    expect(txMock.billingEvidence.count).toHaveBeenCalledWith({
      where: { org_id: 'org_1', billing_month: currentMonthStart, claimable: true },
    });
    expect(txMock.billingCandidate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { org_id: 'org_1', billing_month: currentMonthStart, status: 'candidate' },
        take: 10,
      }),
    );
    expect(txMock.visitSchedule.count).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        scheduled_date: todayRange,
        schedule_status: {
          in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress'],
        },
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        generated_at: '2026-02-28T15:30:00.000Z',
        month: 'current',
        month_label: '2026年3月分',
        month_short_label: '3月分',
        passed_count: 5,
        review_count: 3,
        today_pending_count: 7,
        records: {
          rule_revision_label: '令和8年改定',
          rejection_count: 2,
          summary_template_kind_count: 2,
        },
        review_rows: [
          {
            id: 'candidate_1',
            patient_label: '山田太郎 様(入院中)',
            patient_href: '/patients/patient_1',
            billing_name: '退院時共同指導料',
            confirm_text: '退院時カンファレンスの根拠確認が必要です',
            evidence_label: '厚労省通知',
            evidence_href: 'https://example.test/rule',
            action_label: '病院へ確認',
            action_href: '/admin/institutions',
          },
        ],
      },
    });
  });

  it('encodes review-row patient hrefs while preserving raw lookup ids', async () => {
    const rawPatientId = 'patient/1?tab=x#frag';
    const encodedPatientHref = `/patients/${encodeURIComponent(rawPatientId)}`;

    txMock.billingCandidate.findMany.mockResolvedValue([
      {
        id: 'candidate_hostile',
        patient_id: rawPatientId,
        cycle_id: null,
        rule_id: null,
        billing_name: '訪問薬剤管理指導料',
        billing_target_name: null,
        exclusion_reason: null,
      },
    ]);
    txMock.patient.findMany.mockResolvedValue([{ id: rawPatientId, name: '山田太郎' }]);

    const response = await GET(createRequest(), emptyParams);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(txMock.patient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { org_id: 'org_1', id: { in: [rawPatientId] } },
      }),
    );
    expect(json.data.review_rows).toEqual([
      expect.objectContaining({
        id: 'candidate_hostile',
        patient_label: '山田太郎 様',
        patient_href: encodedPatientHref,
        billing_name: '訪問薬剤管理指導料',
        action_label: '→ カードへ',
        action_href: encodedPatientHref,
      }),
    ]);
  });

  it('uses the previous billing month when requested', async () => {
    const response = await GET(createRequest('?month=previous'), emptyParams);

    expect(response.status).toBe(200);
    expect(txMock.billingEvidence.count).toHaveBeenCalledWith({
      where: { org_id: 'org_1', billing_month: previousMonthStart, claimable: true },
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        month: 'previous',
        month_label: '2026年2月分',
        month_short_label: '2月分',
      },
    });
  });

  it('rejects invalid month before opening the org-scoped transaction', async () => {
    const response = await GET(createRequest('?month=next'), emptyParams);

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });
});
