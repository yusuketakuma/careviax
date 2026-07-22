import {
  EXPECTED_PATCH_GUARD,
  buildPatchScheduleFixture,
  createPatchRequest,
  visitScheduleRouteMocks,
} from './route.test-support';
import { describe, expect, it, vi } from 'vitest';

const {
  auditLogCreateMock,
  evaluateReadyTransitionMock,
  getReadyTransitionErrorMessageMock,
  membershipFindFirstMock,
  notifyWorkflowMutationMock,
  validateOrgReferencesMock,
  visitScheduleFindFirstMock,
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
  it('allows ready status only after the server-side readiness gate passes', async () => {
    const response = await PATCH(createPatchRequest({ schedule_status: 'ready' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(evaluateReadyTransitionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        visitSchedule: expect.objectContaining({
          updateMany: visitScheduleUpdateManyMock,
          update: visitScheduleUpdateMock,
        }),
      }),
      {
        orgId: 'org_1',
        scheduleId: 'schedule_1',
      },
    );
    expect(evaluateReadyTransitionMock.mock.invocationCallOrder[0]).toBeLessThan(
      visitScheduleUpdateManyMock.mock.invocationCallOrder[0],
    );
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: EXPECTED_PATCH_GUARD,
        data: expect.objectContaining({
          schedule_status: 'ready',
          pre_visit_checklist_completed: true,
          version: { increment: 1 },
        }),
      }),
    );
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: { source: 'visit_schedules_update', schedule_id: 'schedule_1' },
    });
  });

  it('rejects ready status when server-side readiness blockers remain', async () => {
    const details = {
      readiness_blockers: [],
      onboarding_blockers: [{ key: 'management_plan_approved', label: '管理計画未承認' }],
      billing_blockers: [
        {
          evidence_id: 'billing_1',
          visit_record_id: 'visit_record_1',
          key: 'missing_management_plan',
          reason: '算定根拠が未確認',
          action_href: '/billing',
          action_label: '算定根拠を確認',
          severity: 'high',
        },
      ],
    };
    evaluateReadyTransitionMock.mockResolvedValueOnce({ ok: false, details });

    const response = await PATCH(createPatchRequest({ schedule_status: 'ready' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '訪問準備に未解決の止まっている理由があるため ready へ進めません',
      details: {
        readiness_blockers: [],
        onboarding_blockers: [{ key: 'management_plan_approved', label: '管理計画未承認' }],
        billing_blockers: [
          {
            key: 'missing_management_plan',
            reason: '算定根拠が未確認',
            action_label: '算定根拠を確認',
            severity: 'high',
          },
        ],
      },
    });
    expect(body.details.billing_blockers[0]).not.toHaveProperty('evidence_id');
    expect(body.details.billing_blockers[0]).not.toHaveProperty('visit_record_id');
    expect(body.details.billing_blockers[0]).not.toHaveProperty('action_href');
    expect(getReadyTransitionErrorMessageMock).toHaveBeenCalledWith(details);
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {});
    expect(withOrgContextMock).toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it.each(['departed', 'in_progress', 'completed'] as const)(
    'rejects %s status when server-side readiness blockers remain',
    async (scheduleStatus) => {
      const details = {
        readiness_blockers: ['オフライン同期確認'],
        onboarding_blockers: [],
        billing_blockers: [],
      };
      evaluateReadyTransitionMock.mockResolvedValueOnce({ ok: false, details });
      getReadyTransitionErrorMessageMock.mockReturnValueOnce(
        '訪問準備チェックリストが未完了のため ready へ進めません',
      );

      const response = await PATCH(createPatchRequest({ schedule_status: scheduleStatus }), {
        params: Promise.resolve({ id: 'schedule_1' }),
      });

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '訪問準備チェックリストが未完了のため ready へ進めません',
        details,
      });
      expect(evaluateReadyTransitionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          visitSchedule: expect.objectContaining({
            updateMany: visitScheduleUpdateManyMock,
            update: visitScheduleUpdateMock,
          }),
        }),
        { orgId: 'org_1', scheduleId: 'schedule_1' },
      );
      expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
      expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
    },
  );

  it('rejects ready-gated status changes when the case is changed in the same patch', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await PATCH(
      createPatchRequest({ schedule_status: 'ready', case_id: 'case_2' }),
      {
        params: Promise.resolve({ id: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'ready 系ステータスへ進める更新ではケース変更を同時に行えません',
    });
    expect(evaluateReadyTransitionMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects case changes while the current schedule is already ready-gated', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    visitScheduleFindFirstMock.mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      schedule_status: 'ready',
      confirmed_at: null,
      pharmacist_id: 'user_1',
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await PATCH(createPatchRequest({ case_id: 'case_2' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'ready 系ステータスへ進める更新ではケース変更を同時に行えません',
    });
    expect(evaluateReadyTransitionMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects case changes from ready-gated schedules even when status is downgraded', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    visitScheduleFindFirstMock.mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      schedule_status: 'ready',
      confirmed_at: null,
      pharmacist_id: 'user_1',
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await PATCH(
      createPatchRequest({ schedule_status: 'planned', case_id: 'case_2' }),
      {
        params: Promise.resolve({ id: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'ready 系ステータスへ進める更新ではケース変更を同時に行えません',
    });
    expect(evaluateReadyTransitionMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects visit-date changes in the same patch as a ready-gated status transition', async () => {
    const response = await PATCH(
      createPatchRequest({ schedule_status: 'ready', scheduled_date: '2026-05-01' }),
      {
        params: Promise.resolve({ id: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'ready 系ステータスへ進める更新では訪問日変更を同時に行えません',
    });
    expect(evaluateReadyTransitionMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects visit-date changes while the current schedule is already ready-gated', async () => {
    visitScheduleFindFirstMock.mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      schedule_status: 'in_progress',
      confirmed_at: null,
      pharmacist_id: 'user_1',
      site_id: 'site_1',
      vehicle_resource_id: null,
      scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
      time_window_start: null,
      time_window_end: null,
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await PATCH(createPatchRequest({ scheduled_date: '2026-05-01' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'ready 系ステータスへ進める更新では訪問日変更を同時に行えません',
    });
    expect(evaluateReadyTransitionMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects visit-date changes from ready-gated schedules even when status is downgraded', async () => {
    visitScheduleFindFirstMock.mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      schedule_status: 'departed',
      confirmed_at: null,
      pharmacist_id: 'user_1',
      site_id: 'site_1',
      vehicle_resource_id: null,
      scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
      time_window_start: null,
      time_window_end: null,
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await PATCH(
      createPatchRequest({ schedule_status: 'planned', scheduled_date: '2026-05-01' }),
      {
        params: Promise.resolve({ id: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'ready 系ステータスへ進める更新では訪問日変更を同時に行えません',
    });
    expect(evaluateReadyTransitionMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects moving terminal schedules back to ready-gated statuses', async () => {
    visitScheduleFindFirstMock.mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      schedule_status: 'completed',
      confirmed_at: null,
      pharmacist_id: 'user_1',
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await PATCH(createPatchRequest({ schedule_status: 'ready' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '終了済みまたは中止済みの訪問予定は ready 系ステータスへ戻せません',
    });
    expect(evaluateReadyTransitionMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it.each(['completed', 'cancelled'] as const)(
    'rejects reopening %s schedules through generic PATCH',
    async (scheduleStatus) => {
      visitScheduleFindFirstMock.mockResolvedValueOnce(
        buildPatchScheduleFixture({ schedule_status: scheduleStatus }),
      );

      const response = await PATCH(createPatchRequest({ schedule_status: 'planned' }), {
        params: Promise.resolve({ id: 'schedule_1' }),
      });

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '終了済みまたは中止済みの訪問予定は変更できません',
      });
      expect(evaluateReadyTransitionMock).not.toHaveBeenCalled();
      expect(validateOrgReferencesMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
      expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
      expect(auditLogCreateMock).not.toHaveBeenCalled();
      expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
    },
  );

  it.each(['completed', 'cancelled', 'postponed', 'rescheduled', 'no_show'] as const)(
    'rejects %s schedule mutations through generic PATCH',
    async (scheduleStatus) => {
      visitScheduleFindFirstMock.mockResolvedValueOnce(
        buildPatchScheduleFixture({ schedule_status: scheduleStatus }),
      );

      const response = await PATCH(createPatchRequest({ priority: 'urgent' }), {
        params: Promise.resolve({ id: 'schedule_1' }),
      });

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '終了済みまたは中止済みの訪問予定は変更できません',
      });
      expect(validateOrgReferencesMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
      expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
      expect(auditLogCreateMock).not.toHaveBeenCalled();
      expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
    },
  );

  it('keeps no-op PATCH responses available for terminal schedules', async () => {
    const completedSchedule = buildPatchScheduleFixture({ schedule_status: 'completed' });
    visitScheduleFindFirstMock
      .mockResolvedValueOnce(completedSchedule)
      .mockResolvedValueOnce(completedSchedule);

    const response = await PATCH(createPatchRequest({ schedule_status: 'completed' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('allows active schedules to transition to cancelled through generic PATCH', async () => {
    const cancelledSchedule = buildPatchScheduleFixture({
      schedule_status: 'cancelled',
      version: 2,
    });
    visitScheduleTxFindFirstMock.mockResolvedValueOnce(cancelledSchedule);

    const response = await PATCH(createPatchRequest({ schedule_status: 'cancelled' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: EXPECTED_PATCH_GUARD,
        data: expect.objectContaining({
          schedule_status: 'cancelled',
          version: { increment: 1 },
        }),
      }),
    );
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'visit_schedule_updated',
        target_type: 'VisitSchedule',
        target_id: 'schedule_1',
        changes: {
          schedule_status: { from: 'planned', to: 'cancelled' },
          request_trace: {
            request_id: expect.any(String),
            correlation_id: expect.any(String),
          },
        },
      }),
    });
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: { source: 'visit_schedules_update', schedule_id: 'schedule_1' },
    });
  });
});
