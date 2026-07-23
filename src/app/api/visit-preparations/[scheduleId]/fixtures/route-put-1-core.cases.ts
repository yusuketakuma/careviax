import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';
import {
  buildReadyTransitionScheduleMock,
  completePreparationBody,
  createMalformedJsonPutRequest,
  createPutRequest,
  setupVisitPreparationPutMocks,
  visitPreparationRouteTestMocks,
} from './route-support';
import { PUT } from '../route';

const {
  authMock,
  membershipFindFirstMock,
  visitScheduleFindFirstMock,
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
  upsertOperationalTaskMock,
  resolveOperationalTasksMock,
} = visitPreparationRouteTestMocks;

describe('/api/visit-preparations/[scheduleId] PUT', () => {
  beforeEach(setupVisitPreparationPutMocks);

  it('returns a sanitized no-store 500 when put auth plumbing fails before schedule lookup', async () => {
    authMock.mockRejectedValueOnce(
      new Error('raw put auth patient 山田 花子 token secret preparation memo'),
    );

    const response = await PUT(createPutRequest(completePreparationBody), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
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
    expect(bodyText).not.toContain('raw put auth');
    expect(bodyText).not.toContain('山田 花子');
    expect(bodyText).not.toContain('token secret');
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitPreparationUpsertMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects non-object preparation payloads before schedule lookup or upsert', async () => {
    const response = await PUT(createPutRequest([]), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitPreparationUpsertMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON preparation payloads before schedule lookup or upsert', async () => {
    const response = await PUT(createMalformedJsonPutRequest(), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitPreparationUpsertMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('rejects blank schedule ids before parsing preparation payloads or schedule lookup', async () => {
    const response = await PUT(createPutRequest(completePreparationBody), {
      params: Promise.resolve({ scheduleId: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '訪問予定IDが不正です',
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitPreparationUpsertMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('denies a trainee before parsing, loading, route planning, or readiness side effects', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist_trainee' });

    const response = await PUT(createMalformedJsonPutRequest(), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
      message: '訪問準備を更新する権限がありません',
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(visitVehicleResourceFindFirstMock).not.toHaveBeenCalled();
    expect(peerVisitScheduleFindManyMock).not.toHaveBeenCalled();
    expect(computeOptimizedVisitRouteMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitPreparationUpsertMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('denies a trainee mark-ready vehicle assignment before readiness side effects', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist_trainee' });

    const response = await PUT(
      createPutRequest({
        ...completePreparationBody,
        mark_ready: true,
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
    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
      message: '訪問準備を更新する権限がありません',
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(visitVehicleResourceFindFirstMock).not.toHaveBeenCalled();
    expect(peerVisitScheduleFindManyMock).not.toHaveBeenCalled();
    expect(computeOptimizedVisitRouteMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitPreparationUpsertMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('allows an org-wide pharmacist to upsert preparation even when not assigned to the schedule', async () => {
    // 新ポリシー: 薬剤師は組織内フルアクセス。担当外の予定でも準備の upsert が許可される。
    visitScheduleFindFirstMock.mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      schedule_status: 'planned',
      scheduled_date: new Date('2026-03-27T00:00:00Z'),
      pharmacist_id: 'user_other',
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await PUT(createPutRequest(completePreparationBody), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      requestContext: expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      }),
    });
    expect(visitPreparationUpsertMock).toHaveBeenCalled();
  });

  it('allows the backup pharmacist to mark previous issues as reviewed', async () => {
    const defaultChecklist = {
      emergency_contacts_checked: false,
      medication_prepared: false,
      patient_record_reviewed: false,
      prescription_confirmed: false,
      previous_visit_reviewed: false,
      route_confirmed: false,
    };

    visitScheduleFindFirstMock.mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      schedule_status: 'planned',
      scheduled_date: new Date('2026-03-27T00:00:00Z'),
      pharmacist_id: 'user_other',
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: 'user_1',
      },
    });

    const response = await PUT(createPutRequest(completePreparationBody), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(visitPreparationUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { schedule_id: 'schedule_1' },
        create: expect.objectContaining({
          checklist: defaultChecklist,
          previous_issues_reviewed: true,
          prepared_by: 'user_1',
          prepared_at: expect.any(Date),
        }),
        update: expect.objectContaining({
          checklist: defaultChecklist,
          previous_issues_reviewed: true,
          prepared_by: 'user_1',
          prepared_at: expect.any(Date),
        }),
      }),
    );
    expect(resolveOperationalTasksMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        dedupeKey: 'visit-preparation:schedule_1',
        status: 'completed',
      }),
    );
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('rejects mark_ready before upsert when checklist readiness is incomplete', async () => {
    const response = await PUT(
      createPutRequest({
        ...completePreparationBody,
        previous_issues_reviewed: false,
        mark_ready: true,
      }),
      {
        params: Promise.resolve({ scheduleId: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '訪問準備チェックリストが未完了のため ready へ進めません',
      details: {
        readiness_blockers: ['前回課題の確認'],
        onboarding_blockers: [],
        billing_blockers: [],
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitPreparationUpsertMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('upserts preparation and advances the schedule ready in the same transaction', async () => {
    const txVisitScheduleFindFirstMock = vi
      .fn()
      .mockResolvedValue(buildReadyTransitionScheduleMock());
    const txConsentFindFirstMock = vi.fn().mockResolvedValue({ id: 'consent_1' });
    const txFirstVisitDocumentFindFirstMock = vi.fn().mockResolvedValue({
      id: 'first_doc_1',
      delivered_at: new Date('2026-03-26T00:00:00Z'),
    });
    const txManagementPlanFindFirstMock = vi.fn().mockResolvedValue({
      id: 'plan_1',
      status: 'approved',
      approved_at: new Date('2026-03-20T00:00:00Z'),
      next_review_date: null,
    });
    const txVisitRecordFindManyMock = vi.fn().mockResolvedValue([{ id: 'visit_record_1' }]);
    const txMedicationCycleFindManyMock = vi.fn().mockResolvedValue([{ id: 'cycle_1' }]);

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
          findFirst: txConsentFindFirstMock,
        },
        firstVisitDocument: {
          findFirst: txFirstVisitDocumentFindFirstMock,
        },
        managementPlan: {
          findFirst: txManagementPlanFindFirstMock,
        },
        visitRecord: {
          findMany: txVisitRecordFindManyMock,
        },
        medicationCycle: {
          findMany: txMedicationCycleFindManyMock,
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
    expect(response.status).toBe(200);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      requestContext: expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      }),
    });
    expect(visitPreparationUpsertMock).toHaveBeenCalled();
    expect(txVisitScheduleFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          id: 'schedule_1',
        }),
      }),
    );
    expect(billingEvidenceBlockersMock).toHaveBeenCalledWith(
      expect.objectContaining({
        visitSchedule: expect.objectContaining({
          findFirst: txVisitScheduleFindFirstMock,
        }),
      }),
      expect.objectContaining({
        orgId: 'org_1',
        patientId: 'patient_1',
        visitRecordIds: ['visit_record_1'],
        cycleIds: ['cycle_1'],
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
        schedule_status: 'ready',
        pre_visit_checklist_completed: true,
        version: { increment: 1 },
      },
    });
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        dedupeKey: 'visit-preparation:schedule_1',
        status: 'completed',
      }),
    );
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        action: 'visit_preparation_updated',
        changes: expect.objectContaining({
          schedule_id: 'schedule_1',
          preparation: expect.objectContaining({
            mark_ready_requested: true,
            preparation_ready: true,
          }),
          schedule_transition: {
            from: 'planned',
            to: 'ready',
          },
          task_trace: expect.objectContaining({
            action: 'resolved',
            status: 'completed',
            actor_user_id: 'user_1',
          }),
        }),
      }),
    );
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: {
        source: 'visit_preparations_update',
        schedule_id: 'schedule_1',
        case_id: 'case_1',
      },
    });
  });

  it('returns a sanitized no-store 500 when the preparation transaction fails unexpectedly', async () => {
    withOrgContextMock.mockRejectedValueOnce(
      new Error('raw preparation transaction patient 山田 花子 token secret route memo'),
    );

    const response = await PUT(createPutRequest(completePreparationBody), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
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
    expect(bodyText).not.toContain('raw preparation transaction');
    expect(bodyText).not.toContain('山田 花子');
    expect(bodyText).not.toContain('token secret');
    expect(visitPreparationUpsertMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });
});
