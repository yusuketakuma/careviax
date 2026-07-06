import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  requireAuthContextMock,
  withOrgContextMock,
  resolveDashboardAssignmentScopeMock,
  buildOperationalTaskHealthBoardMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  resolveDashboardAssignmentScopeMock: vi.fn(),
  buildOperationalTaskHealthBoardMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/dashboard-assignment-scope', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/server/services/dashboard-assignment-scope')>();
  return {
    ...actual,
    resolveDashboardAssignmentScope: resolveDashboardAssignmentScopeMock,
  };
});

vi.mock('@/server/services/operational-task-health', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/services/operational-task-health')>();
  return {
    ...actual,
    buildOperationalTaskHealthBoard: buildOperationalTaskHealthBoardMock,
  };
});

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

import { GET } from './route';

function request(url = 'http://localhost/api/tasks/health-board') {
  return new NextRequest(url, { method: 'GET' });
}

function board() {
  return {
    generated_at: '2026-07-06T00:00:00.000Z',
    scan: {
      statuses: ['pending', 'in_progress'],
      limit: 500,
      scanned_count: 2,
      truncated: false,
    },
    summary: {
      open_count: 2,
      overdue_count: 1,
      sla_overdue_count: 1,
      unassigned_count: 1,
      patient_safety_count: 1,
      billing_close_count: 1,
      report_delay_count: 0,
      risk_task_count: 1,
      stale_risk_task_count: 0,
      orphan_risk_task_count: 0,
    },
    task_type_groups: [
      {
        key: 'risk_medication',
        label: 'risk_medication',
        count: 1,
        urgent_count: 1,
        high_count: 0,
      },
    ],
    risk_domain_groups: [
      {
        key: 'medication',
        label: '薬剤リスク',
        count: 1,
        urgent_count: 1,
        high_count: 0,
      },
    ],
    orphan_audit: {
      checked_count: 1,
      orphan_count: 0,
      reasons: [],
      tasks: [],
    },
    attention: {
      overdue_tasks: [],
      sla_overdue_tasks: [],
      unassigned_tasks: [],
      stale_risk_tasks: [],
    },
  };
}

describe('/api/tasks/health-board', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    resolveDashboardAssignmentScopeMock.mockResolvedValue({
      caseIds: ['case_1'],
      patientIds: ['patient_1'],
      assignedToUserId: 'user_1',
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback({ task: {} }));
    buildOperationalTaskHealthBoardMock.mockResolvedValue(board());
  });

  it('returns a no-store task health board scoped by assignment and risk domain', async () => {
    const response = await GET(
      request('http://localhost/api/tasks/health-board?scope=mine&risk_domain=medication&limit=25'),
    );

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(requireAuthContextMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({
        permission: 'canVisit',
      }),
    );
    expect(resolveDashboardAssignmentScopeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org_1',
        accessContext: expect.objectContaining({ userId: 'user_1' }),
        scope: 'mine',
      }),
    );
    expect(buildOperationalTaskHealthBoardMock).toHaveBeenCalledWith(
      { task: {} },
      expect.objectContaining({
        orgId: 'org_1',
        limit: 25,
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            {
              OR: expect.arrayContaining([
                {
                  OR: expect.arrayContaining([
                    { assigned_to: 'user_1' },
                    {
                      related_entity_type: 'patient',
                      related_entity_id: { in: ['patient_1'] },
                    },
                    {
                      related_entity_type: 'case',
                      related_entity_id: { in: ['case_1'] },
                    },
                  ]),
                },
                {
                  AND: expect.arrayContaining([
                    {
                      OR: expect.arrayContaining([
                        { task_type: { in: expect.arrayContaining(['risk_medication']) } },
                        { dedupe_key: { startsWith: 'risk:' } },
                        {
                          metadata: {
                            path: ['source'],
                            equals: 'risk_finding',
                          },
                        },
                      ]),
                    },
                    {
                      OR: expect.arrayContaining([
                        {
                          metadata: {
                            path: ['case_id'],
                            equals: 'case_1',
                          },
                        },
                        {
                          metadata: {
                            path: ['patient_id'],
                            equals: 'patient_1',
                          },
                        },
                      ]),
                    },
                  ]),
                },
              ]),
            },
            {
              OR: expect.arrayContaining([
                { task_type: 'risk_medication' },
                {
                  metadata: {
                    path: ['risk_domain'],
                    equals: 'medication',
                  },
                },
              ]),
            },
          ]),
        }),
      }),
    );
    const body = await response.json();
    expect(body.data.scope).toBe('mine');
    expect(body.data.summary.risk_task_count).toBe(1);
    expect(JSON.stringify(body)).not.toContain('metadata');
    expect(JSON.stringify(body)).not.toContain('dedupe_key');
  });

  it('passes direct task type filters without adding a risk-domain metadata filter', async () => {
    const response = await GET(
      request('http://localhost/api/tasks/health-board?task_type=conference_action_item'),
    );

    expect(response.status).toBe(200);
    expect(buildOperationalTaskHealthBoardMock).toHaveBeenCalledWith(
      { task: {} },
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([{ task_type: 'conference_action_item' }]),
        }),
      }),
    );
    const where = buildOperationalTaskHealthBoardMock.mock.calls[0]?.[1]?.where;
    expect(JSON.stringify(where)).not.toContain('risk_domain');
  });

  it('rejects invalid query combinations before resolving assignment scope', async () => {
    const response = await GET(
      request('http://localhost/api/tasks/health-board?task_type=risk_billing&risk_domain=billing'),
    );

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(resolveDashboardAssignmentScopeMock).not.toHaveBeenCalled();
    expect(buildOperationalTaskHealthBoardMock).not.toHaveBeenCalled();
  });

  it('rejects forbidden roles before reading task health data', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: new Response('forbidden', { status: 403 }),
    });

    const response = await GET(request());

    expect(response.status).toBe(403);
    expect(resolveDashboardAssignmentScopeMock).not.toHaveBeenCalled();
    expect(buildOperationalTaskHealthBoardMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when health board construction fails', async () => {
    buildOperationalTaskHealthBoardMock.mockRejectedValueOnce(new Error('raw task metadata leak'));

    const response = await GET(request());

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('raw task metadata leak');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'tasks_health_board_unhandled_error',
        route: '/api/tasks/health-board',
        method: 'GET',
      }),
      expect.any(Error),
    );
  });
});
