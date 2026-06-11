import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

const {
  authMock,
  membershipFindFirstMock,
  visitScheduleFindFirstMock,
  visitScheduleTxFindFirstMock,
  visitScheduleCountMock,
  visitScheduleUpdateManyMock,
  visitScheduleUpdateMock,
  visitVehicleResourceFindFirstMock,
  pharmacistShiftFindFirstMock,
  visitPreparationFindFirstMock,
  careCaseFindFirstMock,
  validateOrgReferencesMock,
  notifyWorkflowMutationMock,
  evaluateReadyTransitionMock,
  getReadyTransitionErrorMessageMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  visitScheduleFindFirstMock: vi.fn(),
  visitScheduleTxFindFirstMock: vi.fn(),
  visitScheduleCountMock: vi.fn(),
  visitScheduleUpdateManyMock: vi.fn(),
  visitScheduleUpdateMock: vi.fn(),
  visitVehicleResourceFindFirstMock: vi.fn(),
  pharmacistShiftFindFirstMock: vi.fn(),
  visitPreparationFindFirstMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
  evaluateReadyTransitionMock: vi.fn(),
  getReadyTransitionErrorMessageMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    visitSchedule: {
      findFirst: visitScheduleFindFirstMock,
      count: visitScheduleCountMock,
    },
    visitVehicleResource: {
      findFirst: visitVehicleResourceFindFirstMock,
    },
    visitPreparation: {
      findFirst: visitPreparationFindFirstMock,
    },
    pharmacistShift: {
      findFirst: pharmacistShiftFindFirstMock,
    },
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

vi.mock('@/server/services/visit-preparation-readiness', () => ({
  evaluateVisitScheduleReadyTransition: evaluateReadyTransitionMock,
  getVisitReadyTransitionErrorMessage: getReadyTransitionErrorMessageMock,
}));

import { DELETE, GET, PATCH } from './route';

const EXPECTED_PATCH_GUARD = {
  id: 'schedule_1',
  org_id: 'org_1',
  version: 1,
  confirmed_at: null,
  pharmacist_id: 'user_1',
  scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
  schedule_status: 'planned',
};

function buildSerializableConflictError() {
  return new Prisma.PrismaClientKnownRequestError('Serializable transaction conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

function createRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/visit-schedules/schedule_1', { headers });
}

function createPatchRequest(
  body: unknown,
  headers: Record<string, string> = { 'x-org-id': 'org_1' },
) {
  return new NextRequest('http://localhost/api/visit-schedules/schedule_1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

function createMalformedJsonPatchRequest(
  headers: Record<string, string> = { 'x-org-id': 'org_1' },
) {
  return new NextRequest('http://localhost/api/visit-schedules/schedule_1', {
    method: 'PATCH',
    body: '{"schedule_status":',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

describe('/api/visit-schedules/[id] GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    validateOrgReferencesMock.mockResolvedValue({ ok: true, data: {} });
    notifyWorkflowMutationMock.mockResolvedValue(undefined);
    evaluateReadyTransitionMock.mockResolvedValue({ ok: true });
    getReadyTransitionErrorMessageMock.mockReturnValue(
      '訪問準備に未解決のブロッカーがあるため ready へ進めません',
    );
    visitScheduleUpdateManyMock.mockResolvedValue({ count: 1 });
    visitScheduleUpdateMock.mockResolvedValue({ id: 'schedule_1', schedule_status: 'in_progress' });
    visitScheduleCountMock.mockResolvedValue(0);
    visitVehicleResourceFindFirstMock.mockResolvedValue({
      id: 'vehicle_1',
      site_id: 'site_1',
      label: '社用車A',
      max_stops: 8,
    });
    pharmacistShiftFindFirstMock.mockResolvedValue({
      site_id: 'site_1',
      available: true,
      available_from: new Date('1970-01-01T09:00:00.000Z'),
      available_to: new Date('1970-01-01T18:00:00.000Z'),
    });
    visitPreparationFindFirstMock.mockResolvedValue({
      medication_changes_reviewed: true,
      carry_items_confirmed: true,
      previous_issues_reviewed: true,
      route_confirmed: true,
      offline_synced: true,
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findFirst: visitScheduleTxFindFirstMock,
          updateMany: visitScheduleUpdateManyMock,
          update: visitScheduleUpdateMock,
        },
      }),
    );
    visitScheduleTxFindFirstMock.mockImplementation(async (args) => {
      if (args?.where?.id?.not) return null;
      return { id: 'schedule_1', schedule_status: 'in_progress', version: 2 };
    });
    visitScheduleFindFirstMock.mockResolvedValue({
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
    });
    careCaseFindFirstMock.mockResolvedValue({
      patient_id: 'patient_1',
      patient: {
        scheduling_preference: null,
        residences: [{ facility: null }],
      },
    });
  });

  it('returns the patient_id derived from the scheduled case', async () => {
    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: 'schedule_1',
      case_id: 'case_1',
      cycle_id: 'cycle_1',
      patient_id: 'patient_1',
    });
  });

  it('rejects blank schedule ids before loading schedule details', async () => {
    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '訪問予定IDが不正です',
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
  });

  it('returns 403 when a pharmacist reads a schedule they are not assigned to', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      cycle_id: 'cycle_1',
      visit_type: 'regular',
      scheduled_date: '2026-03-26',
      confirmed_at: null,
      pharmacist_id: 'user_other',
      visit_record: null,
      preparation: null,
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
  });

  it('returns 403 when a pharmacist patches a schedule they are not assigned to', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      confirmed_at: null,
      pharmacist_id: 'user_other',
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await PATCH(createPatchRequest({ schedule_status: 'in_progress' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('does not evaluate ready blockers before assignment access passes', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      confirmed_at: null,
      pharmacist_id: 'user_other',
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await PATCH(createPatchRequest({ schedule_status: 'ready' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expect(evaluateReadyTransitionMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('allows an assigned pharmacist to patch a schedule', async () => {
    const response = await PATCH(createPatchRequest({ schedule_status: 'in_progress' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
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
      message: '訪問準備に未解決のブロッカーがあるため ready へ進めません',
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

  it('assigns selected vehicle resources during schedule PATCH', async () => {
    const response = await PATCH(createPatchRequest({ vehicle_resource_id: 'vehicle_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(visitVehicleResourceFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: 'vehicle_1',
        available: true,
      },
      select: {
        id: true,
        site_id: true,
        label: true,
        max_stops: true,
      },
    });
    expect(visitScheduleCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: { not: 'schedule_1' },
        pharmacist_id: 'user_1',
        scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
        schedule_status: {
          notIn: ['cancelled', 'rescheduled'],
        },
      },
    });
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          vehicle_resource_id: 'vehicle_1',
        }),
      }),
    );
  });

  it('rejects schedule PATCH when the selected vehicle belongs to another site', async () => {
    visitVehicleResourceFindFirstMock.mockResolvedValueOnce({
      id: 'vehicle_2',
      site_id: 'site_2',
      label: '別拠点車両',
      max_stops: 8,
    });

    const response = await PATCH(createPatchRequest({ vehicle_resource_id: 'vehicle_2' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '選択した車両リソースは訪問予定の拠点では利用できません',
    });
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('revalidates an existing vehicle resource when moving schedule date', async () => {
    careCaseFindFirstMock.mockResolvedValueOnce({
      patient: {
        scheduling_preference: null,
        residences: [{ facility: null }],
      },
    });
    visitScheduleFindFirstMock.mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      confirmed_at: null,
      pharmacist_id: 'user_1',
      site_id: 'site_1',
      vehicle_resource_id: 'vehicle_1',
      scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
      time_window_start: null,
      time_window_end: null,
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await PATCH(createPatchRequest({ scheduled_date: '2026-03-27' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(visitVehicleResourceFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'vehicle_1' }),
      }),
    );
    expect(visitScheduleCountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          scheduled_date: new Date('2026-03-27'),
        }),
      }),
    );
  });

  it('rejects schedule date changes when the selected pharmacist has no shift', async () => {
    pharmacistShiftFindFirstMock.mockResolvedValueOnce(null);

    const response = await PATCH(createPatchRequest({ scheduled_date: '2026-03-27' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '選択した薬剤師のシフトがありません',
    });
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects schedule time changes outside the selected pharmacist shift', async () => {
    const response = await PATCH(
      createPatchRequest({
        time_window_start: '08:30',
        time_window_end: '09:30',
      }),
      {
        params: Promise.resolve({ id: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '訪問開始時刻が薬剤師シフトの開始前です',
    });
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects schedule date changes outside patient preferred weekdays', async () => {
    careCaseFindFirstMock.mockResolvedValueOnce({
      patient: {
        scheduling_preference: {
          preferred_weekdays: [4],
          preferred_time_from: null,
          preferred_time_to: null,
          facility_time_from: null,
          facility_time_to: null,
        },
        residences: [],
      },
    });

    const response = await PATCH(createPatchRequest({ scheduled_date: '2026-03-27' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '患者または施設の訪問希望曜日と一致しない日付です',
    });
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects schedule time changes outside patient and facility visit windows', async () => {
    careCaseFindFirstMock.mockResolvedValueOnce({
      patient: {
        scheduling_preference: {
          preferred_weekdays: [],
          preferred_time_from: new Date('1970-01-01T09:00:00.000Z'),
          preferred_time_to: new Date('1970-01-01T12:00:00.000Z'),
          facility_time_from: null,
          facility_time_to: null,
        },
        residences: [
          {
            facility: {
              acceptance_time_from: new Date('1970-01-01T10:00:00.000Z'),
              acceptance_time_to: new Date('1970-01-01T11:00:00.000Z'),
              regular_visit_weekdays: [],
            },
          },
        ],
      },
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
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '訪問開始時刻が患者または施設の希望開始時刻 10:00 より前です',
    });
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns 403 when an assigned pharmacist attempts to reassign case or pharmacist', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      confirmed_at: null,
      pharmacist_id: 'user_1',
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await PATCH(
      createPatchRequest({ case_id: 'case_other', pharmacist_id: 'user_other' }),
      {
        params: Promise.resolve({ id: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

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
      },
      select: { id: true },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

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

  it('returns 403 when a trainee deletes a schedule they are not assigned to', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist_trainee' });
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      pharmacist_id: 'user_other',
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await DELETE(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
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
    expect(visitScheduleUpdateMock).toHaveBeenCalledWith({
      where: { id: 'schedule_1' },
      data: { schedule_status: 'cancelled' },
    });
  });
});
