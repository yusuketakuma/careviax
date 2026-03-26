import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withOrgContextMock,
  visitScheduleFindFirstMock,
  visitScheduleUpdateMock,
  visitScheduleCountMock,
  visitScheduleProposalCreateMock,
  visitScheduleOverrideCreateMock,
  membershipFindManyMock,
  taskUpdateManyMock,
  auditLogCreateMock,
  generateVisitScheduleProposalDraftsMock,
  upsertOperationalTaskMock,
  dispatchNotificationEventMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  visitScheduleFindFirstMock: vi.fn(),
  visitScheduleUpdateMock: vi.fn(),
  visitScheduleCountMock: vi.fn(),
  visitScheduleProposalCreateMock: vi.fn(),
  visitScheduleOverrideCreateMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  taskUpdateManyMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  generateVisitScheduleProposalDraftsMock: vi.fn(),
  upsertOperationalTaskMock: vi.fn(),
  dispatchNotificationEventMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    visitSchedule: {
      findFirst: visitScheduleFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/visit-schedule-planner', () => ({
  generateVisitScheduleProposalDrafts: generateVisitScheduleProposalDraftsMock,
}));

vi.mock('@/server/services/operational-tasks', () => ({
  upsertOperationalTask: upsertOperationalTaskMock,
}));

vi.mock('@/server/services/notifications', () => ({
  dispatchNotificationEvent: dispatchNotificationEventMock,
}));

import { POST } from './route';

function createRequest(body: unknown, headers?: Record<string, string>) {
  return {
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
    json: async () => body,
  } as unknown as NextRequest;
}

function buildSchedule(overrides?: Record<string, unknown>) {
  return {
    id: 'schedule_1',
    case_id: 'case_1',
    cycle_id: 'cycle_1',
    site_id: 'site_1',
    visit_type: 'regular',
    priority: 'normal',
    scheduled_date: new Date('2026-03-27T00:00:00.000Z'),
    time_window_start: new Date('1970-01-01T09:00:00'),
    time_window_end: new Date('1970-01-01T10:00:00'),
    pharmacist_id: 'pharmacist_1',
    assignment_mode: 'primary',
    route_order: 1,
    schedule_status: 'planned',
    confirmed_at: new Date('2026-03-25T10:00:00.000Z'),
    confirmed_by: 'user_1',
    ...overrides,
  };
}

describe('/api/visit-schedules/[id]/reschedule POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
      },
    });
    visitScheduleFindFirstMock.mockResolvedValue(buildSchedule());
    generateVisitScheduleProposalDraftsMock.mockResolvedValue([
      {
        org_id: 'org_1',
        cycle_id: 'cycle_1',
        case_id: 'case_1',
        site_id: 'site_1',
        visit_type: 'regular',
        priority: 'urgent',
        proposal_status: 'reschedule_pending',
        patient_contact_status: 'pending',
        proposed_date: new Date('2026-03-28T00:00:00.000Z'),
        time_window_start: new Date('1970-01-01T13:00:00.000Z'),
        time_window_end: new Date('1970-01-01T14:00:00.000Z'),
        proposed_pharmacist_id: 'pharmacist_2',
        assignment_mode: 'fallback',
        route_order: 2,
        route_distance_score: 4.2,
        medication_end_date: new Date('2026-03-31T00:00:00.000Z'),
        visit_deadline_date: new Date('2026-03-30T00:00:00.000Z'),
        proposal_reason: '担当者不在のため再配置',
        escalation_reason: '代替薬剤師へ割当',
        reschedule_source_schedule_id: 'schedule_1',
      },
    ]);
    visitScheduleCountMock.mockResolvedValue(2);
    visitScheduleProposalCreateMock.mockResolvedValue({
      id: 'proposal_1',
      proposed_date: new Date('2026-03-28T00:00:00.000Z'),
      time_window_start: new Date('1970-01-01T13:00:00.000Z'),
      time_window_end: new Date('1970-01-01T14:00:00.000Z'),
      proposed_pharmacist_id: 'pharmacist_2',
    });
    visitScheduleOverrideCreateMock.mockResolvedValue({ id: 'override_1' });
    membershipFindManyMock.mockResolvedValue([{ user_id: 'admin_1' }]);
    taskUpdateManyMock.mockResolvedValue({ count: 1 });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          update: visitScheduleUpdateMock,
          count: visitScheduleCountMock,
        },
        visitScheduleProposal: {
          create: visitScheduleProposalCreateMock,
        },
        visitScheduleOverride: {
          create: visitScheduleOverrideCreateMock,
        },
        membership: {
          findMany: membershipFindManyMock,
        },
        task: {
          updateMany: taskUpdateManyMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      })
    );
  });

  it('rejects completed schedules', async () => {
    visitScheduleFindFirstMock.mockResolvedValue(
      buildSchedule({
        time_window_start: null,
        time_window_end: null,
        schedule_status: 'completed',
      })
    );

    const response = await POST(
      createRequest(
        { reason: '緊急案件対応', priority: 'urgent' },
        { 'x-org-id': 'org_1' }
      ),
      { params: Promise.resolve({ id: 'schedule_1' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'この訪問予定はリスケできません',
    });
    expect(generateVisitScheduleProposalDraftsMock).not.toHaveBeenCalled();
  });

  it('creates replacement proposals and a pending override approval log', async () => {
    const response = await POST(
      createRequest(
        {
          reason: '緊急訪問が割り込んだため',
          start_date: '2026-03-28',
          priority: 'urgent',
        },
        { 'x-org-id': 'org_1' }
      ),
      { params: Promise.resolve({ id: 'schedule_1' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(generateVisitScheduleProposalDraftsMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      caseId: 'case_1',
      visitType: 'regular',
      priority: 'urgent',
      candidateCount: 3,
      startDate: new Date('2026-03-28'),
      preferredTimeFrom: '09:00',
      preferredTimeTo: '10:00',
      rescheduleSourceScheduleId: 'schedule_1',
    });
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        case_id: 'case_1',
        reschedule_source_schedule_id: 'schedule_1',
        proposal_reason: '担当者不在のため再配置 / リスケ理由: 緊急訪問が割り込んだため',
      }),
    });
    expect(visitScheduleOverrideCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          org_id: 'org_1',
          source_schedule_id: 'schedule_1',
          status: 'pending',
          reason: '緊急訪問が割り込んだため',
          requested_by: 'user_1',
        }),
      }),
    );
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        taskType: 'visit_schedule_override_approval',
        dedupeKey: 'visit-reschedule-approval:schedule_1',
      }),
    );
    expect(taskUpdateManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        dedupe_key: 'visit-reschedule-approval:schedule_1',
      },
      data: {
        assigned_to: 'admin_1',
      },
    });
    expect(dispatchNotificationEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        eventType: 'visit_schedule_reschedule_requested',
      }),
    );
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'visit_schedule_reschedule_requested',
        target_type: 'VisitSchedule',
        target_id: 'schedule_1',
      }),
    });
  });
});
