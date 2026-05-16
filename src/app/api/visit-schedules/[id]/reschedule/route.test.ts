import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withOrgContextMock,
  visitScheduleFindFirstMock,
  visitScheduleFindManyMock,
  visitScheduleUpdateMock,
  visitScheduleCountMock,
  visitScheduleProposalCreateMock,
  visitScheduleProposalUpdateManyMock,
  visitScheduleOverrideCreateMock,
  contactPartyFindManyMock,
  careTeamLinkFindManyMock,
  communicationRequestCreateMock,
  communicationEventCreateMock,
  membershipFindManyMock,
  taskUpdateManyMock,
  auditLogCreateMock,
  generateVisitScheduleProposalDraftsMock,
  upsertOperationalTaskMock,
  dispatchNotificationEventMock,
  notifyWorkflowMutationMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  visitScheduleFindFirstMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  visitScheduleUpdateMock: vi.fn(),
  visitScheduleCountMock: vi.fn(),
  visitScheduleProposalCreateMock: vi.fn(),
  visitScheduleProposalUpdateManyMock: vi.fn(),
  visitScheduleOverrideCreateMock: vi.fn(),
  contactPartyFindManyMock: vi.fn(),
  careTeamLinkFindManyMock: vi.fn(),
  communicationRequestCreateMock: vi.fn(),
  communicationEventCreateMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  taskUpdateManyMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  generateVisitScheduleProposalDraftsMock: vi.fn(),
  upsertOperationalTaskMock: vi.fn(),
  dispatchNotificationEventMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
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

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
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
    pharmacist_id: 'user_1',
    assignment_mode: 'primary',
    route_order: 1,
    schedule_status: 'planned',
    confirmed_at: new Date('2026-03-25T10:00:00.000Z'),
    confirmed_by: 'user_1',
    case_: {
      patient_id: 'patient_1',
      patient: {
        name: '山田花子',
      },
    },
    ...overrides,
  };
}

function buildImpactedSchedule(overrides?: Record<string, unknown>) {
  return {
    id: 'schedule_2',
    case_id: 'case_2',
    cycle_id: 'cycle_2',
    site_id: 'site_1',
    visit_type: 'regular',
    priority: 'normal',
    scheduled_date: new Date('2026-03-27T00:00:00.000Z'),
    time_window_start: new Date('1970-01-01T10:00:00'),
    time_window_end: new Date('1970-01-01T11:00:00'),
    pharmacist_id: 'user_1',
    assignment_mode: 'primary',
    route_order: 2,
    schedule_status: 'planned',
    confirmed_at: new Date('2026-03-25T11:00:00.000Z'),
    confirmed_by: 'user_2',
    override_request: null,
    case_: {
      patient_id: 'patient_2',
      patient: {
        name: '佐藤次郎',
      },
    },
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
        role: 'pharmacist',
      },
    });
    visitScheduleFindFirstMock.mockResolvedValue(buildSchedule());
    visitScheduleFindManyMock.mockResolvedValue([buildImpactedSchedule()]);
    generateVisitScheduleProposalDraftsMock.mockImplementation(
      async ({ caseId }: { caseId: string }) => {
        if (caseId === 'case_2') {
          return {
            drafts: [
              {
                org_id: 'org_1',
                cycle_id: 'cycle_2',
                case_id: 'case_2',
                site_id: 'site_1',
                visit_type: 'regular',
                priority: 'normal',
                proposal_status: 'reschedule_pending',
                patient_contact_status: 'pending',
                proposed_date: new Date('2026-03-27T00:00:00.000Z'),
                time_window_start: new Date('1970-01-01T15:00:00.000Z'),
                time_window_end: new Date('1970-01-01T16:00:00.000Z'),
                proposed_pharmacist_id: 'pharmacist_1',
                assignment_mode: 'primary',
                route_order: 3,
                route_distance_score: 2.4,
                medication_end_date: new Date('2026-03-31T00:00:00.000Z'),
                visit_deadline_date: new Date('2026-03-30T00:00:00.000Z'),
                proposal_reason: '同日内で後段へ再配置',
                escalation_reason: null,
                reschedule_source_schedule_id: 'schedule_2',
              },
            ],
            diagnostics: { accepted: [], rejected: [] },
          };
        }

        return {
          drafts: [
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
          ],
          diagnostics: { accepted: [], rejected: [] },
        };
      },
    );
    visitScheduleCountMock.mockResolvedValue(2);
    visitScheduleProposalCreateMock.mockImplementation(
      async ({
        data,
      }: {
        data: {
          reschedule_source_schedule_id?: string;
          proposed_date: Date;
          time_window_start: Date | null;
          time_window_end: Date | null;
          proposed_pharmacist_id: string;
        };
      }) => ({
        id: data.reschedule_source_schedule_id === 'schedule_2' ? 'proposal_2' : 'proposal_1',
        proposed_date: data.proposed_date,
        time_window_start: data.time_window_start,
        time_window_end: data.time_window_end,
        proposed_pharmacist_id: data.proposed_pharmacist_id,
      }),
    );
    visitScheduleProposalUpdateManyMock.mockResolvedValue({ count: 1 });
    visitScheduleOverrideCreateMock.mockImplementation(
      async ({
        data,
      }: {
        data: {
          source_schedule_id: string;
        };
      }) => ({
        id: data.source_schedule_id === 'schedule_2' ? 'override_2' : 'override_1',
      }),
    );
    contactPartyFindManyMock.mockResolvedValue([
      {
        name: '長女',
        relation: 'child',
        phone: '090-0000-0000',
        email: 'family@example.com',
        fax: null,
        is_primary: true,
      },
      {
        name: '施設担当',
        relation: 'facility_staff',
        phone: '03-0000-0000',
        email: null,
        fax: '03-1111-1111',
        is_primary: true,
      },
    ]);
    careTeamLinkFindManyMock.mockResolvedValue([
      {
        role: 'nurse',
        name: '訪問看護師',
        phone: '080-2222-2222',
        email: 'nurse@example.com',
        fax: null,
        is_primary: true,
      },
      {
        role: 'care_manager',
        name: '担当ケアマネ',
        phone: '080-3333-3333',
        email: 'cm@example.com',
        fax: null,
        is_primary: true,
      },
    ]);
    communicationRequestCreateMock.mockResolvedValue({ id: 'request_1' });
    membershipFindManyMock.mockResolvedValue([{ user_id: 'admin_1' }]);
    taskUpdateManyMock.mockResolvedValue({ count: 1 });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findMany: visitScheduleFindManyMock,
          update: visitScheduleUpdateMock,
          count: visitScheduleCountMock,
        },
        visitScheduleProposal: {
          create: visitScheduleProposalCreateMock,
          updateMany: visitScheduleProposalUpdateManyMock,
        },
        visitScheduleOverride: {
          create: visitScheduleOverrideCreateMock,
        },
        contactParty: {
          findMany: contactPartyFindManyMock,
        },
        careTeamLink: {
          findMany: careTeamLinkFindManyMock,
        },
        communicationRequest: {
          create: communicationRequestCreateMock,
        },
        communicationEvent: {
          create: communicationEventCreateMock,
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
      }),
    );
  });

  it('rejects completed schedules', async () => {
    visitScheduleFindFirstMock.mockResolvedValue(
      buildSchedule({
        time_window_start: null,
        time_window_end: null,
        schedule_status: 'completed',
      }),
    );

    const response = await POST(
      createRequest({ reason: '緊急案件対応', priority: 'urgent' }, { 'x-org-id': 'org_1' }),
      { params: Promise.resolve({ id: 'schedule_1' }) },
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
          reason_code: 'emergency_insert',
          communication_channel: 'phone',
          communication_result: 'pending',
          start_date: '2026-03-28',
          priority: 'urgent',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'schedule_1' }) },
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
    expect(generateVisitScheduleProposalDraftsMock).toHaveBeenNthCalledWith(2, {
      orgId: 'org_1',
      caseId: 'case_2',
      visitType: 'regular',
      priority: 'normal',
      candidateCount: 1,
      startDate: new Date('2026-03-27T00:00:00.000Z'),
      preferredTimeFrom: '10:00',
      preferredTimeTo: '11:00',
      rescheduleSourceScheduleId: 'schedule_2',
    });
    expect(visitScheduleCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        pharmacist_id: 'user_1',
        scheduled_date: new Date('2026-03-27T00:00:00.000Z'),
        schedule_status: {
          notIn: ['cancelled', 'rescheduled'],
        },
        id: { not: 'schedule_1' },
        AND: [
          {
            OR: [
              { pharmacist_id: 'user_1' },
              { case_: { primary_pharmacist_id: 'user_1' } },
              { case_: { backup_pharmacist_id: 'user_1' } },
            ],
          },
        ],
      },
    });
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          pharmacist_id: 'user_1',
          AND: [
            {
              OR: [
                { pharmacist_id: 'user_1' },
                { case_: { primary_pharmacist_id: 'user_1' } },
                { case_: { backup_pharmacist_id: 'user_1' } },
              ],
            },
          ],
        }),
      }),
    );
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        case_id: 'case_1',
        reschedule_source_schedule_id: 'schedule_1',
        proposal_reason: '担当者不在のため再配置 / リスケ理由: 緊急訪問が割り込んだため',
      }),
    });
    expect(visitScheduleProposalCreateMock).toHaveBeenCalledTimes(2);
    expect(visitScheduleProposalUpdateManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        reschedule_source_schedule_id: 'schedule_2',
        proposal_status: {
          in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
        },
      },
      data: {
        proposal_status: 'superseded',
      },
    });
    expect(visitScheduleOverrideCreateMock).toHaveBeenCalledTimes(2);
    expect(visitScheduleOverrideCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          org_id: 'org_1',
          source_schedule_id: 'schedule_2',
          status: 'pending',
          reason: expect.stringContaining('緊急訪問割込みの影響'),
          requested_by: 'user_1',
        }),
      }),
    );
    expect(visitScheduleOverrideCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          org_id: 'org_1',
          source_schedule_id: 'schedule_1',
          status: 'pending',
          reason: '緊急訪問が割り込んだため',
          requested_by: 'user_1',
          impact_summary: expect.objectContaining({
            impacted_schedule_count: 1,
            proposed_replacements: 2,
            impacted_patient_names: ['佐藤次郎'],
          }),
        }),
      }),
    );
    expect(communicationRequestCreateMock).toHaveBeenCalledTimes(4);
    expect(communicationRequestCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        patient_id: 'patient_1',
        case_id: 'case_1',
        request_type: 'schedule_change',
        template_key: 'visit_reschedule_notification',
        related_entity_type: 'visit_schedule',
        related_entity_id: 'schedule_1',
        status: 'draft',
      }),
    });
    expect(communicationEventCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        patient_id: 'patient_1',
        case_id: 'case_1',
        event_type: 'schedule_change',
        channel: 'phone',
      }),
    });
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
        changes: expect.objectContaining({
          reason_code: 'emergency_insert',
          communication_channel: 'phone',
          communication_result: 'pending',
          communication_target_count: 4,
        }),
      }),
    });
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: { source: 'visit_schedules_reschedule_request', schedule_id: 'schedule_1' },
    });
  });

  it('denies unassigned source schedules before proposal, write, audit, or notify side effects', async () => {
    visitScheduleFindFirstMock.mockResolvedValueOnce(null);

    const response = await POST(
      createRequest(
        {
          reason: '担当外予定のリスケ試行',
          reason_code: 'patient_request',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'schedule_unassigned' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(visitScheduleFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'schedule_unassigned',
          org_id: 'org_1',
          AND: [
            {
              OR: [
                { pharmacist_id: 'user_1' },
                { case_: { primary_pharmacist_id: 'user_1' } },
                { case_: { backup_pharmacist_id: 'user_1' } },
              ],
            },
          ],
        },
      }),
    );
    expect(generateVisitScheduleProposalDraftsMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalUpdateManyMock).not.toHaveBeenCalled();
    expect(visitScheduleOverrideCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });
});
