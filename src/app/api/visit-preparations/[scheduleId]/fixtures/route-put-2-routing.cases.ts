import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildReadyTransitionScheduleMock,
  completePreparationBody,
  createPutRequest,
  setupVisitPreparationPutMocks,
  visitPreparationRouteTestMocks,
} from './route-support';
import { PUT } from '../route';

const {
  peerVisitScheduleFindManyMock,
  billingEvidenceBlockersMock,
  visitPreparationUpsertMock,
  visitVehicleResourceFindFirstMock,
  visitScheduleUpdateMock,
  visitScheduleUpdateManyMock,
  createAuditLogEntryMock,
  computeOptimizedVisitRouteMock,
  notifyWorkflowMutationMock,
  withOrgContextMock,
  resolveOperationalTasksMock,
} = visitPreparationRouteTestMocks;

describe('/api/visit-preparations/[scheduleId] PUT', () => {
  beforeEach(setupVisitPreparationPutMocks);

  it('rejects mark_ready when the schedule changed before the guarded ready update', async () => {
    const txVisitScheduleFindFirstMock = vi
      .fn()
      .mockResolvedValue(buildReadyTransitionScheduleMock());
    visitScheduleUpdateManyMock.mockResolvedValueOnce({ count: 0 });
    withOrgContextMock.mockImplementationOnce(async (_orgId, callback) =>
      callback({
        visitPreparation: {
          upsert: visitPreparationUpsertMock,
        },
        visitSchedule: {
          update: visitScheduleUpdateMock,
          updateMany: visitScheduleUpdateManyMock,
          findFirst: txVisitScheduleFindFirstMock,
          findMany: peerVisitScheduleFindManyMock,
        },
        consentRecord: {
          findFirst: vi.fn().mockResolvedValue({ id: 'consent_1' }),
        },
        firstVisitDocument: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'first_doc_1',
            delivered_at: new Date('2026-03-26T00:00:00Z'),
          }),
        },
        managementPlan: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'plan_1',
            status: 'approved',
            approved_at: new Date('2026-03-20T00:00:00Z'),
            next_review_date: null,
          }),
        },
        visitRecord: {
          findMany: vi.fn().mockResolvedValue([{ id: 'visit_record_1' }]),
        },
        medicationCycle: {
          findMany: vi.fn().mockResolvedValue([{ id: 'cycle_1' }]),
        },
        billingEvidence: {
          findMany: vi.fn(),
        },
      }),
    );

    const response = await PUT(
      createPutRequest({
        ...completePreparationBody,
        mark_ready: true,
      }),
      {
        params: Promise.resolve({ scheduleId: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '訪問予定が同時に更新されました。再読み込みしてください',
    });
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'schedule_1',
          schedule_status: 'planned',
          version: 1,
        }),
      }),
    );
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('returns sanitized ready transition details when mark_ready is blocked after upsert', async () => {
    const txVisitScheduleFindFirstMock = vi
      .fn()
      .mockResolvedValue(buildReadyTransitionScheduleMock());
    billingEvidenceBlockersMock.mockResolvedValueOnce([
      {
        id: 'billing_evidence_secret',
        visit_record_id: 'visit_record_secret',
        blockers: [
          {
            key: 'missing_signed_receipt',
            reason: '署名確認が未完了です',
            action_label: '請求証跡を確認',
            severity: 'high',
          },
        ],
      },
    ]);
    withOrgContextMock.mockImplementationOnce(async (_orgId, callback) =>
      callback({
        visitPreparation: {
          upsert: visitPreparationUpsertMock,
        },
        visitSchedule: {
          update: visitScheduleUpdateMock,
          updateMany: visitScheduleUpdateManyMock,
          findFirst: txVisitScheduleFindFirstMock,
          findMany: peerVisitScheduleFindManyMock,
        },
        consentRecord: {
          findFirst: vi.fn().mockResolvedValue({ id: 'consent_1' }),
        },
        firstVisitDocument: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'first_doc_1',
            delivered_at: new Date('2026-03-26T00:00:00Z'),
          }),
        },
        managementPlan: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'plan_1',
            status: 'approved',
            approved_at: new Date('2026-03-20T00:00:00Z'),
            next_review_date: null,
          }),
        },
        visitRecord: {
          findMany: vi.fn().mockResolvedValue([{ id: 'visit_record_1' }]),
        },
        medicationCycle: {
          findMany: vi.fn().mockResolvedValue([{ id: 'cycle_1' }]),
        },
        billingEvidence: {
          findMany: vi.fn(),
        },
      }),
    );

    const response = await PUT(
      createPutRequest({
        ...completePreparationBody,
        mark_ready: true,
      }),
      {
        params: Promise.resolve({ scheduleId: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '訪問準備に未解決の止まっている理由があるため ready へ進めません',
      details: {
        billing_blockers: [
          {
            key: 'missing_signed_receipt',
            reason: '署名確認が未完了です',
            action_label: '請求証跡を確認',
            severity: 'high',
          },
        ],
      },
    });
    expect(JSON.stringify(body)).not.toContain('billing_evidence_secret');
    expect(JSON.stringify(body)).not.toContain('visit_record_secret');
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('stores route plan snapshots and assigns the selected vehicle resource', async () => {
    const routePlanSnapshot = {
      status: 'ok',
      travelMode: 'DRIVE',
      orderedScheduleIds: ['schedule_1'],
      totalDistanceMeters: 1200,
      totalDurationSeconds: 900,
      vehicle_resource: {
        vehicle_id: 'vehicle_1',
        label: '社用車A',
        constraint_status: 'ok',
      },
    };

    const response = await PUT(
      createPutRequest({
        ...completePreparationBody,
        route_plan_snapshot: routePlanSnapshot,
      }),
      {
        params: Promise.resolve({ scheduleId: 'schedule_1' }),
      },
    );

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
        travel_mode: true,
        max_stops: true,
        max_route_duration_minutes: true,
      },
    });
    expect(computeOptimizedVisitRouteMock).toHaveBeenCalledWith({
      origin: {
        lat: 35.681236,
        lng: 139.767125,
        label: '本店',
      },
      travelMode: 'DRIVE',
      waypoints: [
        {
          scheduleId: 'schedule_1',
          patientName: '山田太郎',
          address: '東京都千代田区1-1',
          lat: 35.684,
          lng: 139.77,
          priority: 'normal',
          timeWindow: null,
          serviceMinutes: 60,
        },
      ],
    });
    expect(visitPreparationUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          route_confirmed: true,
          route_plan_snapshot: expect.objectContaining({
            status: 'ok',
            generated_by: 'server',
            ordered_schedule_ids: ['schedule_1'],
            orderedScheduleIds: ['schedule_1'],
            vehicle_resource: expect.objectContaining({
              vehicle_id: 'vehicle_1',
              constraint_status: 'ok',
            }),
          }),
        }),
        update: expect.objectContaining({
          route_confirmed: true,
          route_plan_snapshot: expect.objectContaining({
            status: 'ok',
            orderedScheduleIds: ['schedule_1'],
          }),
        }),
      }),
    );
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'schedule_1',
        org_id: 'org_1',
        version: 1,
        confirmed_at: null,
        pharmacist_id: 'user_1',
        scheduled_date: new Date('2026-03-27T00:00:00Z'),
        schedule_status: 'planned',
        vehicle_resource_id: null,
      },
      data: {
        vehicle_resource_id: 'vehicle_1',
        version: { increment: 1 },
      },
    });
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
      }),
      {
        action: 'visit_preparation_updated',
        targetType: 'VisitPreparation',
        targetId: 'prep_1',
        changes: expect.objectContaining({
          schedule_id: 'schedule_1',
          case_id: 'case_1',
          preparation: expect.objectContaining({
            route_confirmed: true,
            mark_ready_requested: false,
            preparation_ready: true,
          }),
          schedule_transition: null,
          vehicle_assignment: expect.objectContaining({
            changed: true,
            previous_vehicle_resource_id: null,
            vehicle_resource_id: 'vehicle_1',
          }),
          task_trace: expect.objectContaining({
            action: 'resolved',
            task_type: 'visit_preparation',
            dedupe_key: 'visit-preparation:schedule_1',
            status: 'completed',
            resolution_count: 1,
            actor_user_id: 'user_1',
          }),
        }),
      },
    );
    const auditPayload = JSON.stringify(createAuditLogEntryMock.mock.calls);
    expect(auditPayload).not.toContain('山田太郎');
    expect(auditPayload).not.toContain('東京都千代田区1-1');
    expect(auditPayload).not.toContain('ヒューリスティック順序');
    expect(auditPayload).not.toContain('route_plan_snapshot');
    expect(auditPayload).not.toContain('checklist');
    expect(auditPayload).not.toContain('stopSummaries');
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: {
        source: 'visit_preparations_update',
        schedule_id: 'schedule_1',
        case_id: 'case_1',
      },
    });
  });

  it('rejects vehicle-only assignment when the schedule changed before the guarded update', async () => {
    visitScheduleUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await PUT(
      createPutRequest({
        ...completePreparationBody,
        route_plan_snapshot: {
          status: 'ok',
          travelMode: 'DRIVE',
          orderedScheduleIds: ['schedule_1'],
          totalDistanceMeters: 1200,
          totalDurationSeconds: 900,
          vehicle_resource: {
            vehicle_id: 'vehicle_1',
            label: '社用車A',
            constraint_status: 'ok',
          },
        },
      }),
      {
        params: Promise.resolve({ scheduleId: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '訪問予定が同時に更新されました。再読み込みしてください',
    });
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'schedule_1',
          org_id: 'org_1',
          version: 1,
          schedule_status: 'planned',
          vehicle_resource_id: null,
        }),
        data: expect.objectContaining({
          vehicle_resource_id: 'vehicle_1',
          version: { increment: 1 },
        }),
      }),
    );
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('does not assign a vehicle from a stale route snapshot when route is not confirmed', async () => {
    visitPreparationUpsertMock.mockResolvedValueOnce({
      id: 'prep_1',
      schedule_id: 'schedule_1',
      checklist: {},
      medication_changes_reviewed: true,
      carry_items_confirmed: true,
      previous_issues_reviewed: true,
      route_confirmed: false,
      offline_synced: true,
      prepared_by: 'user_1',
      prepared_at: null,
    });

    const response = await PUT(
      createPutRequest({
        ...completePreparationBody,
        route_confirmed: false,
        route_plan_snapshot: {
          vehicle_resource: {
            vehicle_id: 'vehicle_1',
            label: '社用車A',
            constraint_status: 'ok',
          },
        },
      }),
      {
        params: Promise.resolve({ scheduleId: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(visitVehicleResourceFindFirstMock).not.toHaveBeenCalled();
    expect(computeOptimizedVisitRouteMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(visitPreparationUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          route_confirmed: false,
          prepared_at: null,
        }),
        update: expect.objectContaining({
          route_confirmed: false,
          prepared_at: null,
        }),
      }),
    );
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('generates route plan snapshots on the server when no client snapshot is submitted', async () => {
    const response = await PUT(createPutRequest(completePreparationBody), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(computeOptimizedVisitRouteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        travelMode: 'DRIVE',
        waypoints: [
          expect.objectContaining({
            scheduleId: 'schedule_1',
            patientName: '山田太郎',
          }),
        ],
      }),
    );
    expect(visitPreparationUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          route_plan_snapshot: expect.objectContaining({
            status: 'ok',
            generated_by: 'server',
            ordered_schedule_ids: ['schedule_1'],
          }),
        }),
        update: expect.objectContaining({
          route_plan_snapshot: expect.objectContaining({
            status: 'ok',
            generated_by: 'server',
            ordered_schedule_ids: ['schedule_1'],
          }),
        }),
      }),
    );
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });
});
