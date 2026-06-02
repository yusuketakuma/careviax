import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withOrgContextMock,
  proposalFindFirstMock,
  proposalFindManyMock,
  proposalUpdateMock,
  proposalUpdateManyMock,
  scheduleFindFirstMock,
  scheduleFindManyMock,
  scheduleUpdateManyMock,
  scheduleCreateMock,
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
  scheduleUpdateManyMock: vi.fn(),
  scheduleCreateMock: vi.fn(),
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
    proposalUpdateManyMock.mockResolvedValue({ count: 2 });
    scheduleFindFirstMock.mockResolvedValue(null);
    scheduleFindManyMock.mockResolvedValue([]);
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

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findFirst: scheduleFindFirstMock,
          updateMany: scheduleUpdateManyMock,
          create: scheduleCreateMock,
        },
        visitScheduleProposal: {
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
      }),
    );
  });

  it('returns proposal detail with related candidates and route preview', async () => {
    proposalFindFirstMock.mockResolvedValueOnce({
      ...buildProposal({
        created_at: new Date('2026-03-26T09:00:00.000Z'),
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
    await expect(response.json()).resolves.toMatchObject({
      data: expect.objectContaining({
        id: 'proposal_1',
        related_proposals: [expect.objectContaining({ id: 'proposal_2' })],
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

    const response = await PATCH(createRequest({ action: 'reject' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(proposalUpdateMock).toHaveBeenCalledWith({
      where: { id: 'proposal_1' },
      data: {
        proposal_status: 'rejected',
      },
    });
  });

  it('finalizes the proposal into a confirmed visit and supersedes sibling drafts', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
      }),
    );

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(scheduleUpdateManyMock).toHaveBeenCalledOnce();
    expect(scheduleCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        case_id: 'case_1',
        pharmacist_id: 'pharmacist_1',
        schedule_status: 'planned',
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
