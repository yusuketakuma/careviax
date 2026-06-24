import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const HOSTILE_PROPOSAL_ID = 'proposal/1?tab=x#frag';

const {
  authContextMock,
  medicationCycleCountMock,
  medicationCycleFindManyMock,
  careTeamLinkCountMock,
  proposalCountMock,
  proposalFindManyMock,
  careReportCountMock,
  workflowExceptionCountMock,
} = vi.hoisted(() => ({
  authContextMock: { orgId: 'org_1', userId: 'user_1', role: 'clerk' },
  medicationCycleCountMock: vi.fn(),
  medicationCycleFindManyMock: vi.fn(),
  careTeamLinkCountMock: vi.fn(),
  proposalCountMock: vi.fn(),
  proposalFindManyMock: vi.fn(),
  careReportCountMock: vi.fn(),
  workflowExceptionCountMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<Record<string, string>> }) =>
      handler(req, authContextMock, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    medicationCycle: { count: medicationCycleCountMock, findMany: medicationCycleFindManyMock },
    careTeamLink: { count: careTeamLinkCountMock },
    visitScheduleProposal: { count: proposalCountMock, findMany: proposalFindManyMock },
    careReport: { count: careReportCountMock },
    workflowException: { count: workflowExceptionCountMock },
  },
}));

import { GET } from './route';

function createRequest() {
  return new NextRequest('http://localhost/api/dashboard/clerk-support', {
    headers: { 'x-org-id': 'org_1' },
  });
}

describe('/api/dashboard/clerk-support', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 12, 9, 0));
    vi.clearAllMocks();
    medicationCycleCountMock.mockResolvedValue(12);
    careTeamLinkCountMock.mockResolvedValue(8);
    proposalCountMock.mockResolvedValue(6);
    careReportCountMock.mockResolvedValueOnce(11).mockResolvedValueOnce(7);
    workflowExceptionCountMock.mockResolvedValue(5);
    medicationCycleFindManyMock.mockResolvedValue([
      { id: 'cycle_1', case_: { patient: { name: '田中 一郎' } } },
    ]);
    proposalFindManyMock.mockResolvedValue([
      {
        id: HOSTILE_PROPOSAL_ID,
        proposed_date: new Date('2026-06-13T00:00:00.000Z'),
        case_: { patient: { name: '鈴木 修' } },
      },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aggregates the six clerk KPIs and a mixed task list', async () => {
    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.data.kpis).toEqual({
      intake_pending: 12,
      delivery_target_missing: 8,
      schedule_confirmation: 6,
      document_drafts: 11,
      reply_pending: 7,
      pharmacist_review: 5,
    });

    expect(json.data.tasks).toEqual([
      expect.objectContaining({
        kind_label: '処方受付',
        patient_name: '田中 一郎',
        href: '/prescriptions/intake',
      }),
      expect.objectContaining({
        id: `proposal-${HOSTILE_PROPOSAL_ID}`,
        kind_label: '日程確認',
        patient_name: '鈴木 修',
        due_label: '2026-06-13',
        href: `/schedules/proposals?detail=${encodeURIComponent(HOSTILE_PROPOSAL_ID)}`,
      }),
    ]);
    expect(json.data.tasks[1].href).not.toBe(`/schedules/proposals?detail=${HOSTILE_PROPOSAL_ID}`);

    expect(json.data.consult_items).toEqual([
      '処方内容の判断',
      '薬の変更理由',
      '服薬指導の内容',
      '算定できるかの判断',
    ]);
  });

  it('counts delivery-target gaps only for document-channel roles on active cases', async () => {
    await GET(createRequest(), { params: Promise.resolve({}) });

    const where = careTeamLinkCountMock.mock.calls.at(0)?.[0]?.where;
    expect(where?.role).toEqual({ in: ['physician', 'nurse', 'care_manager'] });
    expect(where?.case_).toEqual({ status: 'active' });
    expect(where?.AND).toEqual([
      { OR: [{ fax: null }, { fax: '' }] },
      { OR: [{ email: null }, { email: '' }] },
    ]);
  });
});
