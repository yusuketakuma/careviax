import {
  buildPatchScheduleFixture,
  createPatchRequest,
  visitScheduleRouteMocks,
} from './route.test-support';
import { describe, expect, it, vi } from 'vitest';

const {
  auditLogCreateMock,
  careCaseFindFirstMock,
  notifyWorkflowMutationMock,
  pharmacistShiftFindFirstMock,
  validateOrgReferencesMock,
  visitScheduleCountMock,
  visitScheduleFindFirstMock,
  visitScheduleFindManyMock,
  visitScheduleTxFindFirstMock,
  visitScheduleUpdateManyMock,
  visitScheduleUpdateMock,
  visitVehicleResourceFindFirstMock,
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
  it('assigns selected vehicle resources during schedule PATCH', async () => {
    visitScheduleTxFindFirstMock.mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      site_id: 'site_1',
      visit_type: 'regular',
      priority: 'normal',
      schedule_status: 'planned',
      scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
      time_window_start: null,
      time_window_end: null,
      route_order: 1,
      recurrence_rule: null,
      version: 2,
      confirmed_at: null,
      pharmacist_id: 'user_1',
      vehicle_resource_id: 'vehicle_1',
    });

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
        max_route_duration_minutes: true,
        travel_mode: true,
        site: {
          select: {
            address: true,
            lat: true,
            lng: true,
          },
        },
      },
    });
    expect(visitScheduleCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: { not: 'schedule_1' },
        vehicle_resource_id: 'vehicle_1',
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
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'visit_schedule_updated',
        target_type: 'VisitSchedule',
        target_id: 'schedule_1',
        changes: {
          vehicle_resource_id: { from: null, to: 'vehicle_1' },
          request_trace: {
            request_id: expect.any(String),
            correlation_id: expect.any(String),
          },
        },
      }),
    });
  });

  it('rejects vehicle assignment when the vehicle is full across other pharmacists', async () => {
    visitVehicleResourceFindFirstMock.mockResolvedValueOnce({
      id: 'vehicle_1',
      site_id: 'site_1',
      label: '社用車A',
      max_stops: 1,
    });
    visitScheduleCountMock.mockResolvedValueOnce(1);

    const response = await PATCH(createPatchRequest({ vehicle_resource_id: 'vehicle_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '社用車A で訪問できる件数は最大 1 件です',
    });
    expect(visitScheduleCountMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        org_id: 'org_1',
        id: { not: 'schedule_1' },
        vehicle_resource_id: 'vehicle_1',
      }),
    });
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects schedule PATCH when the selected vehicle route duration limit is exceeded', async () => {
    visitScheduleFindFirstMock.mockResolvedValueOnce(
      buildPatchScheduleFixture({
        vehicle_resource_id: 'vehicle_1',
        time_window_start: new Date('1970-01-01T09:00:00.000Z'),
        time_window_end: new Date('1970-01-01T10:00:00.000Z'),
        case_: {
          primary_pharmacist_id: 'user_primary',
          backup_pharmacist_id: null,
          patient: {
            residences: [
              {
                address: '候補患者宅',
                lat: 0,
                lng: 0.2,
              },
            ],
          },
        },
      }),
    );
    careCaseFindFirstMock.mockResolvedValueOnce({
      patient_id: 'patient_1',
      version: 7,
      patient: {
        scheduling_preference: null,
        residences: [
          {
            address: '候補患者宅',
            lat: 0,
            lng: 0.2,
            facility: null,
          },
        ],
      },
    });
    visitVehicleResourceFindFirstMock.mockResolvedValueOnce({
      id: 'vehicle_1',
      site_id: 'site_1',
      label: '社用車A',
      max_stops: 8,
      max_route_duration_minutes: 30,
      travel_mode: 'DRIVE',
      site: {
        address: '本店',
        lat: 0,
        lng: 0,
      },
    });
    visitScheduleFindManyMock.mockResolvedValueOnce([
      {
        route_order: 1,
        time_window_start: new Date('1970-01-01T09:00:00.000Z'),
        case_: {
          patient: {
            residences: [
              {
                address: '既存患者宅',
                lat: 0,
                lng: 0.1,
              },
            ],
          },
        },
      },
    ]);

    const response = await PATCH(
      createPatchRequest({ time_window_start: '10:00', time_window_end: '11:00' }),
      {
        params: Promise.resolve({ id: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('上限 30分を超えます'),
    });
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: { not: 'schedule_1' },
        vehicle_resource_id: 'vehicle_1',
        scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
        schedule_status: {
          notIn: ['cancelled', 'rescheduled'],
        },
      },
      select: {
        route_order: true,
        time_window_start: true,
        case_: {
          select: {
            patient: {
              select: {
                residences: {
                  where: { is_primary: true },
                  take: 1,
                  select: {
                    address: true,
                    lat: true,
                    lng: true,
                  },
                },
              },
            },
          },
        },
      },
      take: 9,
      orderBy: [{ route_order: 'asc' }, { time_window_start: 'asc' }, { id: 'asc' }],
    });
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rechecks selected vehicle stop limits inside the schedule PATCH transaction', async () => {
    visitVehicleResourceFindFirstMock.mockResolvedValue({
      id: 'vehicle_1',
      site_id: 'site_1',
      label: '社用車A',
      max_stops: 1,
    });
    visitScheduleCountMock.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    const response = await PATCH(createPatchRequest({ vehicle_resource_id: 'vehicle_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '社用車A で訪問できる件数は最大 1 件です',
    });
    expect(visitScheduleCountMock).toHaveBeenCalledTimes(2);
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('allows cancelling an over-capacity existing vehicle schedule without vehicle revalidation', async () => {
    visitVehicleResourceFindFirstMock.mockResolvedValue({
      id: 'vehicle_1',
      site_id: 'site_1',
      label: '社用車A',
      max_stops: 1,
    });
    visitScheduleCountMock.mockResolvedValue(99);
    visitScheduleFindFirstMock.mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      cycle_id: 'cycle_1',
      visit_type: 'regular',
      priority: 'normal',
      schedule_status: 'planned',
      scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
      time_window_start: new Date('1970-01-01T09:00:00.000Z'),
      time_window_end: new Date('1970-01-01T10:00:00.000Z'),
      route_order: 1,
      recurrence_rule: null,
      version: 1,
      confirmed_at: null,
      pharmacist_id: 'user_1',
      site_id: 'site_1',
      vehicle_resource_id: 'vehicle_1',
      visit_record: null,
      preparation: null,
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await PATCH(createPatchRequest({ schedule_status: 'cancelled' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(visitVehicleResourceFindFirstMock).not.toHaveBeenCalled();
    expect(visitScheduleCountMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          schedule_status: 'cancelled',
          version: { increment: 1 },
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
      schedule_status: 'planned',
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

  it('rejects schedule time changes that overlap an active schedule for the same pharmacist', async () => {
    visitScheduleTxFindFirstMock.mockResolvedValueOnce({ id: 'schedule_overlap' });

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
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '同一薬剤師・同一日付の訪問時間帯が既存予定と重複しています。再読み込みしてください',
    });
    expect(visitScheduleTxFindFirstMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        org_id: 'org_1',
        id: { not: 'schedule_1' },
        pharmacist_id: 'user_1',
        scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
        schedule_status: {
          in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress'],
        },
        time_window_start: { lt: new Date('1970-01-01T10:30:00.000Z') },
        time_window_end: { gt: new Date('1970-01-01T09:30:00.000Z') },
      }),
      select: { id: true },
    });
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
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

  it('allows an org-wide pharmacist to reassign case or pharmacist', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      site_id: 'site_1',
      schedule_status: 'planned',
      scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
      time_window_start: null,
      time_window_end: null,
      confirmed_at: null,
      pharmacist_id: 'user_1',
      vehicle_resource_id: null,
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
    expect(response.status).toBe(200);
    expect(validateOrgReferencesMock).toHaveBeenCalled();
  });
});
