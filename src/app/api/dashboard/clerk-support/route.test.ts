import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const HOSTILE_PROPOSAL_ID = 'proposal/1?tab=x#frag';

const {
  authContextMock,
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  loggerErrorMock,
  withRoutePerformanceMock,
  medicationCycleCountMock,
  medicationCycleFindManyMock,
  careTeamLinkCountMock,
  proposalCountMock,
  proposalFindManyMock,
  careReportCountMock,
  workflowExceptionCountMock,
} = vi.hoisted(() => ({
  authContextMock: { orgId: 'org_1', userId: 'user_1', role: 'clerk' },
  requireAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback) => callback()),
  loggerErrorMock: vi.fn(),
  withRoutePerformanceMock: vi.fn((_req, handler) => handler()),
  medicationCycleCountMock: vi.fn(),
  medicationCycleFindManyMock: vi.fn(),
  careTeamLinkCountMock: vi.fn(),
  proposalCountMock: vi.fn(),
  proposalFindManyMock: vi.fn(),
  careReportCountMock: vi.fn(),
  workflowExceptionCountMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/auth/request-context', () => ({
  runWithRequestAuthContext: runWithRequestAuthContextMock,
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

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/utils/performance', () => ({
  withRoutePerformance: withRoutePerformanceMock,
}));

import { GET } from './route';

function createRequest() {
  return new NextRequest('http://localhost/api/dashboard/clerk-support', {
    headers: { 'x-org-id': 'org_1' },
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/dashboard/clerk-support', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 12, 9, 0));
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({ ctx: authContextMock });
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    withRoutePerformanceMock.mockImplementation((_req, handler) => handler());
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
    expect(withRoutePerformanceMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.any(Function),
    );
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canViewDashboard',
      message: 'ダッシュボードの閲覧権限がありません',
    });
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(
      authContextMock,
      expect.any(Function),
    );
    expectSensitiveNoStore(response);
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
    expect(
      json.data.tasks.map((task: Record<string, unknown>) => Object.keys(task).sort()),
    ).toEqual([
      ['due_label', 'href', 'id', 'kind_label', 'next_action', 'patient_name'],
      ['due_label', 'href', 'id', 'kind_label', 'next_action', 'patient_name'],
    ]);

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

  it('wraps auth failure responses in no-store headers before clerk support DB reads', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: NextResponse.json({ code: 'AUTH_FORBIDDEN' }, { status: 403 }),
    });

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(403);
    expect(withRoutePerformanceMock).toHaveBeenCalledTimes(1);
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canViewDashboard',
      message: 'ダッシュボードの閲覧権限がありません',
    });
    expectSensitiveNoStore(response);
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(medicationCycleCountMock).not.toHaveBeenCalled();
    expect(careTeamLinkCountMock).not.toHaveBeenCalled();
    expect(proposalCountMock).not.toHaveBeenCalled();
    expect(careReportCountMock).not.toHaveBeenCalled();
    expect(workflowExceptionCountMock).not.toHaveBeenCalled();
    expect(medicationCycleFindManyMock).not.toHaveBeenCalled();
    expect(proposalFindManyMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when clerk support reads fail', async () => {
    const unsafeError = new Error(
      'raw patient clerk dashboard SQL stack raw-error text must not leak',
    );
    unsafeError.name = 'crafted.patient.clerk.dashboard.SQL.stack.raw-error';
    medicationCycleCountMock.mockRejectedValueOnce(unsafeError);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(500);
    expect(withRoutePerformanceMock).toHaveBeenCalledTimes(1);
    expectSensitiveNoStore(response);
    const body = await response.text();
    expect(body).toContain('INTERNAL_ERROR');
    expect(body).not.toContain('patient');
    expect(body).not.toContain('clerk');
    expect(body).not.toContain('dashboard');
    expect(body).not.toContain('SQL');
    expect(body).not.toContain('stack');
    expect(body).not.toContain('crafted.patient');
    expect(body).not.toContain('raw-error text');
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'dashboard_clerk_support_unhandled_error',
        route: '/api/dashboard/clerk-support',
        method: 'GET',
        status: 500,
      },
      unsafeError,
    );
    expect(loggerErrorMock.mock.calls[0]?.[0]).not.toHaveProperty('error_name');
    const loggedContext = JSON.stringify(loggerErrorMock.mock.calls[0]?.[0]);
    expect(loggedContext).not.toContain('raw patient');
    expect(loggedContext).not.toContain('crafted.patient');
    expect(loggedContext).not.toContain('SQL');
    expect(loggedContext).not.toContain('stack');
    expect(loggedContext).not.toContain('raw-error text');
  });
});
