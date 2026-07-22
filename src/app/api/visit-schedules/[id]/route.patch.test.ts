import {
  EXPECTED_PATCH_GUARD,
  createPatchRequest,
  expectSensitiveNoStore,
  expectUtcTimeDate,
  visitScheduleRouteMocks,
} from './route.test-support';
import { describe, expect, it, vi } from 'vitest';

const {
  auditLogCreateMock,
  careCaseFindFirstMock,
  evaluateReadyTransitionMock,
  notifyWorkflowMutationMock,
  pharmacistShiftFindFirstMock,
  validateOrgReferencesMock,
  visitScheduleFindFirstMock,
  visitScheduleTxFindFirstMock,
  visitScheduleUpdateManyMock,
  withOrgContextMock,
} = visitScheduleRouteMocks;

vi.mock('@/lib/audit/phi-read-audit', () => ({
  recordPhiReadAuditForRequest: visitScheduleRouteMocks.recordPhiReadAuditForRequestMock,
}));
vi.mock('@/lib/auth/config', () => ({
  auth: visitScheduleRouteMocks.authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: { findFirst: visitScheduleRouteMocks.membershipFindFirstMock },
    visitSchedule: {
      findFirst: visitScheduleRouteMocks.visitScheduleFindFirstMock,
      findMany: visitScheduleRouteMocks.visitScheduleFindManyMock,
      count: visitScheduleRouteMocks.visitScheduleCountMock,
    },
    visitScheduleProposal: {
      findFirst: visitScheduleRouteMocks.visitScheduleProposalFindFirstMock,
    },
    visitVehicleResource: { findFirst: visitScheduleRouteMocks.visitVehicleResourceFindFirstMock },
    visitPreparation: { findFirst: visitScheduleRouteMocks.visitPreparationFindFirstMock },
    pharmacistShift: { findFirst: visitScheduleRouteMocks.pharmacistShiftFindFirstMock },
    careCase: { findFirst: visitScheduleRouteMocks.careCaseFindFirstMock },
  },
}));

vi.mock('@/lib/db/rls', () => ({ withOrgContext: visitScheduleRouteMocks.withOrgContextMock }));
vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: visitScheduleRouteMocks.validateOrgReferencesMock,
}));
vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: visitScheduleRouteMocks.notifyWorkflowMutationMock,
}));
vi.mock('@/server/services/operational-tasks', () => ({
  resolveOperationalTasks: visitScheduleRouteMocks.resolveOperationalTasksMock,
}));
vi.mock('@/server/services/visit-preparation-readiness', () => ({
  evaluateVisitScheduleReadyTransition: visitScheduleRouteMocks.evaluateReadyTransitionMock,
  getVisitReadyTransitionErrorMessage: visitScheduleRouteMocks.getReadyTransitionErrorMessageMock,
  sanitizeVisitReadyTransitionDetails: visitScheduleRouteMocks.sanitizeReadyTransitionDetailsMock,
}));

import { PATCH } from './route';
describe('/api/visit-schedules/[id] GET', () => {
  it('allows an org-wide pharmacist to patch a schedule regardless of assignment', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      site_id: 'site_1',
      schedule_status: 'planned',
      scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
      time_window_start: null,
      time_window_end: null,
      confirmed_at: null,
      pharmacist_id: 'user_other',
      vehicle_resource_id: null,
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await PATCH(createPatchRequest({ schedule_status: 'in_progress' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(validateOrgReferencesMock).toHaveBeenCalled();
  });

  it('returns a non-enumerating validation error when the requested case is unavailable', async () => {
    careCaseFindFirstMock.mockResolvedValueOnce(null);

    const response = await PATCH(createPatchRequest({ case_id: 'case_unavailable' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
      details: {
        case_id: ['指定されたケースを確認できません'],
      },
    });
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      case_id: 'case_unavailable',
    });
    expect(pharmacistShiftFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('evaluates ready blockers for an org-wide pharmacist regardless of assignment', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      site_id: 'site_1',
      schedule_status: 'planned',
      scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
      time_window_start: null,
      time_window_end: null,
      confirmed_at: null,
      pharmacist_id: 'user_other',
      vehicle_resource_id: null,
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await PATCH(createPatchRequest({ schedule_status: 'ready' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(evaluateReadyTransitionMock).toHaveBeenCalled();
    expect(validateOrgReferencesMock).toHaveBeenCalled();
  });

  it('allows an assigned pharmacist to patch a schedule', async () => {
    const response = await PATCH(createPatchRequest({ schedule_status: 'in_progress' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const responseBody = await response.json();
    expect(responseBody).toMatchObject({
      data: {
        id: 'schedule_1',
        schedule_status: 'in_progress',
        version: 2,
      },
    });
    expect(responseBody).not.toHaveProperty('id');
    expect(responseBody).not.toHaveProperty('schedule_status');
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: EXPECTED_PATCH_GUARD,
        data: expect.objectContaining({
          schedule_status: 'in_progress',
          version: { increment: 1 },
        }),
      }),
    );
    expect(pharmacistShiftFindFirstMock).not.toHaveBeenCalled();
  });

  it('rejects stale patch requests before update side effects when expected status changed', async () => {
    const response = await PATCH(
      createPatchRequest({
        schedule_status: 'in_progress',
        expected_schedule_status: 'ready',
      }),
      {
        params: Promise.resolve({ id: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: {
        expected_schedule_status: 'ready',
        current_schedule_status: 'planned',
      },
    });
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('stores patched time windows as UTC @db.Time sentinel dates', async () => {
    visitScheduleTxFindFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      site_id: 'site_1',
      visit_type: 'regular',
      priority: 'normal',
      schedule_status: 'planned',
      scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
      time_window_start: new Date(Date.UTC(1970, 0, 1, 9, 30)),
      time_window_end: new Date(Date.UTC(1970, 0, 1, 10, 30)),
      route_order: 1,
      recurrence_rule: null,
      version: 2,
      confirmed_at: null,
      pharmacist_id: 'user_1',
      vehicle_resource_id: null,
    });

    const response = await PATCH(
      createPatchRequest({
        time_window_start: '09:30',
        time_window_end: '10:30',
      }),
      {
        params: Promise.resolve({ id: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const updated = visitScheduleUpdateManyMock.mock.calls[0][0].data;
    expectUtcTimeDate(updated.time_window_start, '09:30');
    expectUtcTimeDate(updated.time_window_end, '10:30');
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'visit_schedule_updated',
        target_type: 'VisitSchedule',
        target_id: 'schedule_1',
        changes: expect.objectContaining({
          time_window_start: { from: null, to: '09:30' },
          time_window_end: { from: null, to: '10:30' },
        }),
      }),
    });
  });

  it.each([
    {
      payload: { time_window_start: '09:30' },
      message: '終了時刻も入力してください',
      details: { time_window_end: ['終了時刻も入力してください'] },
    },
    {
      payload: { time_window_end: '10:30' },
      message: '開始時刻も入力してください',
      details: { time_window_start: ['開始時刻も入力してください'] },
    },
  ])('rejects target time windows with only one side before mutation', async (caseItem) => {
    const response = await PATCH(createPatchRequest(caseItem.payload), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: caseItem.message,
      details: caseItem.details,
    });
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('allows unrelated status updates on legacy one-sided time windows', async () => {
    const legacyStart = new Date(Date.UTC(1970, 0, 1, 9, 0));
    visitScheduleFindFirstMock.mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      cycle_id: 'cycle_1',
      visit_type: 'regular',
      priority: 'normal',
      schedule_status: 'planned',
      scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
      time_window_start: legacyStart,
      time_window_end: null,
      route_order: 1,
      recurrence_rule: null,
      version: 1,
      confirmed_at: null,
      pharmacist_id: 'user_1',
      site_id: 'site_1',
      vehicle_resource_id: null,
      visit_record: null,
      preparation: null,
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });
    visitScheduleTxFindFirstMock.mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      site_id: 'site_1',
      visit_type: 'regular',
      priority: 'normal',
      schedule_status: 'in_progress',
      scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
      time_window_start: legacyStart,
      time_window_end: null,
      route_order: 1,
      recurrence_rule: null,
      version: 2,
      confirmed_at: null,
      pharmacist_id: 'user_1',
      vehicle_resource_id: null,
    });

    const response = await PATCH(createPatchRequest({ schedule_status: 'in_progress' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(visitScheduleUpdateManyMock).toHaveBeenCalled();
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'visit_schedule_updated',
        changes: {
          schedule_status: { from: 'planned', to: 'in_progress' },
          request_trace: {
            request_id: expect.any(String),
            correlation_id: expect.any(String),
          },
        },
      }),
    });
  });

  it('does not update, audit, or notify when a patch has no effective changes', async () => {
    const response = await PATCH(createPatchRequest({ schedule_status: 'planned' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const responseBody = await response.json();
    expect(responseBody).toMatchObject({
      data: {
        id: 'schedule_1',
        schedule_status: 'planned',
        version: 1,
      },
    });
    expect(responseBody).not.toHaveProperty('id');
    expect(responseBody).not.toHaveProperty('schedule_status');
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects target time windows that become reversed after merging existing values', async () => {
    visitScheduleFindFirstMock.mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      cycle_id: 'cycle_1',
      visit_type: 'regular',
      priority: 'normal',
      schedule_status: 'planned',
      scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
      time_window_start: new Date(Date.UTC(1970, 0, 1, 11, 0)),
      time_window_end: new Date(Date.UTC(1970, 0, 1, 12, 0)),
      route_order: 1,
      recurrence_rule: null,
      version: 1,
      confirmed_at: null,
      pharmacist_id: 'user_1',
      site_id: 'site_1',
      vehicle_resource_id: null,
      visit_record: null,
      preparation: null,
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await PATCH(
      createPatchRequest({
        time_window_end: '10:30',
      }),
      {
        params: Promise.resolve({ id: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '終了時刻は開始時刻より後にしてください',
      details: {
        time_window_end: ['終了時刻は開始時刻より後にしてください'],
      },
    });
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });
});
