import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';

const {
  requireAuthContextMock,
  withOrgContextMock,
  visitScheduleFindFirstMock,
  visitScheduleFindManyMock,
  visitScheduleUpdateMock,
  visitScheduleUpdateManyMock,
  visitScheduleCountMock,
  visitScheduleProposalCreateMock,
  visitScheduleProposalFindManyMock,
  visitScheduleProposalUpdateManyMock,
  visitScheduleOverrideFindFirstMock,
  visitScheduleOverrideCreateMock,
  visitScheduleOverrideUpdateMock,
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
  visitScheduleUpdateManyMock: vi.fn(),
  visitScheduleCountMock: vi.fn(),
  visitScheduleProposalCreateMock: vi.fn(),
  visitScheduleProposalFindManyMock: vi.fn(),
  visitScheduleProposalUpdateManyMock: vi.fn(),
  visitScheduleOverrideFindFirstMock: vi.fn(),
  visitScheduleOverrideCreateMock: vi.fn(),
  visitScheduleOverrideUpdateMock: vi.fn(),
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
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

function createRequest(body: unknown, headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/visit-schedules/schedule_1/reschedule', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

function createMalformedJsonRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/visit-schedules/schedule_1/reschedule', {
    method: 'POST',
    body: '{"reason":',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

function buildExpectedRescheduleRequestIntentKey(args?: {
  reason?: string;
  reasonCode?: string;
  communicationChannel?: string;
  communicationResult?: string;
  startDate?: string | null;
  priority?: string | null;
  preferredPharmacistId?: string | null;
  requestedVehicleResourceId?: string | null;
}) {
  const material = [
    'visit-reschedule',
    'schedule_1',
    (args?.reason ?? '患者都合で変更').trim().replace(/\s+/g, ' '),
    args?.reasonCode ?? 'patient_request',
    args?.communicationChannel ?? 'phone',
    args?.communicationResult ?? 'pending',
    args?.startDate ?? '',
    args?.priority ?? '',
    args?.preferredPharmacistId ?? '',
    args?.requestedVehicleResourceId ?? '',
  ].join(':');
  return `visit-reschedule:v1:${createHash('sha256').update(material).digest('hex')}`;
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
    time_window_start: new Date('1970-01-01T09:00:00.000Z'),
    time_window_end: new Date('1970-01-01T10:00:00.000Z'),
    pharmacist_id: 'user_1',
    assignment_mode: 'primary',
    route_order: 1,
    vehicle_resource_id: 'vehicle_1',
    schedule_status: 'planned',
    confirmed_at: new Date('2026-03-25T10:00:00.000Z'),
    confirmed_by: 'user_1',
    version: 4,
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
    time_window_start: new Date('1970-01-01T10:00:00.000Z'),
    time_window_end: new Date('1970-01-01T11:00:00.000Z'),
    pharmacist_id: 'user_1',
    assignment_mode: 'primary',
    route_order: 2,
    vehicle_resource_id: 'vehicle_2',
    schedule_status: 'planned',
    confirmed_at: new Date('2026-03-25T11:00:00.000Z'),
    confirmed_by: 'user_2',
    version: 2,
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

function buildSerializableConflictError() {
  return new Prisma.PrismaClientKnownRequestError('Serializable transaction conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
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
                vehicle_resource_id: 'vehicle_2',
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
              vehicle_resource_id: 'vehicle_1',
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
    visitScheduleProposalFindManyMock.mockResolvedValue([]);
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
    visitScheduleOverrideUpdateMock.mockImplementation(
      async ({ data }: { data: { source_schedule_id?: string } }) => ({
        id: data.source_schedule_id === 'schedule_2' ? 'override_2' : 'override_cancelled',
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
    visitScheduleOverrideFindFirstMock.mockResolvedValue(null);
    visitScheduleUpdateManyMock.mockResolvedValue({ count: 1 });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findMany: visitScheduleFindManyMock,
          update: visitScheduleUpdateMock,
          updateMany: visitScheduleUpdateManyMock,
          count: visitScheduleCountMock,
        },
        visitScheduleProposal: {
          create: visitScheduleProposalCreateMock,
          findMany: visitScheduleProposalFindManyMock,
          updateMany: visitScheduleProposalUpdateManyMock,
        },
        visitScheduleOverride: {
          findFirst: visitScheduleOverrideFindFirstMock,
          create: visitScheduleOverrideCreateMock,
          update: visitScheduleOverrideUpdateMock,
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

  it('returns a sanitized no-store 500 when reschedule auth lookup fails unexpectedly', async () => {
    requireAuthContextMock.mockRejectedValueOnce(
      new Error('患者 山田花子 090-1234-5678 raw reschedule auth detail'),
    );

    const response = await POST(
      createRequest(
        {
          reason: '患者都合で変更',
          reason_code: 'patient_request',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'schedule_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田花子');
    expect(JSON.stringify(body)).not.toContain('090-1234-5678');
    expect(JSON.stringify(body)).not.toContain('raw reschedule auth detail');
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(generateVisitScheduleProposalDraftsMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleOverrideCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it.each([
    'completed',
    'cancelled',
    'postponed',
    'rescheduled',
    'no_show',
    'ready',
    'departed',
    'in_progress',
  ] as const)('rejects %s schedules before reschedule side effects', async (scheduleStatus) => {
    visitScheduleFindFirstMock.mockResolvedValue(
      buildSchedule({
        time_window_start: null,
        time_window_end: null,
        schedule_status: scheduleStatus,
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
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(visitScheduleCountMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    expect(visitScheduleOverrideCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects non-object reschedule payloads before loading the source schedule', async () => {
    const response = await POST(createRequest(['緊急案件対応'], { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(visitScheduleCountMock).not.toHaveBeenCalled();
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

  it('rejects malformed JSON reschedule payloads before loading the source schedule', async () => {
    const response = await POST(createMalformedJsonRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(visitScheduleCountMock).not.toHaveBeenCalled();
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

  it('rejects blank schedule ids before parsing or loading the source schedule', async () => {
    const response = await POST(
      createRequest(
        {
          reason: '緊急案件対応',
          reason_code: 'patient_request',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: '   ' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '訪問予定IDが不正です',
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
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

  it('rejects invalid calendar start_date values before loading the source schedule', async () => {
    const response = await POST(
      createRequest(
        {
          reason: '患者都合で変更',
          reason_code: 'patient_request',
          start_date: '2026-02-30',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'schedule_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
      details: {
        start_date: ['日付形式が不正です（YYYY-MM-DD）'],
      },
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
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
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(generateVisitScheduleProposalDraftsMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      caseId: 'case_1',
      visitType: 'regular',
      priority: 'urgent',
      candidateCount: 3,
      startDate: new Date('2026-03-28'),
      preferredTimeFrom: '09:00',
      preferredTimeTo: '10:00',
      preferredPharmacistId: 'user_1',
      vehicleResourceId: 'vehicle_1',
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
      preferredPharmacistId: 'user_1',
      vehicleResourceId: 'vehicle_2',
      rescheduleSourceScheduleId: 'schedule_2',
    });
    expect(visitScheduleCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        pharmacist_id: 'user_1',
        scheduled_date: new Date('2026-03-27T00:00:00.000Z'),
        schedule_status: {
          in: ['planned', 'in_preparation'],
        },
        id: { not: 'schedule_1' },
      },
    });
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          pharmacist_id: 'user_1',
          schedule_status: {
            in: ['planned', 'in_preparation'],
          },
        }),
      }),
    );
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'schedule_1',
        org_id: 'org_1',
        version: 4,
        schedule_status: { in: ['planned', 'in_preparation'] },
      },
      data: {
        version: { increment: 1 },
      },
    });
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        case_id: 'case_1',
        vehicle_resource_id: 'vehicle_1',
        reschedule_source_schedule_id: 'schedule_1',
        proposal_reason: '担当者不在のため再配置 / リスケ理由: 緊急訪問が割り込んだため',
      }),
    });
    expect(visitScheduleProposalCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        case_id: 'case_2',
        vehicle_resource_id: 'vehicle_2',
        reschedule_source_schedule_id: 'schedule_2',
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
            impacted_patient_ids: ['patient_2'],
            preferred_pharmacist_id: 'user_1',
            requested_vehicle_resource_id: 'vehicle_1',
            current_vehicle_resource_id: 'vehicle_1',
            vehicle_reassignment_mode: 'preserve_current',
            request_intent_key: expect.stringMatching(/^visit-reschedule:v1:[a-f0-9]{64}$/),
          }),
        }),
      }),
    );
    expect(JSON.stringify(visitScheduleOverrideCreateMock.mock.calls)).not.toContain('佐藤次郎');
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
          preferred_pharmacist_id: 'user_1',
          requested_vehicle_resource_id: 'vehicle_1',
          current_vehicle_resource_id: 'vehicle_1',
          vehicle_reassignment_mode: 'preserve_current',
        }),
      }),
    });
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: { source: 'visit_schedules_reschedule_request', schedule_id: 'schedule_1' },
    });
  });

  it('skips impacted emergency reschedule side effects when the impacted schedule state changes', async () => {
    visitScheduleUpdateManyMock.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({
      count: 0,
    });

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
    expect(visitScheduleUpdateManyMock).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'schedule_2',
        org_id: 'org_1',
        version: 2,
        schedule_status: { in: ['planned', 'in_preparation'] },
      },
      data: {
        version: { increment: 1 },
      },
    });
    expect(visitScheduleProposalCreateMock).toHaveBeenCalledTimes(1);
    expect(visitScheduleProposalCreateMock).not.toHaveBeenCalledWith({
      data: expect.objectContaining({ reschedule_source_schedule_id: 'schedule_2' }),
    });
    expect(visitScheduleProposalUpdateManyMock).not.toHaveBeenCalled();
    expect(visitScheduleOverrideCreateMock).toHaveBeenCalledTimes(1);
    expect(visitScheduleOverrideCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source_schedule_id: 'schedule_1',
          impact_summary: expect.objectContaining({
            auto_reschedule_summary: [
              expect.objectContaining({
                schedule_id: 'schedule_2',
                patient_id: 'patient_2',
                status: 'skipped_state_changed',
                proposal_ids: [],
              }),
            ],
          }),
        }),
      }),
    );
  });

  it('audits reused cancelled impacted overrides during emergency auto-rescheduling', async () => {
    visitScheduleFindManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
      buildImpactedSchedule({
        override_request: {
          id: 'override_impacted_cancelled',
          status: 'cancelled',
          requested_by: 'old_impact_user',
          requested_at: new Date('2026-03-22T01:02:03.000Z'),
          approved_by: 'old_impact_admin',
          approved_at: new Date('2026-03-22T04:05:06.000Z'),
          replacement_schedule_id: 'schedule_impact_replacement',
          updated_at: new Date('2026-03-23T07:08:09.000Z'),
        },
      }),
    ]);

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
    expect(visitScheduleOverrideUpdateMock).toHaveBeenCalledWith({
      where: { id: 'override_impacted_cancelled' },
      data: expect.objectContaining({
        status: 'pending',
        reason: '緊急訪問割込みの影響で再調整が必要です（差込予定ID: schedule_1）',
        requested_by: 'user_1',
        approved_by: null,
        approved_at: null,
        replacement_schedule_id: null,
      }),
    });
    expect(visitScheduleOverrideCreateMock).toHaveBeenCalledTimes(1);
    expect(visitScheduleOverrideCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source_schedule_id: 'schedule_1' }),
      }),
    );
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'visit_schedule_reschedule_requested',
        changes: expect.objectContaining({
          reused_cancelled_impacted_overrides: [
            {
              id: 'override_impacted_cancelled',
              schedule_id: 'schedule_2',
              patient_id: 'patient_2',
              proposal_ids: ['proposal_2'],
              previous_status: 'cancelled',
              previous_requested_by: 'old_impact_user',
              previous_requested_at: '2026-03-22T01:02:03.000Z',
              previous_approved_by: 'old_impact_admin',
              previous_approved_at: '2026-03-22T04:05:06.000Z',
              previous_replacement_schedule_id: 'schedule_impact_replacement',
              previous_updated_at: '2026-03-23T07:08:09.000Z',
            },
          ],
        }),
      }),
    });
    expect(JSON.stringify(auditLogCreateMock.mock.calls)).not.toContain('佐藤次郎');
  });

  it('skips in-flight impacted schedules during emergency insert auto-rescheduling', async () => {
    visitScheduleFindManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
      buildImpactedSchedule({
        id: 'schedule_departed',
        case_id: 'case_departed',
        schedule_status: 'departed',
      }),
      buildImpactedSchedule({
        id: 'schedule_in_progress',
        case_id: 'case_in_progress',
        schedule_status: 'in_progress',
      }),
    ]);

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
    expect(generateVisitScheduleProposalDraftsMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ rescheduleSourceScheduleId: 'schedule_departed' }),
    );
    expect(generateVisitScheduleProposalDraftsMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ rescheduleSourceScheduleId: 'schedule_in_progress' }),
    );
    expect(visitScheduleProposalCreateMock).toHaveBeenCalledTimes(1);
    expect(visitScheduleProposalCreateMock).not.toHaveBeenCalledWith({
      data: expect.objectContaining({
        reschedule_source_schedule_id: 'schedule_departed',
      }),
    });
    expect(visitScheduleProposalCreateMock).not.toHaveBeenCalledWith({
      data: expect.objectContaining({
        reschedule_source_schedule_id: 'schedule_in_progress',
      }),
    });
    expect(visitScheduleOverrideCreateMock).toHaveBeenCalledTimes(1);
    expect(visitScheduleOverrideCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        source_schedule_id: 'schedule_1',
        impact_summary: expect.objectContaining({
          impacted_schedule_count: 0,
          auto_reschedule_summary: [],
        }),
      }),
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'visit_schedule_reschedule_requested',
        changes: expect.objectContaining({
          proposals: ['proposal_1'],
        }),
      }),
    });
  });

  it('returns existing pending reschedule proposals on success retry without side effects', async () => {
    visitScheduleOverrideFindFirstMock.mockResolvedValueOnce({
      id: 'override_existing',
      status: 'pending',
      impact_summary: {
        request_intent_key: buildExpectedRescheduleRequestIntentKey(),
      },
      after_snapshot: [
        {
          proposal_id: 'proposal_existing',
          proposed_date: '2026-03-28T00:00:00.000Z',
        },
      ],
    });
    visitScheduleProposalFindManyMock.mockResolvedValueOnce([
      {
        id: 'proposal_existing',
        org_id: 'org_1',
        case_id: 'case_1',
        proposed_date: new Date('2026-03-28T00:00:00.000Z'),
        proposed_pharmacist_id: 'pharmacist_2',
        reschedule_source_schedule_id: 'schedule_1',
      },
    ]);

    const response = await POST(
      createRequest(
        {
          reason: '患者都合で変更',
          reason_code: 'patient_request',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'schedule_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        proposals: [
          {
            id: 'proposal_existing',
            reschedule_source_schedule_id: 'schedule_1',
          },
        ],
        reused_existing: true,
      },
    });
    expect(visitScheduleOverrideFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        source_schedule_id: 'schedule_1',
        status: 'pending',
      },
      select: {
        id: true,
        after_snapshot: true,
        impact_summary: true,
      },
    });
    expect(visitScheduleProposalFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: { in: ['proposal_existing'] },
        reschedule_source_schedule_id: 'schedule_1',
        proposal_status: {
          in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
        },
        finalized_schedule_id: null,
      },
    });
    expect(generateVisitScheduleProposalDraftsMock).not.toHaveBeenCalled();
    expect(visitScheduleCountMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    expect(visitScheduleOverrideCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('keeps stale pending reschedule overrides with no open proposals as conflicts', async () => {
    visitScheduleOverrideFindFirstMock.mockResolvedValueOnce({
      id: 'override_existing',
      status: 'pending',
      impact_summary: {
        request_intent_key: buildExpectedRescheduleRequestIntentKey(),
      },
      after_snapshot: [
        {
          proposal_id: 'proposal_rejected',
          proposed_date: '2026-03-28T00:00:00.000Z',
        },
      ],
    });
    visitScheduleProposalFindManyMock.mockResolvedValueOnce([]);

    const response = await POST(
      createRequest(
        {
          reason: '患者都合で変更',
          reason_code: 'patient_request',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'schedule_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'この訪問予定には既にリスケ要求があります。再読み込みしてください',
    });
    expect(visitScheduleProposalFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: { in: ['proposal_rejected'] },
        reschedule_source_schedule_id: 'schedule_1',
        proposal_status: {
          in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
        },
        finalized_schedule_id: null,
      },
    });
    expect(generateVisitScheduleProposalDraftsMock).not.toHaveBeenCalled();
    expect(visitScheduleCountMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    expect(visitScheduleOverrideCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('keeps different pending reschedule intents as conflicts', async () => {
    visitScheduleOverrideFindFirstMock.mockResolvedValueOnce({
      id: 'override_existing',
      status: 'pending',
      impact_summary: {
        request_intent_key: 'visit-reschedule:v1:different-intent',
      },
      after_snapshot: [
        {
          proposal_id: 'proposal_existing',
          proposed_date: '2026-03-28T00:00:00.000Z',
        },
      ],
    });

    const response = await POST(
      createRequest(
        {
          reason: '患者都合で変更',
          reason_code: 'patient_request',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'schedule_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'この訪問予定には既にリスケ要求があります。再読み込みしてください',
    });
    expect(generateVisitScheduleProposalDraftsMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    expect(visitScheduleOverrideCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('reuses a cancelled reschedule override instead of creating a duplicate source override', async () => {
    visitScheduleOverrideFindFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'override_cancelled',
      status: 'cancelled',
      requested_by: 'old_user',
      requested_at: new Date('2026-03-20T01:02:03.000Z'),
      approved_by: 'old_admin',
      approved_at: new Date('2026-03-20T04:05:06.000Z'),
      replacement_schedule_id: 'schedule_old_replacement',
      updated_at: new Date('2026-03-21T07:08:09.000Z'),
    });

    const response = await POST(
      createRequest(
        {
          reason: '患者都合で変更',
          reason_code: 'patient_request',
          communication_channel: 'phone',
          communication_result: 'pending',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'schedule_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(visitScheduleProposalUpdateManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        reschedule_source_schedule_id: 'schedule_1',
        proposal_status: {
          in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
        },
        finalized_schedule_id: null,
      },
      data: {
        proposal_status: 'superseded',
      },
    });
    expect(visitScheduleOverrideUpdateMock).toHaveBeenCalledWith({
      where: { id: 'override_cancelled' },
      data: expect.objectContaining({
        status: 'pending',
        reason: '患者都合で変更',
        requested_by: 'user_1',
        approved_by: null,
        approved_at: null,
        replacement_schedule_id: null,
        impact_summary: expect.objectContaining({
          request_intent_key: expect.stringMatching(/^visit-reschedule:v1:[a-f0-9]{64}$/),
          proposed_replacements: 1,
        }),
        after_snapshot: [
          expect.objectContaining({
            proposal_id: 'proposal_1',
          }),
        ],
      }),
    });
    expect(visitScheduleOverrideCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'visit_schedule_reschedule_requested',
        changes: expect.objectContaining({
          superseded_previous_reschedule_proposal_count: 1,
          reused_cancelled_override: {
            id: 'override_cancelled',
            previous_status: 'cancelled',
            previous_requested_by: 'old_user',
            previous_requested_at: '2026-03-20T01:02:03.000Z',
            previous_approved_by: 'old_admin',
            previous_approved_at: '2026-03-20T04:05:06.000Z',
            previous_replacement_schedule_id: 'schedule_old_replacement',
            previous_updated_at: '2026-03-21T07:08:09.000Z',
          },
        }),
      }),
    });
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        dedupeKey: 'visit-reschedule-approval:schedule_1',
      }),
    );
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: { source: 'visit_schedules_reschedule_request', schedule_id: 'schedule_1' },
    });
  });

  it('returns conflict without durable side effects when the source schedule changes during reschedule request', async () => {
    visitScheduleUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await POST(
      createRequest(
        {
          reason: '患者都合で変更',
          reason_code: 'patient_request',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'schedule_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '訪問予定が同時に更新されました。再読み込みしてください',
    });
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledTimes(1);
    expect(visitScheduleCountMock).not.toHaveBeenCalled();
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

  it('retries the reschedule creation transaction after a Serializable route-order conflict', async () => {
    const defaultWithOrgContext = withOrgContextMock.getMockImplementation();
    if (!defaultWithOrgContext) throw new Error('withOrgContext mock implementation is required');
    withOrgContextMock
      .mockImplementationOnce(defaultWithOrgContext)
      .mockRejectedValueOnce(buildSerializableConflictError());
    visitScheduleProposalFindManyMock.mockResolvedValueOnce([
      {
        proposed_date: new Date('2026-03-28T00:00:00.000Z'),
        proposed_pharmacist_id: 'pharmacist_2',
        route_order: 2,
        reschedule_source_schedule_id: 'schedule_other',
      },
    ]);

    const response = await POST(
      createRequest(
        {
          reason: '患者都合で変更',
          reason_code: 'patient_request',
          start_date: '2026-03-28',
          priority: 'urgent',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'schedule_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(withOrgContextMock).toHaveBeenCalledTimes(3);
    expect(withOrgContextMock).toHaveBeenNthCalledWith(2, 'org_1', expect.any(Function), {
      requestContext: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(withOrgContextMock).toHaveBeenNthCalledWith(3, 'org_1', expect.any(Function), {
      requestContext: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(visitScheduleProposalFindManyMock).toHaveBeenCalledTimes(1);
    expect(visitScheduleProposalCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        case_id: 'case_1',
        proposed_pharmacist_id: 'pharmacist_2',
        proposed_date: new Date('2026-03-28T00:00:00.000Z'),
        route_order: 3,
        reschedule_source_schedule_id: 'schedule_1',
      }),
    });
    expect(visitScheduleOverrideCreateMock).toHaveBeenCalledTimes(1);
  });

  it('allows reschedule requests to prefer a substitute pharmacist and release the current vehicle for auto reassignment', async () => {
    const response = await POST(
      createRequest(
        {
          reason: '担当薬剤師が訪問できないため',
          reason_code: 'pharmacist_unavailable',
          preferred_pharmacist_id: 'pharmacist_backup',
          vehicle_resource_id: null,
          start_date: '2026-03-29',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'schedule_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(generateVisitScheduleProposalDraftsMock).toHaveBeenNthCalledWith(1, {
      orgId: 'org_1',
      caseId: 'case_1',
      visitType: 'regular',
      priority: 'normal',
      candidateCount: 3,
      startDate: new Date('2026-03-29'),
      preferredTimeFrom: '09:00',
      preferredTimeTo: '10:00',
      preferredPharmacistId: 'pharmacist_backup',
      vehicleResourceId: undefined,
      rescheduleSourceScheduleId: 'schedule_1',
    });
    expect(visitScheduleProposalCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        case_id: 'case_1',
        vehicle_resource_id: 'vehicle_1',
        reschedule_source_schedule_id: 'schedule_1',
      }),
    });
    expect(visitScheduleOverrideCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source_schedule_id: 'schedule_1',
          impact_summary: expect.objectContaining({
            preferred_pharmacist_id: 'pharmacist_backup',
            requested_vehicle_resource_id: null,
            current_vehicle_resource_id: 'vehicle_1',
            vehicle_reassignment_mode: 'auto',
          }),
        }),
      }),
    );
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changes: expect.objectContaining({
          reason_code: 'pharmacist_unavailable',
          preferred_pharmacist_id: 'pharmacist_backup',
          requested_vehicle_resource_id: null,
          current_vehicle_resource_id: 'vehicle_1',
          vehicle_reassignment_mode: 'auto',
        }),
      }),
    });
  });

  it('reallocates emergency impacted proposal route orders after other open proposals', async () => {
    visitScheduleProposalFindManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        proposed_date: new Date('2026-03-27T00:00:00.000Z'),
        proposed_pharmacist_id: 'pharmacist_1',
        route_order: 9,
        reschedule_source_schedule_id: 'schedule_2',
      },
      {
        proposed_date: new Date('2026-03-27T00:00:00.000Z'),
        proposed_pharmacist_id: 'pharmacist_1',
        route_order: 3,
        reschedule_source_schedule_id: 'schedule_other',
      },
    ]);

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
    expect(visitScheduleProposalFindManyMock).toHaveBeenNthCalledWith(2, {
      where: {
        org_id: 'org_1',
        finalized_schedule_id: null,
        proposal_status: {
          in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
        },
        route_order: { not: null },
        OR: [
          {
            proposed_pharmacist_id: 'pharmacist_1',
            proposed_date: new Date('2026-03-27T00:00:00.000Z'),
          },
        ],
      },
      select: {
        proposed_date: true,
        proposed_pharmacist_id: true,
        route_order: true,
        reschedule_source_schedule_id: true,
      },
    });
    expect(visitScheduleProposalCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        case_id: 'case_2',
        proposed_pharmacist_id: 'pharmacist_1',
        proposed_date: new Date('2026-03-27T00:00:00.000Z'),
        route_order: 4,
        reschedule_source_schedule_id: 'schedule_2',
      }),
    });
  });

  it('reallocates replacement proposal route orders after open proposal collisions', async () => {
    visitScheduleFindManyMock.mockResolvedValue([]);
    visitScheduleProposalFindManyMock.mockResolvedValue([
      {
        proposed_date: new Date('2026-03-28T00:00:00.000Z'),
        proposed_pharmacist_id: 'pharmacist_2',
        route_order: 2,
        reschedule_source_schedule_id: 'schedule_other',
      },
    ]);

    const response = await POST(
      createRequest(
        {
          reason: '患者都合で変更',
          reason_code: 'patient_request',
          start_date: '2026-03-28',
          priority: 'urgent',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'schedule_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(visitScheduleProposalFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        finalized_schedule_id: null,
        proposal_status: {
          in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
        },
        route_order: { not: null },
        OR: [
          {
            proposed_pharmacist_id: 'pharmacist_2',
            proposed_date: new Date('2026-03-28T00:00:00.000Z'),
          },
        ],
      },
      select: {
        proposed_date: true,
        proposed_pharmacist_id: true,
        route_order: true,
        reschedule_source_schedule_id: true,
      },
    });
    expect(visitScheduleProposalCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        case_id: 'case_1',
        proposed_pharmacist_id: 'pharmacist_2',
        proposed_date: new Date('2026-03-28T00:00:00.000Z'),
        route_order: 3,
        reschedule_source_schedule_id: 'schedule_1',
      }),
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
