import { beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  buildPutScheduleMock,
  completePreparationBody,
  createPutRequest,
  setupVisitPreparationPutMocks,
  visitPreparationRouteTestMocks,
} from './route-support';
import { PUT } from '../route';

const {
  visitScheduleFindFirstMock,
  peerVisitScheduleFindManyMock,
  visitPreparationUpsertMock,
  visitVehicleResourceFindFirstMock,
  visitScheduleUpdateMock,
  visitScheduleUpdateManyMock,
  createAuditLogEntryMock,
  computeOptimizedVisitRouteMock,
  notifyWorkflowMutationMock,
  withOrgContextMock,
  upsertOperationalTaskMock,
  resolveOperationalTasksMock,
} = visitPreparationRouteTestMocks;

describe('/api/visit-preparations/[scheduleId] PUT', () => {
  beforeEach(setupVisitPreparationPutMocks);

  it('does not persist patient names or addresses in generated route notes for missing coordinates', async () => {
    peerVisitScheduleFindManyMock.mockResolvedValueOnce([
      {
        id: 'schedule_1',
        route_order: 1,
        priority: 'normal',
        site: {
          id: 'site_1',
          name: '本店',
          lat: 35.681236,
          lng: 139.767125,
        },
        case_: {
          patient: {
            name: '山田太郎',
            residences: [
              {
                address: '東京都千代田区1-1',
                lat: 35.684,
                lng: 139.77,
              },
            ],
          },
        },
      },
      {
        id: 'schedule_missing_coordinates',
        route_order: 2,
        priority: 'normal',
        site: {
          id: 'site_1',
          name: '本店',
          lat: 35.681236,
          lng: 139.767125,
        },
        case_: {
          patient: {
            name: '佐藤花子',
            residences: [
              {
                address: '東京都港区9-9',
                lat: null,
                lng: null,
              },
            ],
          },
        },
      },
    ]);

    const response = await PUT(createPutRequest(completePreparationBody), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(visitPreparationUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          route_plan_snapshot: expect.objectContaining({
            note: 'ヒューリスティック順序を表示しています / 座標未設定: 1件',
            ordered_schedule_ids: ['schedule_1', 'schedule_missing_coordinates'],
          }),
        }),
      }),
    );
    const upsertPayload = visitPreparationUpsertMock.mock.calls[0]?.[0];
    const snapshotText = JSON.stringify(upsertPayload);
    expect(snapshotText).not.toContain('佐藤花子');
    expect(snapshotText).not.toContain('東京都港区9-9');
  });

  it('rejects route confirmation when the selected vehicle duration limit is exceeded', async () => {
    computeOptimizedVisitRouteMock.mockResolvedValueOnce({
      status: 'ok',
      note: 'ヒューリスティック順序を表示しています',
      travelMode: 'DRIVE',
      origin: {
        lat: 35.681236,
        lng: 139.767125,
        label: '本店',
      },
      encodedPath: null,
      orderedScheduleIds: ['schedule_1'],
      totalDistanceMeters: 1200,
      totalDurationSeconds: 3 * 60 * 60,
      stopSummaries: [],
    });

    const response = await PUT(
      createPutRequest({
        ...completePreparationBody,
        route_plan_snapshot: {
          vehicle_resource: {
            vehicle_id: 'vehicle_1',
          },
        },
      }),
      {
        params: Promise.resolve({ scheduleId: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '選択した車両リソースの稼働上限を超えるためルート確認できません',
    });
    expect(visitPreparationUpsertMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects route confirmation when selected vehicle capacity is exceeded after adding the current schedule', async () => {
    visitVehicleResourceFindFirstMock.mockResolvedValueOnce({
      id: 'vehicle_1',
      site_id: 'site_1',
      label: '社用車A',
      travel_mode: 'DRIVE',
      max_stops: 1,
      max_route_duration_minutes: 120,
    });
    peerVisitScheduleFindManyMock
      .mockResolvedValueOnce([
        {
          id: 'schedule_other',
          route_order: 1,
          priority: 'normal',
          site: {
            id: 'site_1',
            name: '本店',
            lat: 35.681236,
            lng: 139.767125,
          },
          case_: {
            patient: {
              name: '田中一郎',
              residences: [
                {
                  address: '東京都千代田区2-2',
                  lat: 35.685,
                  lng: 139.771,
                },
              ],
            },
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'schedule_1',
          route_order: 2,
          priority: 'normal',
          site: {
            id: 'site_1',
            name: '本店',
            lat: 35.681236,
            lng: 139.767125,
          },
          case_: {
            patient: {
              name: '山田太郎',
              residences: [
                {
                  address: '東京都千代田区1-1',
                  lat: 35.684,
                  lng: 139.77,
                },
              ],
            },
          },
        },
      ]);

    const response = await PUT(
      createPutRequest({
        ...completePreparationBody,
        route_plan_snapshot: {
          vehicle_resource: {
            vehicle_id: 'vehicle_1',
          },
        },
      }),
      {
        params: Promise.resolve({ scheduleId: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '社用車A で訪問できる件数は最大 1 件です',
    });
    expect(computeOptimizedVisitRouteMock).not.toHaveBeenCalled();
    expect(visitPreparationUpsertMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects route confirmation when the selected vehicle is already full for another pharmacist on the same day', async () => {
    visitVehicleResourceFindFirstMock.mockResolvedValueOnce({
      id: 'vehicle_1',
      site_id: 'site_1',
      label: '社用車A',
      travel_mode: 'DRIVE',
      max_stops: 1,
      max_route_duration_minutes: 120,
    });
    peerVisitScheduleFindManyMock
      .mockResolvedValueOnce([
        {
          id: 'schedule_1',
          route_order: 1,
          priority: 'normal',
          site: {
            id: 'site_1',
            name: '本店',
            lat: 35.681236,
            lng: 139.767125,
          },
          case_: {
            patient: {
              name: '山田太郎',
              residences: [
                {
                  address: '東京都千代田区1-1',
                  lat: 35.684,
                  lng: 139.77,
                },
              ],
            },
          },
        },
      ])
      .mockResolvedValueOnce([{ id: 'schedule_other_pharmacist' }]);

    const response = await PUT(
      createPutRequest({
        ...completePreparationBody,
        route_plan_snapshot: {
          vehicle_resource: {
            vehicle_id: 'vehicle_1',
          },
        },
      }),
      {
        params: Promise.resolve({ scheduleId: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '社用車A で訪問できる件数は最大 1 件です',
    });
    expect(peerVisitScheduleFindManyMock.mock.calls[1]?.[0]).toMatchObject({
      where: {
        org_id: 'org_1',
        vehicle_resource_id: 'vehicle_1',
        scheduled_date: {
          gte: new Date('2026-03-27T00:00:00Z'),
          lt: new Date('2026-03-28T00:00:00Z'),
        },
        schedule_status: {
          notIn: ['cancelled', 'rescheduled'],
        },
        id: {
          not: 'schedule_1',
        },
      },
      select: {
        id: true,
      },
    });
    expect(computeOptimizedVisitRouteMock).not.toHaveBeenCalled();
    expect(visitPreparationUpsertMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rechecks selected vehicle capacity inside the transaction before preparation side effects', async () => {
    visitVehicleResourceFindFirstMock.mockResolvedValueOnce({
      id: 'vehicle_1',
      site_id: 'site_1',
      label: '社用車A',
      travel_mode: 'DRIVE',
      max_stops: 1,
      max_route_duration_minutes: 120,
    });
    peerVisitScheduleFindManyMock
      .mockResolvedValueOnce([
        {
          id: 'schedule_1',
          route_order: 1,
          priority: 'normal',
          site: {
            id: 'site_1',
            name: '本店',
            lat: 35.681236,
            lng: 139.767125,
          },
          case_: {
            patient: {
              name: '山田太郎',
              residences: [
                {
                  address: '東京都千代田区1-1',
                  lat: 35.684,
                  lng: 139.77,
                },
              ],
            },
          },
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'schedule_other_pharmacist' }]);

    const response = await PUT(
      createPutRequest({
        ...completePreparationBody,
        route_plan_snapshot: {
          vehicle_resource: {
            vehicle_id: 'vehicle_1',
          },
        },
      }),
      {
        params: Promise.resolve({ scheduleId: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '社用車A で訪問できる件数は最大 1 件です',
    });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      requestContext: expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      }),
    });
    expect(visitPreparationUpsertMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('rejects route snapshots that reference a vehicle from another schedule site', async () => {
    visitVehicleResourceFindFirstMock.mockResolvedValueOnce({
      site_id: 'site_2',
    });

    const response = await PUT(
      createPutRequest({
        ...completePreparationBody,
        route_plan_snapshot: {
          status: 'ok',
          travelMode: 'DRIVE',
          orderedScheduleIds: ['schedule_1'],
          vehicle_resource: {
            vehicle_id: 'vehicle_2',
            label: '別拠点車両',
            constraint_status: 'ok',
          },
        },
      }),
      {
        params: Promise.resolve({ scheduleId: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '選択した車両リソースは訪問予定の拠点では利用できません',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitPreparationUpsertMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('keeps the readiness gate blocked when previous issues are not reviewed', async () => {
    visitPreparationUpsertMock.mockResolvedValueOnce({
      id: 'prep_1',
      schedule_id: 'schedule_1',
      checklist: {},
      medication_changes_reviewed: true,
      carry_items_confirmed: true,
      previous_issues_reviewed: false,
      route_confirmed: true,
      offline_synced: true,
      prepared_by: 'user_1',
      prepared_at: null,
    });

    const response = await PUT(
      createPutRequest({
        ...completePreparationBody,
        checklist: {
          access_key: '玄関暗証番号1234',
          patient_name: '山田太郎',
        },
        previous_issues_reviewed: false,
      }),
      {
        params: Promise.resolve({ scheduleId: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(visitPreparationUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          previous_issues_reviewed: false,
          prepared_at: null,
        }),
        update: expect.objectContaining({
          previous_issues_reviewed: false,
          prepared_at: null,
        }),
      }),
    );
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        taskType: 'visit_preparation',
        assignedTo: 'user_1',
        dedupeKey: 'visit-preparation:schedule_1',
        metadata: {
          source: 'visit_preparation_put',
          schedule_id: 'schedule_1',
          case_id: 'case_1',
          route_confirmed: true,
          mark_ready_requested: false,
          preparation_ready: false,
          updated_by: 'user_1',
        },
      }),
    );
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        action: 'visit_preparation_updated',
        changes: expect.objectContaining({
          schedule_id: 'schedule_1',
          case_id: 'case_1',
          task_trace: expect.objectContaining({
            action: 'upserted',
            status: 'pending',
            resolution_count: null,
            actor_user_id: 'user_1',
          }),
        }),
      }),
    );
    const sideEffectPayload = JSON.stringify([
      createAuditLogEntryMock.mock.calls,
      notifyWorkflowMutationMock.mock.calls,
      upsertOperationalTaskMock.mock.calls,
    ]);
    expect(sideEffectPayload).not.toContain('玄関暗証番号1234');
    expect(sideEffectPayload).not.toContain('patient_name');
    expect(sideEffectPayload).not.toContain('checklist');
    await expect(response.json()).resolves.toMatchObject({
      data: {
        previous_issues_reviewed: false,
        prepared_at: null,
      },
    });
  });

  it.each(['partial', 'blocked'] as const)(
    'keeps preparation incomplete when carry items status is %s even if checklist fields are complete',
    async (carryItemsStatus) => {
      visitScheduleFindFirstMock.mockResolvedValueOnce(
        buildPutScheduleMock({ carry_items_status: carryItemsStatus }),
      );
      visitPreparationUpsertMock.mockResolvedValueOnce({
        id: 'prep_1',
        schedule_id: 'schedule_1',
        checklist: {},
        medication_changes_reviewed: true,
        carry_items_confirmed: true,
        previous_issues_reviewed: true,
        route_confirmed: true,
        offline_synced: true,
        prepared_by: 'user_1',
        prepared_at: null,
      });

      const response = await PUT(createPutRequest(completePreparationBody), {
        params: Promise.resolve({ scheduleId: 'schedule_1' }),
      });

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(200);
      expect(visitScheduleFindFirstMock).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            carry_items_status: true,
          }),
        }),
      );
      expect(visitPreparationUpsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            prepared_at: null,
          }),
          update: expect.objectContaining({
            prepared_at: null,
          }),
        }),
      );
      expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          orgId: 'org_1',
          taskType: 'visit_preparation',
          assignedTo: 'user_1',
          dedupeKey: 'visit-preparation:schedule_1',
          description: '未完了: 持参物ステータス未解決',
        }),
      );
      expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toMatchObject({
        data: {
          prepared_at: null,
        },
      });
    },
  );

  it('prioritizes unresolved carry item status in incomplete preparation task descriptions', async () => {
    visitScheduleFindFirstMock.mockResolvedValueOnce(
      buildPutScheduleMock({ carry_items_status: 'partial' }),
    );
    visitPreparationUpsertMock.mockResolvedValueOnce({
      id: 'prep_1',
      schedule_id: 'schedule_1',
      checklist: {},
      medication_changes_reviewed: true,
      carry_items_confirmed: false,
      previous_issues_reviewed: true,
      route_confirmed: false,
      offline_synced: true,
      prepared_by: 'user_1',
      prepared_at: null,
    });

    const response = await PUT(
      createPutRequest({
        ...completePreparationBody,
        carry_items_confirmed: false,
        route_confirmed: false,
      }),
      { params: Promise.resolve({ scheduleId: 'schedule_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        description: '未完了: 持参物ステータス未解決、持参薬・物品確認、ルート確認',
      }),
    );
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });
});
