import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

const {
  requireAuthContextMock,
  withOrgContextMock,
  proposalFindFirstMock,
  proposalFindManyMock,
  proposalUpdateMock,
  proposalUpdateManyMock,
  scheduleFindFirstMock,
  scheduleFindManyMock,
  scheduleCountMock,
  scheduleUpdateManyMock,
  scheduleCreateMock,
  pharmacistShiftFindFirstMock,
  vehicleResourceFindFirstMock,
  contactLogCreateMock,
  contactLogUpdateManyMock,
  auditLogCreateMock,
  auditLogFindFirstMock,
  overrideUpdateMock,
  evaluateVisitWorkflowGateMock,
  userFindManyMock,
  computeOptimizedVisitRouteMock,
  upsertOperationalTaskMock,
  resolveOperationalTasksMock,
  notifyWorkflowMutationMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  proposalFindFirstMock: vi.fn(),
  proposalFindManyMock: vi.fn(),
  proposalUpdateMock: vi.fn(),
  proposalUpdateManyMock: vi.fn(),
  scheduleFindFirstMock: vi.fn(),
  scheduleFindManyMock: vi.fn(),
  scheduleCountMock: vi.fn(),
  scheduleUpdateManyMock: vi.fn(),
  scheduleCreateMock: vi.fn(),
  pharmacistShiftFindFirstMock: vi.fn(),
  vehicleResourceFindFirstMock: vi.fn(),
  contactLogCreateMock: vi.fn(),
  contactLogUpdateManyMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  auditLogFindFirstMock: vi.fn(),
  overrideUpdateMock: vi.fn(),
  evaluateVisitWorkflowGateMock: vi.fn(),
  userFindManyMock: vi.fn(),
  computeOptimizedVisitRouteMock: vi.fn(),
  upsertOperationalTaskMock: vi.fn(),
  resolveOperationalTasksMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    visitScheduleProposal: {
      findFirst: proposalFindFirstMock,
      findMany: proposalFindManyMock,
    },
    visitSchedule: {
      findMany: scheduleFindManyMock,
      count: scheduleCountMock,
    },
    auditLog: {
      findFirst: auditLogFindFirstMock,
    },
    user: {
      findMany: userFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/management-plans', () => ({
  evaluateVisitWorkflowGate: evaluateVisitWorkflowGateMock,
  formatVisitWorkflowGateIssues: (issues: string[]) => issues.join(' / '),
}));

vi.mock('@/server/services/operational-tasks', () => ({
  upsertOperationalTask: upsertOperationalTaskMock,
  resolveOperationalTasks: resolveOperationalTasksMock,
}));

vi.mock('@/server/services/visit-route-engine', () => ({
  computeOptimizedVisitRoute: computeOptimizedVisitRouteMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

import { GET, PATCH } from './route';

function createRequest(body?: unknown, headers?: Record<string, string>) {
  if (body === undefined) {
    return new NextRequest('http://localhost/api/visit-schedule-proposals/proposal_1', {
      headers,
    });
  }
  return new NextRequest('http://localhost/api/visit-schedule-proposals/proposal_1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

function createMalformedJsonPatchRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/visit-schedule-proposals/proposal_1', {
    method: 'PATCH',
    body: '{"action":',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

function buildProposal(overrides?: Record<string, unknown>) {
  return {
    id: 'proposal_1',
    org_id: 'org_1',
    case_id: 'case_1',
    cycle_id: 'cycle_1',
    site_id: 'site_1',
    visit_type: 'regular',
    priority: 'normal',
    proposal_status: 'proposed',
    patient_contact_status: 'pending',
    proposed_date: new Date('2026-03-27T00:00:00.000Z'),
    time_window_start: new Date('1970-01-01T09:00:00.000Z'),
    time_window_end: new Date('1970-01-01T10:00:00.000Z'),
    proposed_pharmacist_id: 'pharmacist_1',
    assignment_mode: 'primary',
    route_order: 1,
    vehicle_resource_id: null,
    vehicle_resource: null,
    created_at: new Date('2026-03-26T09:00:00.000Z'),
    medication_end_date: new Date('2026-03-31T00:00:00.000Z'),
    visit_deadline_date: new Date('2026-03-30T00:00:00.000Z'),
    escalation_reason: null,
    suggested_recurrence_rule: null,
    finalized_schedule_id: null,
    reschedule_source_schedule_id: null,
    case_: {
      patient_id: 'patient_1',
      patient: {
        name: '患者A',
        residences: [
          {
            address: '東京都千代田区1-1-1',
            lat: 35.2,
            lng: 139.2,
          },
        ],
      },
    },
    ...overrides,
  };
}

function buildTxMock() {
  return {
    visitSchedule: {
      findFirst: scheduleFindFirstMock,
      findMany: scheduleFindManyMock,
      count: scheduleCountMock,
      updateMany: scheduleUpdateManyMock,
      create: scheduleCreateMock,
    },
    pharmacistShift: {
      findFirst: pharmacistShiftFindFirstMock,
    },
    visitVehicleResource: {
      findFirst: vehicleResourceFindFirstMock,
    },
    visitScheduleProposal: {
      findFirst: proposalFindFirstMock,
      update: proposalUpdateMock,
      updateMany: proposalUpdateManyMock,
    },
    visitScheduleContactLog: {
      create: contactLogCreateMock,
      updateMany: contactLogUpdateManyMock,
    },
    visitScheduleOverride: {
      update: overrideUpdateMock,
    },
    auditLog: {
      create: auditLogCreateMock,
    },
  };
}

function buildSerializableConflictError() {
  return new Prisma.PrismaClientKnownRequestError('Serializable transaction conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

describe('/api/visit-schedule-proposals/[id] PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    proposalFindFirstMock.mockResolvedValue(buildProposal());
    proposalFindManyMock.mockResolvedValue([]);
    proposalUpdateMock.mockResolvedValue({ id: 'proposal_1' });
    proposalUpdateManyMock.mockResolvedValue({ count: 1 });
    scheduleFindFirstMock.mockResolvedValue(null);
    scheduleFindManyMock.mockResolvedValue([]);
    scheduleCountMock.mockResolvedValue(0);
    scheduleUpdateManyMock.mockResolvedValue({ count: 1 });
    scheduleCreateMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      cycle_id: 'cycle_1',
      site_id: 'site_1',
      visit_type: 'regular',
      priority: 'normal',
      schedule_status: 'planned',
      scheduled_date: new Date('2026-03-27T00:00:00.000Z'),
      time_window_start: new Date('1970-01-01T09:00:00.000Z'),
      time_window_end: new Date('1970-01-01T10:00:00.000Z'),
      pharmacist_id: 'pharmacist_1',
      assignment_mode: 'primary',
      route_order: 1,
      confirmed_at: new Date('2026-03-26T10:00:00.000Z'),
      confirmed_by: 'user_1',
    });
    pharmacistShiftFindFirstMock.mockResolvedValue({
      site_id: 'site_1',
      available: true,
      available_from: new Date('1970-01-01T08:30:00.000Z'),
      available_to: new Date('1970-01-01T17:30:00.000Z'),
    });
    vehicleResourceFindFirstMock.mockResolvedValue({
      site_id: 'site_1',
      label: '社用車A',
      max_stops: 8,
    });
    contactLogCreateMock.mockResolvedValue({ id: 'contact_log_1' });
    contactLogUpdateManyMock.mockResolvedValue({ count: 1 });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    auditLogFindFirstMock.mockResolvedValue(null);
    overrideUpdateMock.mockResolvedValue({ id: 'override_1' });
    evaluateVisitWorkflowGateMock.mockResolvedValue({
      ok: true,
      issues: [],
      consentId: 'consent_1',
      managementPlanId: 'plan_1',
    });
    userFindManyMock.mockResolvedValue([
      { id: 'pharmacist_1', name: '薬剤師A', name_kana: 'ヤクザイシA' },
      { id: 'pharmacist_2', name: '薬剤師B', name_kana: 'ヤクザイシB' },
    ]);
    computeOptimizedVisitRouteMock.mockResolvedValue({
      status: 'ok',
      note: null,
      travelMode: 'DRIVE',
      origin: { lat: 35.1, lng: 139.1, label: '拠点A' },
      encodedPath: 'encoded',
      orderedScheduleIds: ['schedule_1', 'proposal:proposal_1'],
      totalDistanceMeters: 1200,
      totalDurationSeconds: 900,
      stopSummaries: [
        {
          scheduleId: 'schedule_1',
          optimizedOrder: 1,
          arrivalOffsetSeconds: 300,
          distanceFromPreviousMeters: 500,
          durationFromPreviousSeconds: 300,
        },
        {
          scheduleId: 'proposal:proposal_1',
          optimizedOrder: 2,
          arrivalOffsetSeconds: 900,
          distanceFromPreviousMeters: 700,
          durationFromPreviousSeconds: 600,
        },
      ],
    });

    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback(buildTxMock()));
  });

  it('returns proposal detail with related candidates and route preview', async () => {
    proposalFindFirstMock.mockResolvedValueOnce({
      ...buildProposal({
        created_at: new Date('2026-03-26T09:00:00.000Z'),
        reject_reason: '東京都港区2-2-2 090-1234-5678 アムロジピン 処方詳細',
        case_: {
          patient: {
            name: '患者A',
            residences: [
              {
                address: '東京都千代田区1-1-1',
                lat: 35.2,
                lng: 139.2,
              },
            ],
          },
        },
        site: {
          id: 'site_1',
          name: '拠点A',
          address: '東京都千代田区2-2-2',
          lat: 35.1,
          lng: 139.1,
        },
        vehicle_resource_id: 'vehicle_1',
        vehicle_resource: {
          id: 'vehicle_1',
          label: '社用車A',
          travel_mode: 'DRIVE',
          max_stops: 6,
          max_route_duration_minutes: 180,
        },
        contact_logs: [
          {
            id: 'log_1',
            outcome: 'attempted',
            contact_method: 'phone',
            contact_name: '本人',
            contact_phone: '090-0000-0000',
            note: '折返し待ち',
            callback_due_at: null,
            called_at: new Date('2026-03-26T10:00:00.000Z'),
            called_by: 'user_1',
          },
        ],
        finalized_schedule: null,
        reschedule_source_schedule: null,
      }),
    });
    proposalFindManyMock.mockResolvedValueOnce([
      {
        ...buildProposal({
          id: 'proposal_2',
          proposed_pharmacist_id: 'pharmacist_2',
          priority: 'emergency',
          reject_reason: '埼玉県川口市9-9-9 090-9999-9999 ワルファリン 処方詳細',
          route_distance_score: 3.5,
          proposed_date: new Date('2026-03-28T00:00:00.000Z'),
          case_: {
            patient: {
              name: '患者A',
              residences: [
                {
                  address: '東京都千代田区1-1-1',
                  lat: 35.2,
                  lng: 139.2,
                },
              ],
            },
          },
          site: {
            id: 'site_1',
            name: '拠点A',
            address: '東京都千代田区2-2-2',
            lat: 35.1,
            lng: 139.1,
          },
          vehicle_resource_id: 'vehicle_1',
          vehicle_resource: {
            id: 'vehicle_1',
            label: '社用車A',
            travel_mode: 'DRIVE',
            max_stops: 6,
            max_route_duration_minutes: 180,
          },
        }),
      },
    ]);
    scheduleFindManyMock.mockResolvedValueOnce([
      {
        id: 'schedule_1',
        visit_type: 'regular',
        priority: 'urgent',
        schedule_status: 'planned',
        route_order: 1,
        scheduled_date: new Date('2026-03-27T00:00:00.000Z'),
        time_window_start: new Date('1970-01-01T08:30:00.000Z'),
        time_window_end: new Date('1970-01-01T09:00:00.000Z'),
        case_: {
          patient: {
            name: '患者B',
            residences: [
              {
                address: '東京都港区3-3-3',
                lat: 35.3,
                lng: 139.3,
              },
            ],
          },
        },
        site: {
          id: 'site_1',
          name: '拠点A',
          address: '東京都千代田区2-2-2',
          lat: 35.1,
          lng: 139.1,
        },
        vehicle_resource: {
          id: 'vehicle_2',
          label: '社用車B',
          travel_mode: 'DRIVE',
          max_stops: 4,
          max_route_duration_minutes: 120,
        },
      },
    ]);

    const response = await GET(createRequest(undefined, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(computeOptimizedVisitRouteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        waypoints: expect.arrayContaining([
          expect.objectContaining({ scheduleId: 'schedule_1', priority: 'urgent' }),
          expect.objectContaining({ scheduleId: 'proposal:proposal_1', priority: 'normal' }),
          expect.objectContaining({ scheduleId: 'proposal:proposal_2', priority: 'emergency' }),
        ]),
      }),
    );
    const body = await response.json();
    expect(body).toMatchObject({
      data: expect.objectContaining({
        id: 'proposal_1',
        vehicle_resource: expect.objectContaining({ id: 'vehicle_1', label: '社用車A' }),
        related_proposals: [
          expect.objectContaining({
            id: 'proposal_2',
            vehicle_resource: expect.objectContaining({ id: 'vehicle_1', label: '社用車A' }),
          }),
        ],
        pharmacist_day_schedules: [
          expect.objectContaining({
            id: 'schedule_1',
            vehicle_resource: expect.objectContaining({ id: 'vehicle_2', label: '社用車B' }),
          }),
        ],
        creation_diagnostics: null,
        route_preview: expect.objectContaining({
          plan: expect.objectContaining({
            orderedScheduleIds: expect.arrayContaining(['schedule_1', 'proposal:proposal_1']),
          }),
          points: expect.arrayContaining([
            expect.objectContaining({ point_kind: 'proposal', schedule_id: 'proposal:proposal_1' }),
            expect.objectContaining({ point_kind: 'proposal', schedule_id: 'proposal:proposal_2' }),
          ]),
        }),
      }),
    });
    expect(body.data).not.toHaveProperty('reject_reason');
    expect(body.data.related_proposals[0]).not.toHaveProperty('reject_reason');
    expect(JSON.stringify(body)).not.toContain('東京都港区2-2-2');
    expect(JSON.stringify(body)).not.toContain('090-1234-5678');
    expect(JSON.stringify(body)).not.toContain('アムロジピン');
    expect(JSON.stringify(body)).not.toContain('埼玉県川口市9-9-9');
    expect(JSON.stringify(body)).not.toContain('090-9999-9999');
    expect(JSON.stringify(body)).not.toContain('ワルファリン');
  });

  it('scopes proposal detail, related proposals, and day schedules to assignment predicates', async () => {
    const response = await GET(createRequest(undefined, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(proposalFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'proposal_1',
          org_id: 'org_1',
          AND: [
            {
              OR: [
                { proposed_pharmacist_id: 'user_1' },
                { case_: { primary_pharmacist_id: 'user_1' } },
                { case_: { backup_pharmacist_id: 'user_1' } },
                { case_: { visit_schedules: { some: { pharmacist_id: 'user_1' } } } },
              ],
            },
          ],
        }),
      }),
    );
    expect(proposalFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            {
              OR: [
                { proposed_pharmacist_id: 'user_1' },
                { case_: { primary_pharmacist_id: 'user_1' } },
                { case_: { backup_pharmacist_id: 'user_1' } },
                { case_: { visit_schedules: { some: { pharmacist_id: 'user_1' } } } },
              ],
            },
          ],
        }),
      }),
    );
    expect(scheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
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
  });

  it('rejects blank proposal ids before detail lookups or route preview side effects', async () => {
    const response = await GET(createRequest(undefined, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '訪問候補IDが不正です',
    });
    expect(proposalFindFirstMock).not.toHaveBeenCalled();
    expect(proposalFindManyMock).not.toHaveBeenCalled();
    expect(scheduleFindManyMock).not.toHaveBeenCalled();
    expect(auditLogFindFirstMock).not.toHaveBeenCalled();
    expect(userFindManyMock).not.toHaveBeenCalled();
    expect(computeOptimizedVisitRouteMock).not.toHaveBeenCalled();
  });

  it('denies unassigned proposal detail before route planning or enrichment reads', async () => {
    proposalFindFirstMock.mockResolvedValueOnce(null);

    const response = await GET(createRequest(undefined, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(proposalFindManyMock).not.toHaveBeenCalled();
    expect(scheduleFindManyMock).not.toHaveBeenCalled();
    expect(auditLogFindFirstMock).not.toHaveBeenCalled();
    expect(userFindManyMock).not.toHaveBeenCalled();
    expect(computeOptimizedVisitRouteMock).not.toHaveBeenCalled();
  });

  it('returns persisted creation diagnostics when available', async () => {
    auditLogFindFirstMock.mockResolvedValueOnce({
      changes: {
        diagnostics: {
          accepted: [
            {
              pharmacist_id: 'pharmacist_1',
              pharmacist_name: '薬剤師A',
              site_id: 'site_1',
              site_name: '拠点A',
              proposed_date: '2026-03-27',
              travel_mode: 'DRIVE',
              route_order: 1,
              route_distance_score: 4.2,
              travel_summary: '実道路移動 約12分',
              assignment_mode: 'primary',
              care_relationship: 'primary',
              score: 8.5,
              score_breakdown: {
                geocodePenalty: 0,
                facilityBonus: 0,
                workloadPenalty: 2,
                slackPenalty: 0,
                lockPenalty: 0,
                cadencePenalty: 0,
              },
              time_window_start: '1970-01-01T09:00:00.000Z',
              time_window_end: '1970-01-01T10:00:00.000Z',
            },
          ],
          rejected: [],
        },
      },
    });

    const response = await GET(createRequest(undefined, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    await expect(response.json()).resolves.toMatchObject({
      data: expect.objectContaining({
        creation_diagnostics: expect.objectContaining({
          accepted: [expect.objectContaining({ pharmacist_name: '薬剤師A' })],
        }),
      }),
    });
  });

  it('rejects confirmation before approval and patient contact', async () => {
    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'この候補は承認後の電話確認を経てから確定してください',
    });
    expect(scheduleCreateMock).not.toHaveBeenCalled();
  });

  it('returns the finalized schedule when a confirmed proposal is retried', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'confirmed',
        patient_contact_status: 'confirmed',
        finalized_schedule_id: 'schedule_1',
        reject_reason: '東京都港区2-2-2 090-1234-5678 アムロジピン 処方詳細',
      }),
    );
    scheduleFindFirstMock.mockResolvedValueOnce({
      id: 'schedule_1',
      org_id: 'org_1',
      case_id: 'case_1',
    });

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        alreadyFinalized: true,
        proposal: {
          proposal_status: 'confirmed',
          finalized_schedule_id: 'schedule_1',
        },
        schedule: {
          id: 'schedule_1',
        },
      },
    });
    expect(body.data.proposal.reject_reason).toBeUndefined();
    expect(scheduleFindFirstMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'schedule_1',
        org_id: 'org_1',
        case_id: 'case_1',
      }),
    });
    expect(scheduleCreateMock).not.toHaveBeenCalled();
    expect(proposalUpdateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns a conflict when a finalized proposal points to an unavailable schedule', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'confirmed',
        patient_contact_status: 'confirmed',
        finalized_schedule_id: 'schedule_missing',
      }),
    );
    scheduleFindFirstMock.mockResolvedValueOnce(null);

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '確定済み訪問を取得できません。再読み込みしてください',
    });
    expect(scheduleCreateMock).not.toHaveBeenCalled();
    expect(proposalUpdateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects non-object patch payloads before loading the proposal', async () => {
    const response = await PATCH(createRequest([], { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(proposalFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(proposalUpdateMock).not.toHaveBeenCalled();
    expect(contactLogCreateMock).not.toHaveBeenCalled();
    expect(scheduleCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON patch payloads before loading the proposal', async () => {
    const response = await PATCH(createMalformedJsonPatchRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(proposalFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(proposalUpdateMock).not.toHaveBeenCalled();
    expect(contactLogCreateMock).not.toHaveBeenCalled();
    expect(scheduleCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['null', null],
  ])('rejects %s reject reasons before loading the proposal', async (_caseName, rejectReason) => {
    const response = await PATCH(
      createRequest({ action: 'reject', reject_reason: rejectReason }, { 'x-org-id': 'org_1' }),
      {
        params: Promise.resolve({ id: 'proposal_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
    });
    expect(proposalFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(proposalUpdateMock).not.toHaveBeenCalled();
    expect(contactLogCreateMock).not.toHaveBeenCalled();
    expect(scheduleCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('keeps legacy single reject requests compatible when no reject reason is provided', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'proposed',
        patient_contact_status: 'pending',
      }),
    );

    const response = await PATCH(createRequest({ action: 'reject' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(proposalUpdateMock).toHaveBeenCalledWith({
      where: { id: 'proposal_1' },
      data: {
        proposal_status: 'rejected',
        reject_reason: null,
      },
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changes: {
          proposal_status_from: 'proposed',
          proposal_status_to: 'rejected',
          patient_contact_status_from: 'pending',
          patient_contact_status_to: 'pending',
          reject_reason_recorded: false,
          reject_reason_storage: null,
          reject_reason_text_stored: false,
        },
      }),
    });
  });

  it('rejects blank proposal ids before parsing or mutating the proposal', async () => {
    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '訪問候補IDが不正です',
    });
    expect(proposalFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(proposalUpdateMock).not.toHaveBeenCalled();
    expect(proposalUpdateManyMock).not.toHaveBeenCalled();
    expect(scheduleFindFirstMock).not.toHaveBeenCalled();
    expect(scheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(scheduleCreateMock).not.toHaveBeenCalled();
    expect(contactLogCreateMock).not.toHaveBeenCalled();
    expect(contactLogUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(overrideUpdateMock).not.toHaveBeenCalled();
    expect(evaluateVisitWorkflowGateMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects malformed contact phone before loading the proposal', async () => {
    const response = await PATCH(
      createRequest(
        {
          action: 'contact_attempt',
          outcome: 'attempted',
          contact_method: 'phone',
          contact_phone: '090-ABCD-1234',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'proposal_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      details: {
        contact_phone: ['電話番号形式が不正です'],
      },
    });
    expect(proposalFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(proposalUpdateMock).not.toHaveBeenCalled();
    expect(contactLogCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('denies unassigned contact attempts before update, contact, audit, task, or notify side effects', async () => {
    proposalFindFirstMock.mockResolvedValueOnce(null);

    const response = await PATCH(
      createRequest(
        {
          action: 'contact_attempt',
          outcome: 'attempted',
          contact_method: 'phone',
          callback_due_at: '2026-03-30T09:00:00.000Z',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'proposal_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(proposalFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'proposal_1',
          org_id: 'org_1',
          AND: [
            {
              OR: [
                { proposed_pharmacist_id: 'user_1' },
                { case_: { primary_pharmacist_id: 'user_1' } },
                { case_: { backup_pharmacist_id: 'user_1' } },
                { case_: { visit_schedules: { some: { pharmacist_id: 'user_1' } } } },
              ],
            },
          ],
        }),
      }),
    );
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(proposalUpdateMock).not.toHaveBeenCalled();
    expect(contactLogCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('requires a confirmed phone result before finalizing the proposal', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'attempted',
      }),
    );

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '患者への電話確認結果を「確認済み」にしてから日時確定してください',
    });
    expect(scheduleCreateMock).not.toHaveBeenCalled();
  });

  it('records contact attempts and updates the proposal state', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'pending',
      }),
    );

    const response = await PATCH(
      createRequest(
        {
          action: 'contact_attempt',
          outcome: 'confirmed',
          contact_method: 'phone',
          contact_name: '本人',
          contact_phone: ' 090-0000-1111 ',
          note: '了承済み',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'proposal_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(contactLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        proposal_id: 'proposal_1',
        patient_id: 'patient_1',
        outcome: 'confirmed',
        contact_method: 'phone',
        contact_name: '本人',
        contact_phone: '090-0000-1111',
        note: '了承済み',
      }),
    });
    expect(proposalUpdateMock).toHaveBeenCalledWith({
      where: { id: 'proposal_1' },
      data: expect.objectContaining({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
      }),
    });
  });

  it('records change_requested outcomes as rejected proposals', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'pending',
      }),
    );

    const response = await PATCH(
      createRequest(
        {
          action: 'contact_attempt',
          outcome: 'change_requested',
          contact_method: 'email',
          note: '午前帯のみ希望',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'proposal_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(proposalUpdateMock).toHaveBeenCalledWith({
      where: { id: 'proposal_1' },
      data: expect.objectContaining({
        proposal_status: 'rejected',
        patient_contact_status: 'change_requested',
      }),
    });
    expect(resolveOperationalTasksMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        dedupeKey: 'visit-contact-followup:proposal_1',
        status: 'completed',
      }),
    );
  });

  it('clears stale callback tasks when an attempted contact no longer needs follow-up', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'pending',
      }),
    );

    const response = await PATCH(
      createRequest(
        {
          action: 'contact_attempt',
          outcome: 'attempted',
          contact_method: 'phone',
          note: '再架電不要',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'proposal_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        dedupeKey: 'visit-contact-followup:proposal_1',
        status: 'completed',
      }),
    );
  });

  it('creates a callback follow-up task when attempted contact includes a callback due date', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'pending',
      }),
    );

    const response = await PATCH(
      createRequest(
        {
          action: 'contact_attempt',
          outcome: 'attempted',
          contact_method: 'phone',
          note: '夕方に再架電',
          callback_due_at: '2026-03-30T09:00:00.000Z',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'proposal_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        taskType: 'visit_contact_followup',
        title: '患者への再架電が必要です',
        description: '夕方に再架電',
        assignedTo: 'pharmacist_1',
        dueDate: new Date('2026-03-30T09:00:00.000Z'),
        slaDueAt: new Date('2026-03-30T09:00:00.000Z'),
        dedupeKey: 'visit-contact-followup:proposal_1',
        relatedEntityType: 'visit_schedule_proposal',
        relatedEntityId: 'proposal_1',
        metadata: {
          case_id: 'case_1',
          patient_id: 'patient_1',
        },
      }),
    );
  });

  it('does not stamp patient contact metadata when rejecting before outreach starts', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'proposed',
        patient_contact_status: 'pending',
      }),
    );

    const response = await PATCH(
      createRequest(
        {
          action: 'reject',
          reject_reason: '  東京都港区2-2-2 090-1234-5678 アムロジピン 処方詳細  ',
        },
        { 'x-org-id': 'org_1' },
      ),
      {
        params: Promise.resolve({ id: 'proposal_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(proposalUpdateMock).toHaveBeenCalledWith({
      where: { id: 'proposal_1' },
      data: {
        proposal_status: 'rejected',
        reject_reason: '東京都港区2-2-2 090-1234-5678 アムロジピン 処方詳細',
      },
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'visit_schedule_proposal_rejected',
        changes: {
          proposal_status_from: 'proposed',
          proposal_status_to: 'rejected',
          patient_contact_status_from: 'pending',
          patient_contact_status_to: 'pending',
          reject_reason_recorded: true,
          reject_reason_length: '東京都港区2-2-2 090-1234-5678 アムロジピン 処方詳細'.length,
          reject_reason_storage: 'VisitScheduleProposal.reject_reason',
          reject_reason_text_stored: false,
        },
      }),
    });
    const auditPayload = JSON.stringify(auditLogCreateMock.mock.calls.at(-1)?.[0]);
    expect(auditPayload).not.toContain('東京都港区2-2-2');
    expect(auditPayload).not.toContain('090-1234-5678');
    expect(auditPayload).not.toContain('アムロジピン');
    expect(auditPayload).not.toContain('処方詳細');
  });

  it('finalizes the proposal into a confirmed visit and supersedes sibling drafts', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
        vehicle_resource_id: 'vehicle_1',
      }),
    );
    proposalUpdateMock.mockResolvedValueOnce(
      buildProposal({
        proposal_status: 'confirmed',
        patient_contact_status: 'confirmed',
        finalized_schedule_id: 'schedule_1',
        vehicle_resource_id: 'vehicle_1',
      }),
    );

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        alreadyFinalized: false,
        proposal: {
          proposal_status: 'confirmed',
          finalized_schedule_id: 'schedule_1',
        },
        schedule: {
          id: 'schedule_1',
        },
      },
    });
    expect(scheduleUpdateManyMock).toHaveBeenCalledOnce();
    expect(scheduleCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        case_id: 'case_1',
        pharmacist_id: 'pharmacist_1',
        schedule_status: 'planned',
        vehicle_resource_id: 'vehicle_1',
        confirmed_by: 'user_1',
      }),
    });
    expect(proposalUpdateManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        org_id: 'org_1',
        case_id: 'case_1',
        proposal_status: {
          in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
        },
        reschedule_source_schedule_id: null,
      }),
      data: {
        proposal_status: 'superseded',
      },
    });
    expect(proposalUpdateMock).toHaveBeenCalledWith({
      where: { id: 'proposal_1' },
      data: expect.objectContaining({
        proposal_status: 'confirmed',
        patient_contact_status: 'confirmed',
        finalized_schedule_id: 'schedule_1',
      }),
    });
    expect(contactLogUpdateManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        proposal_id: 'proposal_1',
        schedule_id: null,
      },
      data: {
        schedule_id: 'schedule_1',
      },
    });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('returns a conflict when the proposal state changes before the confirmation claim', async () => {
    proposalFindFirstMock
      .mockResolvedValueOnce(
        buildProposal({
          proposal_status: 'patient_contact_pending',
          patient_contact_status: 'confirmed',
          finalized_schedule_id: null,
        }),
      )
      .mockResolvedValueOnce({
        proposal_status: 'superseded',
        patient_contact_status: 'confirmed',
        finalized_schedule_id: null,
      });

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'この候補はすでに確定または変更されています。再読み込みしてください',
    });
    expect(scheduleCreateMock).not.toHaveBeenCalled();
    expect(proposalUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('retries serializable confirm conflicts and rejects when vehicle capacity is full on retry', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
        vehicle_resource_id: 'vehicle_1',
      }),
    );
    vehicleResourceFindFirstMock.mockResolvedValue({
      site_id: 'site_1',
      label: '社用車A',
      max_stops: 1,
    });
    scheduleCountMock.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    proposalUpdateManyMock.mockRejectedValueOnce(buildSerializableConflictError());

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '社用車A で訪問できる件数は最大 1 件です',
    });
    expect(withOrgContextMock).toHaveBeenCalledTimes(2);
    expect(withOrgContextMock).toHaveBeenNthCalledWith(1, 'org_1', expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(withOrgContextMock).toHaveBeenNthCalledWith(2, 'org_1', expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(scheduleCountMock).toHaveBeenCalledTimes(2);
    expect(proposalUpdateManyMock).toHaveBeenCalledTimes(1);
    expect(scheduleCreateMock).not.toHaveBeenCalled();
    expect(scheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('retries serializable confirm conflicts and recalculates route order from retry-time schedules', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
        route_order: 1,
      }),
    );
    scheduleFindManyMock
      .mockResolvedValueOnce([
        {
          route_order: 1,
        },
      ])
      .mockResolvedValueOnce([
        {
          route_order: 3,
        },
      ]);
    scheduleUpdateManyMock
      .mockRejectedValueOnce(buildSerializableConflictError())
      .mockResolvedValueOnce({ count: 1 });
    scheduleCreateMock.mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      route_order: 4,
    });
    proposalUpdateMock.mockResolvedValueOnce(
      buildProposal({
        proposal_status: 'confirmed',
        patient_contact_status: 'confirmed',
        finalized_schedule_id: 'schedule_1',
        route_order: 4,
      }),
    );

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(withOrgContextMock).toHaveBeenCalledTimes(2);
    expect(scheduleFindManyMock).toHaveBeenCalledTimes(2);
    expect(scheduleUpdateManyMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          route_order: {
            gte: 2,
          },
        }),
      }),
    );
    expect(scheduleUpdateManyMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          route_order: {
            gte: 4,
          },
        }),
      }),
    );
    expect(scheduleCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        route_order: 4,
      }),
    });
    expect(proposalUpdateMock).toHaveBeenCalledWith({
      where: { id: 'proposal_1' },
      data: expect.objectContaining({
        route_order: 4,
      }),
    });
    expect(notifyWorkflowMutationMock).toHaveBeenCalledTimes(1);
  });

  it('returns a conflict when serializable confirm conflicts exceed the retry limit', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
      }),
    );
    proposalUpdateManyMock.mockRejectedValue(buildSerializableConflictError());

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '訪問候補の確定が同時に更新されました。再読み込みしてください',
    });
    expect(withOrgContextMock).toHaveBeenCalledTimes(3);
    expect(scheduleCreateMock).not.toHaveBeenCalled();
    expect(proposalUpdateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('does not create a duplicate visit when another confirmation wins the claim race', async () => {
    proposalFindFirstMock
      .mockResolvedValueOnce(
        buildProposal({
          proposal_status: 'patient_contact_pending',
          patient_contact_status: 'confirmed',
          finalized_schedule_id: null,
        }),
      )
      .mockResolvedValueOnce({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
        finalized_schedule_id: null,
      })
      .mockResolvedValueOnce({
        proposal_status: 'confirmed',
        patient_contact_status: 'confirmed',
        finalized_schedule_id: 'schedule_existing',
      });
    proposalUpdateManyMock.mockResolvedValueOnce({ count: 0 });
    scheduleFindFirstMock.mockResolvedValueOnce({
      id: 'schedule_existing',
      org_id: 'org_1',
      case_id: 'case_1',
    });

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        schedule: {
          id: 'schedule_existing',
        },
        alreadyFinalized: true,
      },
    });
    expect(proposalUpdateManyMock).toHaveBeenCalledTimes(1);
    expect(proposalUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'proposal_1',
        org_id: 'org_1',
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
        finalized_schedule_id: null,
      },
      data: {
        confirmed_at: expect.any(Date),
        confirmed_by: 'user_1',
      },
    });
    expect(scheduleCreateMock).not.toHaveBeenCalled();
    expect(scheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(proposalUpdateMock).not.toHaveBeenCalled();
    expect(contactLogUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).toHaveBeenCalledTimes(1);
  });

  it('does not shift locked route orders when confirming a stale early proposal order', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
        priority: 'emergency',
        route_order: 1,
      }),
    );
    scheduleFindManyMock.mockResolvedValueOnce([
      {
        route_order: 1,
      },
    ]);

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(scheduleFindManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        org_id: 'org_1',
        pharmacist_id: 'pharmacist_1',
        scheduled_date: new Date('2026-03-27T00:00:00.000Z'),
        route_order: {
          not: null,
        },
        OR: [
          { confirmed_at: { not: null } },
          { schedule_status: { in: ['ready', 'departed', 'in_progress', 'completed'] } },
        ],
      }),
      select: {
        route_order: true,
      },
    });
    expect(scheduleUpdateManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        route_order: {
          gte: 2,
        },
      }),
      data: {
        route_order: {
          increment: 1,
        },
      },
    });
    expect(scheduleCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        route_order: 2,
      }),
    });
    expect(proposalUpdateMock).toHaveBeenCalledWith({
      where: { id: 'proposal_1' },
      data: expect.objectContaining({
        proposal_status: 'confirmed',
        route_order: 2,
      }),
    });
  });

  it('rejects proposal confirmation when the selected pharmacist shift is missing', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
      }),
    );
    pharmacistShiftFindFirstMock.mockResolvedValueOnce(null);

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '選択した薬剤師のシフトがありません',
    });
    expect(scheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(scheduleCreateMock).not.toHaveBeenCalled();
    expect(proposalUpdateMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ proposal_status: 'confirmed' }),
      }),
    );
  });

  it('rejects proposal confirmation when the selected pharmacist shift no longer covers the time window', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
      }),
    );
    pharmacistShiftFindFirstMock.mockResolvedValueOnce({
      site_id: 'site_1',
      available: true,
      available_from: new Date('1970-01-01T09:30:00.000Z'),
      available_to: new Date('1970-01-01T17:30:00.000Z'),
    });

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '訪問開始時刻が薬剤師シフトの開始前です',
    });
    expect(scheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(scheduleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects proposal confirmation when the selected vehicle resource is unavailable', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
        vehicle_resource_id: 'vehicle_1',
      }),
    );
    vehicleResourceFindFirstMock.mockResolvedValueOnce(null);

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '選択した車両リソースが見つからないか利用できません',
    });
    expect(scheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(scheduleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects proposal confirmation when the selected vehicle belongs to another site', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
        vehicle_resource_id: 'vehicle_2',
      }),
    );
    vehicleResourceFindFirstMock.mockResolvedValueOnce({
      site_id: 'site_2',
      label: '社用車B',
      max_stops: 8,
    });

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '選択した車両リソースは訪問予定の拠点では利用できません',
    });
    expect(scheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(scheduleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects proposal confirmation when the selected vehicle reaches same-day capacity after proposal generation', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
        vehicle_resource_id: 'vehicle_1',
      }),
    );
    vehicleResourceFindFirstMock.mockResolvedValueOnce({
      site_id: 'site_1',
      label: '社用車A',
      max_stops: 1,
    });
    scheduleCountMock.mockResolvedValueOnce(1);

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '社用車A で訪問できる件数は最大 1 件です',
    });
    expect(scheduleCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        vehicle_resource_id: 'vehicle_1',
        scheduled_date: new Date('2026-03-27T00:00:00.000Z'),
        schedule_status: {
          notIn: ['cancelled', 'rescheduled'],
        },
      },
    });
    expect(scheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(scheduleCreateMock).not.toHaveBeenCalled();
  });

  it('copies a suggested recurrence rule into the finalized visit schedule', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
        suggested_recurrence_rule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU',
      }),
    );

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(scheduleCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU',
      }),
    });
  });
});
