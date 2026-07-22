import {
  EXPECTED_PATCH_GUARD,
  buildSerializableConflictError,
  createMalformedJsonPatchRequest,
  createPatchRequest,
  expectSensitiveNoStore,
  visitScheduleRouteMocks,
} from './route.test-support';
import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const {
  auditLogCreateMock,
  notifyWorkflowMutationMock,
  validateOrgReferencesMock,
  visitScheduleFindFirstMock,
  visitScheduleProposalFindFirstMock,
  visitScheduleProposalTxFindFirstMock,
  visitScheduleTxFindFirstMock,
  visitScheduleUpdateManyMock,
  visitScheduleUpdateMock,
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
  it('rejects reversed time windows before loading or mutating the schedule', async () => {
    const response = await PATCH(
      createPatchRequest({
        time_window_start: '11:00',
        time_window_end: '10:00',
      }),
      {
        params: Promise.resolve({ id: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
      details: {
        time_window_end: ['終了時刻は開始時刻より後にしてください'],
      },
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects invalid calendar scheduled dates before loading or mutating the schedule', async () => {
    const response = await PATCH(createPatchRequest({ scheduled_date: '2026-02-30' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
      details: {
        scheduled_date: ['日付形式が不正です（YYYY-MM-DD）'],
      },
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects non-object patch payloads before loading the schedule', async () => {
    const response = await PATCH(createPatchRequest(['in_progress']), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects blank schedule ids before loading or updating the schedule', async () => {
    const response = await PATCH(createPatchRequest({ schedule_status: 'in_progress' }), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '訪問予定IDが不正です',
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects route_order changes for confirmed visits before conflict checks', async () => {
    visitScheduleFindFirstMock.mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      cycle_id: 'cycle_1',
      visit_type: 'regular',
      priority: 'normal',
      schedule_status: 'planned',
      scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
      time_window_start: null,
      time_window_end: null,
      route_order: 1,
      recurrence_rule: null,
      version: 1,
      confirmed_at: new Date('2026-03-25T12:00:00.000Z'),
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

    const response = await PATCH(createPatchRequest({ route_order: 2 }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '電話確定済みの訪問予定は順路を変更できません',
    });
    expect(visitScheduleProposalFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects route_order changes that conflict within the same pharmacist day', async () => {
    const response = await PATCH(createPatchRequest({ route_order: 2 }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '同一薬剤師・同一日付で route_order は重複できません',
    });
    expect(visitScheduleFindFirstMock).toHaveBeenLastCalledWith({
      where: {
        org_id: 'org_1',
        id: { not: 'schedule_1' },
        pharmacist_id: 'user_1',
        scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
        route_order: 2,
        schedule_status: { notIn: ['cancelled', 'rescheduled'] },
      },
      select: { id: true },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects route_order changes that conflict with an open proposal in the same pharmacist day', async () => {
    visitScheduleFindFirstMock
      .mockResolvedValueOnce({
        id: 'schedule_1',
        case_id: 'case_1',
        cycle_id: 'cycle_1',
        visit_type: 'regular',
        priority: 'normal',
        schedule_status: 'planned',
        scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
        time_window_start: null,
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
      })
      .mockResolvedValueOnce(null);
    visitScheduleProposalFindFirstMock.mockResolvedValueOnce({ id: 'proposal_1' });

    const response = await PATCH(createPatchRequest({ route_order: 2 }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '同一薬剤師・同一日付で route_order は重複できません',
    });
    expect(visitScheduleProposalFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        proposed_pharmacist_id: 'user_1',
        proposed_date: new Date('2026-03-26T00:00:00.000Z'),
        route_order: 2,
        finalized_schedule_id: null,
        proposal_status: {
          in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
        },
      },
      select: { id: true },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it.each(['cancelled', 'rescheduled'] as const)(
    'rejects route_order changes for %s schedules before conflict checks',
    async (scheduleStatus) => {
      visitScheduleFindFirstMock.mockResolvedValueOnce({
        id: 'schedule_1',
        case_id: 'case_1',
        cycle_id: 'cycle_1',
        visit_type: 'regular',
        schedule_status: scheduleStatus,
        scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
        time_window_start: null,
        time_window_end: null,
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

      const response = await PATCH(createPatchRequest({ route_order: 1 }), {
        params: Promise.resolve({ id: 'schedule_1' }),
      });

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '終了済みまたは中止済みの訪問予定は変更できません',
      });
      expect(visitScheduleFindFirstMock).toHaveBeenCalledTimes(1);
      expect(visitScheduleProposalFindFirstMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
      expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
      expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
    },
  );

  it('rechecks route_order conflicts inside the update transaction', async () => {
    visitScheduleFindFirstMock
      .mockResolvedValueOnce({
        id: 'schedule_1',
        case_id: 'case_1',
        cycle_id: 'cycle_1',
        visit_type: 'regular',
        schedule_status: 'planned',
        scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
        time_window_start: null,
        time_window_end: null,
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
      })
      .mockResolvedValueOnce(null);
    visitScheduleTxFindFirstMock.mockResolvedValueOnce({ id: 'schedule_2' });

    const response = await PATCH(createPatchRequest({ route_order: 2 }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '同一薬剤師・同一日付で route_order は重複できません',
    });
    expect(visitScheduleTxFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: { not: 'schedule_1' },
        pharmacist_id: 'user_1',
        scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
        route_order: 2,
        schedule_status: { notIn: ['cancelled', 'rescheduled'] },
      },
      select: { id: true },
    });
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rechecks open proposal route_order conflicts inside the update transaction', async () => {
    visitScheduleFindFirstMock
      .mockResolvedValueOnce({
        id: 'schedule_1',
        case_id: 'case_1',
        cycle_id: 'cycle_1',
        visit_type: 'regular',
        priority: 'normal',
        schedule_status: 'planned',
        scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
        time_window_start: null,
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
      })
      .mockResolvedValueOnce(null);
    visitScheduleProposalFindFirstMock.mockResolvedValueOnce(null);
    visitScheduleTxFindFirstMock.mockResolvedValueOnce(null);
    visitScheduleProposalTxFindFirstMock.mockResolvedValueOnce({ id: 'proposal_1' });

    const response = await PATCH(createPatchRequest({ route_order: 2 }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '同一薬剤師・同一日付で route_order は重複できません',
    });
    expect(visitScheduleProposalTxFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        proposed_pharmacist_id: 'user_1',
        proposed_date: new Date('2026-03-26T00:00:00.000Z'),
        route_order: 2,
        finalized_schedule_id: null,
        proposal_status: {
          in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
        },
      },
      select: { id: true },
    });
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns conflict when the schedule version changes before PATCH write', async () => {
    visitScheduleUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await PATCH(createPatchRequest({ schedule_status: 'in_progress' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '訪問予定が同時に更新されました。再読み込みしてください',
    });
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: EXPECTED_PATCH_GUARD,
      }),
    );
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns conflict when a locked-field PATCH loses a confirmation race', async () => {
    visitScheduleUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await PATCH(createPatchRequest({ scheduled_date: '2026-03-27' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '訪問予定が同時に更新されました。再読み込みしてください',
    });
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: EXPECTED_PATCH_GUARD,
      }),
    );
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('retries serializable route_order PATCH conflicts and succeeds', async () => {
    visitScheduleFindFirstMock
      .mockResolvedValueOnce({
        id: 'schedule_1',
        case_id: 'case_1',
        cycle_id: 'cycle_1',
        visit_type: 'regular',
        priority: 'normal',
        schedule_status: 'planned',
        scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
        time_window_start: null,
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
      })
      .mockResolvedValueOnce(null);
    visitScheduleTxFindFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      site_id: 'site_1',
      visit_type: 'regular',
      priority: 'normal',
      schedule_status: 'planned',
      scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
      time_window_start: null,
      time_window_end: null,
      route_order: 2,
      recurrence_rule: null,
      version: 2,
      confirmed_at: null,
      pharmacist_id: 'user_1',
      vehicle_resource_id: null,
    });
    withOrgContextMock.mockImplementationOnce(async () => {
      throw buildSerializableConflictError();
    });

    const response = await PATCH(createPatchRequest({ route_order: 2 }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(withOrgContextMock).toHaveBeenCalledTimes(2);
    expect(withOrgContextMock).toHaveBeenNthCalledWith(
      1,
      'org_1',
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }),
    );
    expect(withOrgContextMock).toHaveBeenNthCalledWith(
      2,
      'org_1',
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }),
    );
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: EXPECTED_PATCH_GUARD,
        data: expect.objectContaining({
          route_order: 2,
          version: { increment: 1 },
        }),
      }),
    );
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'visit_schedule_updated',
        changes: expect.objectContaining({
          route_order: { from: 1, to: 2 },
        }),
      }),
    });
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: { source: 'visit_schedules_update', schedule_id: 'schedule_1' },
    });
  });

  it('returns conflict when serializable route_order PATCH conflicts exceed retry limit', async () => {
    visitScheduleFindFirstMock
      .mockResolvedValueOnce({
        id: 'schedule_1',
        case_id: 'case_1',
        cycle_id: 'cycle_1',
        visit_type: 'regular',
        schedule_status: 'planned',
        scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
        time_window_start: null,
        time_window_end: null,
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
      })
      .mockResolvedValueOnce(null);
    withOrgContextMock.mockRejectedValue(buildSerializableConflictError());

    const response = await PATCH(createPatchRequest({ route_order: 2 }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'route_order の反映対象が同時に更新されました。再読み込みしてください',
    });
    expect(withOrgContextMock).toHaveBeenCalledTimes(3);
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects zero route_order values before loading the schedule', async () => {
    const response = await PATCH(createPatchRequest({ route_order: 0 }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON patch payloads before loading the schedule', async () => {
    const response = await PATCH(createMalformedJsonPatchRequest(), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });
});
