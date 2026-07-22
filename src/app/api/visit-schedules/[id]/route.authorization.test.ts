import {
  createPatchRequest,
  createRequest,
  expectSensitiveNoStore,
  visitScheduleRouteMocks,
} from './route.test-support';
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  auditLogCreateMock,
  authMock,
  membershipFindFirstMock,
  notifyWorkflowMutationMock,
  resolveOperationalTasksMock,
  validateOrgReferencesMock,
  visitScheduleFindFirstMock,
  visitScheduleOverrideFindManyMock,
  visitScheduleOverrideUpdateManyMock,
  visitScheduleProposalUpdateManyMock,
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

import { DELETE, PATCH } from './route';
describe('/api/visit-schedules/[id] GET', () => {
  it('returns a sanitized no-store 500 when patch auth plumbing fails before loading the schedule', async () => {
    authMock.mockRejectedValueOnce(
      new Error('raw patch auth patient 山田 花子 token secret schedule memo'),
    );

    const response = await PATCH(createPatchRequest({ schedule_status: 'in_progress' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('raw patch auth');
    expect(bodyText).not.toContain('山田 花子');
    expect(bodyText).not.toContain('token secret');
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('denies a trainee patch before parsing, loading, or mutating the schedule', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist_trainee' });

    const response = await PATCH(createPatchRequest({ route_order: 2 }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
      message: '訪問予定を更新する権限がありません',
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('denies a trainee before cancelling a schedule or related workflow side effects', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist_trainee' });

    const response = await DELETE(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
      message: '訪問予定を取消する権限がありません',
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(visitScheduleOverrideFindManyMock).not.toHaveBeenCalled();
    expect(visitScheduleOverrideUpdateManyMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('cancels a stale reschedule approval task even when no pending override remains', async () => {
    visitScheduleOverrideFindManyMock.mockResolvedValueOnce([]);

    const response = await DELETE(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const responseBody = await response.json();
    expect(responseBody).toMatchObject({ data: { id: 'schedule_1' } });
    expect(responseBody).not.toHaveProperty('id');
    expect(responseBody).not.toHaveProperty('schedule_status');
    expect(visitScheduleOverrideUpdateManyMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org_1',
      dedupeKey: 'visit-reschedule-approval:schedule_1',
      status: 'cancelled',
    });
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
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'visit_schedule_cancelled',
        changes: expect.objectContaining({
          cancelled_override_ids: [],
          cancelled_override_count: 0,
          cancelled_reschedule_approval_task_count: 1,
          superseded_reschedule_proposal_count: 1,
        }),
      }),
    });
  });

  it('rejects blank schedule ids before deleting the schedule', async () => {
    const response = await DELETE(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '訪問予定IDが不正です',
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('allows an admin to delete a schedule regardless of assignment', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      pharmacist_id: 'user_other',
      version: 1,
      schedule_status: 'planned',
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await DELETE(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'schedule_1', org_id: 'org_1', version: 1, schedule_status: 'planned' },
      data: { schedule_status: 'cancelled', version: { increment: 1 } },
    });
  });

  it.each(['completed', 'cancelled', 'postponed', 'rescheduled', 'no_show'] as const)(
    'rejects deleting %s schedules before cancellation side effects',
    async (scheduleStatus) => {
      visitScheduleFindFirstMock.mockResolvedValueOnce({
        id: 'schedule_1',
        pharmacist_id: 'user_1',
        version: 1,
        schedule_status: scheduleStatus,
        case_: {
          primary_pharmacist_id: 'user_primary',
          backup_pharmacist_id: null,
        },
      });

      const response = await DELETE(createRequest({ 'x-org-id': 'org_1' }), {
        params: Promise.resolve({ id: 'schedule_1' }),
      });

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(400);
      expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '終了済みまたは中止済みの訪問予定は取消できません',
      });
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
      expect(visitScheduleOverrideFindManyMock).not.toHaveBeenCalled();
      expect(visitScheduleOverrideUpdateManyMock).not.toHaveBeenCalled();
      expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
      expect(visitScheduleProposalUpdateManyMock).not.toHaveBeenCalled();
      expect(auditLogCreateMock).not.toHaveBeenCalled();
      expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
    },
  );

  it('returns conflict when delete loses a version race', async () => {
    visitScheduleUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await DELETE(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '訪問予定が同時に更新されました。再読み込みしてください',
    });
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'schedule_1', org_id: 'org_1', version: 1, schedule_status: 'planned' },
      data: { schedule_status: 'cancelled', version: { increment: 1 } },
    });
    expect(visitScheduleOverrideFindManyMock).not.toHaveBeenCalled();
    expect(visitScheduleOverrideUpdateManyMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalUpdateManyMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when delete auth plumbing fails before loading the schedule', async () => {
    authMock.mockRejectedValueOnce(
      new Error('raw delete auth patient 山田 花子 token secret schedule memo'),
    );

    const response = await DELETE(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('raw delete auth');
    expect(bodyText).not.toContain('山田 花子');
    expect(bodyText).not.toContain('token secret');
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when pending override cancellation fails', async () => {
    visitScheduleOverrideUpdateManyMock.mockRejectedValueOnce(
      new Error('raw override cancel patient 山田 花子 token secret'),
    );

    const response = await DELETE(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('raw override');
    expect(bodyText).not.toContain('山田 花子');
    expect(bodyText).not.toContain('token secret');
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when reschedule approval task cancellation fails', async () => {
    resolveOperationalTasksMock.mockRejectedValueOnce(
      new Error('raw approval task patient 山田 花子 token secret'),
    );

    const response = await DELETE(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('raw approval task');
    expect(bodyText).not.toContain('山田 花子');
    expect(bodyText).not.toContain('token secret');
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when delete audit logging fails', async () => {
    auditLogCreateMock.mockRejectedValueOnce(
      new Error('raw delete audit patient 山田 花子 token secret reason memo'),
    );

    const response = await DELETE(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('raw delete audit');
    expect(bodyText).not.toContain('山田 花子');
    expect(bodyText).not.toContain('token secret');
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('records the cancel reason in the audit log when the body provides one', async () => {
    const response = await DELETE(
      new NextRequest('http://localhost/api/visit-schedules/schedule_1', {
        method: 'DELETE',
        body: JSON.stringify({ reason_code: 'patient_request', reason_note: '家族から延期希望' }),
        headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
      }),
      { params: Promise.resolve({ id: 'schedule_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'visit_schedule_cancelled',
        target_type: 'VisitSchedule',
        target_id: 'schedule_1',
        changes: expect.objectContaining({
          reason_code: 'patient_request',
          reason_label: '患者都合',
          reason_note: '家族から延期希望',
          cancelled_override_ids: ['override_1'],
          cancelled_override_count: 1,
          cancelled_reschedule_approval_task_count: 1,
          superseded_reschedule_proposal_count: 1,
        }),
      }),
    });
  });

  it('still cancels without a body and logs an audit entry without a reason', async () => {
    const response = await DELETE(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'visit_schedule_cancelled',
        changes: expect.objectContaining({
          reason_code: null,
          reason_note: null,
          cancelled_override_ids: ['override_1'],
          cancelled_override_count: 1,
          cancelled_reschedule_approval_task_count: 1,
          superseded_reschedule_proposal_count: 1,
        }),
      }),
    });
  });

  it('rejects an unknown cancel reason code', async () => {
    const response = await DELETE(
      new NextRequest('http://localhost/api/visit-schedules/schedule_1', {
        method: 'DELETE',
        body: JSON.stringify({ reason_code: 'unknown_reason' }),
        headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
      }),
      { params: Promise.resolve({ id: 'schedule_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
  });
});
