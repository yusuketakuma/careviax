import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

type RouteContext = { params: Promise<{ id: string }> };
type TestRole = 'pharmacist' | 'driver';
type TestAuthContext = { orgId: string; userId: string; role: TestRole };
type WithAuthOptions = { permission?: string; message?: string };
type WrappedRouteHandler = ((req: NextRequest, routeContext: RouteContext) => Promise<Response>) & {
  authOptions?: WithAuthOptions;
};

const {
  authState,
  createAuditLogEntryMock,
  facilityVisitBatchDeleteMock,
  facilityVisitBatchFindFirstMock,
  notifyWorkflowMutationMock,
  visitScheduleCountMock,
  visitScheduleFindManyMock,
  visitScheduleUpdateManyMock,
  visitScheduleUpdateMock,
  withAuthRegistrations,
  withAuthContextMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  authState: { allow: true, role: 'pharmacist' as TestRole },
  createAuditLogEntryMock: vi.fn(),
  facilityVisitBatchDeleteMock: vi.fn(),
  facilityVisitBatchFindFirstMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
  visitScheduleCountMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  visitScheduleUpdateManyMock: vi.fn(),
  visitScheduleUpdateMock: vi.fn(),
  withAuthRegistrations: [] as Array<WithAuthOptions | undefined>,
  withAuthContextMock: vi.fn(
    (
      handler: (
        req: NextRequest,
        ctx: TestAuthContext,
        routeContext: RouteContext,
      ) => Promise<Response>,
      options?: WithAuthOptions,
    ) => {
      withAuthRegistrations.push(options);
      const wrappedHandler = (async (req: NextRequest, routeContext: RouteContext) => {
        if (!authState.allow) {
          return new Response(
            JSON.stringify({
              code: 'AUTH_FORBIDDEN',
              message: options?.message ?? '権限がありません',
            }),
            {
              status: 403,
              headers: { 'content-type': 'application/json' },
            },
          );
        }

        return handler(
          req,
          { orgId: 'org_1', userId: 'user_1', role: authState.role },
          routeContext,
        );
      }) as WrappedRouteHandler;
      wrappedHandler.authOptions = options;
      return wrappedHandler;
    },
  ),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: withAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

import { DELETE, PATCH } from './route';

function createRequest(body?: unknown) {
  return new NextRequest('http://localhost/api/facility-visit-batches/batch_1', {
    method: body === undefined ? 'DELETE' : 'PATCH',
    ...(body === undefined
      ? {}
      : {
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        }),
  });
}

function createMalformedPatchRequest() {
  return new NextRequest('http://localhost/api/facility-visit-batches/batch_1', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: '{"ordered_schedule_ids":',
  });
}

function routeContext(id: string): RouteContext {
  return { params: Promise.resolve({ id }) };
}

function expectNoMutationSideEffects() {
  expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
  expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  expect(facilityVisitBatchDeleteMock).not.toHaveBeenCalled();
  expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
}

function expectDeleteScheduleUnlinkWrites() {
  expect(visitScheduleUpdateManyMock).toHaveBeenCalledTimes(2);
  expect(visitScheduleUpdateManyMock).toHaveBeenNthCalledWith(1, {
    where: {
      id: 'schedule_1',
      org_id: 'org_1',
      facility_batch_id: 'batch_1',
      version: 7,
      schedule_status: { in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress'] },
      confirmed_at: null,
    },
    data: { facility_batch_id: null, route_order: null, version: { increment: 1 } },
  });
  expect(visitScheduleUpdateManyMock).toHaveBeenNthCalledWith(2, {
    where: {
      id: 'schedule_2',
      org_id: 'org_1',
      facility_batch_id: 'batch_1',
      version: 3,
      schedule_status: { in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress'] },
      confirmed_at: null,
    },
    data: { facility_batch_id: null, route_order: null, version: { increment: 1 } },
  });
}

describe('/api/facility-visit-batches/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.allow = true;
    authState.role = 'pharmacist';
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    facilityVisitBatchFindFirstMock.mockResolvedValue({
      id: 'batch_1',
      facility_id: 'facility_a',
      facility_unit_id: 'unit_1',
      scheduled_date: new Date('2026-03-28T00:00:00Z'),
      pharmacist_id: 'user_1',
    });
    facilityVisitBatchDeleteMock.mockResolvedValue({ id: 'batch_1' });
    notifyWorkflowMutationMock.mockResolvedValue(undefined);
    visitScheduleFindManyMock.mockResolvedValue([
      {
        id: 'schedule_1',
        case_id: 'case_1',
        route_order: 1,
        schedule_status: 'planned',
        confirmed_at: null,
        version: 7,
      },
      {
        id: 'schedule_2',
        case_id: 'case_2',
        route_order: 2,
        schedule_status: 'planned',
        confirmed_at: null,
        version: 3,
      },
    ]);
    visitScheduleCountMock.mockResolvedValue(2);
    visitScheduleUpdateManyMock.mockResolvedValue({ count: 1 });
    visitScheduleUpdateMock.mockResolvedValue({});
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        facilityVisitBatch: {
          findFirst: facilityVisitBatchFindFirstMock,
          delete: facilityVisitBatchDeleteMock,
        },
        visitSchedule: {
          findMany: visitScheduleFindManyMock,
          count: visitScheduleCountMock,
          update: visitScheduleUpdateMock,
          updateMany: visitScheduleUpdateManyMock,
        },
      }),
    );
  });

  it('registers DELETE and PATCH with canVisit mutation authorization', () => {
    expect(withAuthRegistrations).toEqual([
      {
        permission: 'canVisit',
        message: '施設一括訪問の更新権限がありません',
      },
      {
        permission: 'canVisit',
        message: '施設一括訪問の更新権限がありません',
      },
    ]);
  });

  describe('DELETE', () => {
    it('denies roles without canVisit before schedule unlink, batch delete, or notify', async () => {
      authState.allow = false;

      const response = await DELETE(createRequest(), routeContext('batch_1'));

      expect(response.status).toBe(403);
      expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        code: 'AUTH_FORBIDDEN',
        message: '施設一括訪問の更新権限がありません',
      });
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expectNoMutationSideEffects();
    });

    it('rejects an empty batch id before schedule unlink, batch delete, or notify', async () => {
      const response = await DELETE(createRequest(), routeContext(''));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'バッチIDが指定されていません',
      });
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expectNoMutationSideEffects();
    });

    it('rejects a blank batch id before schedule unlink, batch delete, or notify', async () => {
      const response = await DELETE(createRequest(), routeContext('   '));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'バッチIDが指定されていません',
      });
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expectNoMutationSideEffects();
    });

    it('trims padded batch ids before schedule unlink, batch delete, or notify', async () => {
      const response = await DELETE(createRequest(), routeContext('  batch_1  '));

      expect(response.status).toBe(200);
      expectSensitiveNoStore(response);
      expect(facilityVisitBatchFindFirstMock).toHaveBeenCalledWith({
        where: { id: 'batch_1', org_id: 'org_1' },
        select: {
          id: true,
          facility_id: true,
          facility_unit_id: true,
          scheduled_date: true,
          pharmacist_id: true,
        },
      });
      expectDeleteScheduleUnlinkWrites();
      expect(facilityVisitBatchDeleteMock).toHaveBeenCalledWith({
        where: { id: 'batch_1' },
      });
    });

    it('returns 404 for a missing org-scoped batch without schedule unlink, batch delete, or notify', async () => {
      facilityVisitBatchFindFirstMock.mockResolvedValue(null);

      const response = await DELETE(createRequest(), routeContext('batch_missing'));

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        code: 'WORKFLOW_NOT_FOUND',
        message: '施設一括訪問バッチが見つかりません',
      });
      expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function));
      expect(facilityVisitBatchFindFirstMock).toHaveBeenCalledWith({
        where: { id: 'batch_missing', org_id: 'org_1' },
        select: {
          id: true,
          facility_id: true,
          facility_unit_id: true,
          scheduled_date: true,
          pharmacist_id: true,
        },
      });
      expectNoMutationSideEffects();
    });

    it('unlinks org-scoped schedules, deletes the authorized batch, and notifies workflow cache', async () => {
      const response = await DELETE(createRequest(), routeContext('batch_1'));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ deleted: true });
      expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function));
      expect(facilityVisitBatchFindFirstMock).toHaveBeenCalledWith({
        where: { id: 'batch_1', org_id: 'org_1' },
        select: {
          id: true,
          facility_id: true,
          facility_unit_id: true,
          scheduled_date: true,
          pharmacist_id: true,
        },
      });
      expectDeleteScheduleUnlinkWrites();
      expect(facilityVisitBatchDeleteMock).toHaveBeenCalledWith({
        where: { id: 'batch_1' },
      });
      expect(createAuditLogEntryMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
        {
          action: 'facility_visit_batch_deleted',
          targetType: 'FacilityVisitBatch',
          targetId: 'batch_1',
          changes: {
            facility_unit_id: 'unit_1',
            scheduled_date: '2026-03-28',
            pharmacist_id: 'user_1',
            detached_schedules: [
              {
                schedule_id: 'schedule_1',
                case_id: 'case_1',
                previous_route_order: 1,
              },
              {
                schedule_id: 'schedule_2',
                case_id: 'case_2',
                previous_route_order: 2,
              },
            ],
          },
        },
      );
      expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
        orgId: 'org_1',
        payload: { source: 'facility_visit_batch_delete' },
      });
    });

    it('rejects locked schedule statuses before delete unlink side effects', async () => {
      visitScheduleFindManyMock.mockResolvedValue([
        {
          id: 'schedule_1',
          case_id: 'case_1',
          route_order: 1,
          schedule_status: 'completed',
          confirmed_at: null,
          version: 7,
        },
        {
          id: 'schedule_2',
          case_id: 'case_2',
          route_order: 2,
          schedule_status: 'planned',
          confirmed_at: null,
          version: 3,
        },
      ]);

      const response = await DELETE(createRequest(), routeContext('batch_1'));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '完了済みまたは中止済みの訪問予定は施設一括訪問から解除できません',
      });
      expectNoMutationSideEffects();
    });

    it('rejects confirmed schedules before delete unlink side effects', async () => {
      visitScheduleFindManyMock.mockResolvedValue([
        {
          id: 'schedule_1',
          case_id: 'case_1',
          route_order: 1,
          schedule_status: 'planned',
          confirmed_at: new Date('2026-03-27T10:00:00.000Z'),
          version: 7,
        },
        {
          id: 'schedule_2',
          case_id: 'case_2',
          route_order: 2,
          schedule_status: 'planned',
          confirmed_at: null,
          version: 3,
        },
      ]);

      const response = await DELETE(createRequest(), routeContext('batch_1'));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '電話確定済みの訪問予定は施設一括訪問から解除できません',
      });
      expectNoMutationSideEffects();
    });

    it('returns conflict when a batch schedule changes before guarded delete unlink', async () => {
      visitScheduleUpdateManyMock
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      const response = await DELETE(createRequest(), routeContext('batch_1'));

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        code: 'WORKFLOW_CONFLICT',
        message: '施設一括訪問が同時に更新されました。再読み込みしてください',
      });
      expect(visitScheduleUpdateManyMock).toHaveBeenCalledTimes(2);
      expect(facilityVisitBatchDeleteMock).not.toHaveBeenCalled();
      expect(createAuditLogEntryMock).not.toHaveBeenCalled();
      expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
    });

    it('does not copy potentially PHI-like stored facility labels into delete audit changes', async () => {
      facilityVisitBatchFindFirstMock.mockResolvedValue({
        id: 'batch_1',
        facility_id: '東京都港区9-9-9 山田家',
        facility_unit_id: null,
        scheduled_date: new Date('2026-03-28T00:00:00Z'),
        pharmacist_id: 'user_1',
      });

      const response = await DELETE(createRequest(), routeContext('batch_1'));

      expect(response.status).toBe(200);
      const auditPayload = createAuditLogEntryMock.mock.calls[0]?.[2];
      expect(auditPayload).toEqual(
        expect.objectContaining({
          action: 'facility_visit_batch_deleted',
          changes: expect.not.objectContaining({
            facility_id: expect.anything(),
          }),
        }),
      );
      expect(JSON.stringify(auditPayload)).not.toContain('東京都港区9-9-9');
      expect(JSON.stringify(auditPayload)).not.toContain('山田家');
    });

    it('checks non-bypass child schedule access before reading audit details', async () => {
      authState.role = 'driver';
      visitScheduleCountMock.mockResolvedValueOnce(2).mockResolvedValueOnce(1);

      const response = await DELETE(createRequest(), routeContext('batch_1'));

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        code: 'AUTH_FORBIDDEN',
        message: '施設一括訪問バッチへのアクセス権限がありません',
      });
      expect(visitScheduleCountMock).toHaveBeenNthCalledWith(1, {
        where: { org_id: 'org_1', facility_batch_id: 'batch_1' },
      });
      expect(visitScheduleCountMock).toHaveBeenNthCalledWith(2, {
        where: {
          org_id: 'org_1',
          facility_batch_id: 'batch_1',
          AND: [
            {
              OR: [
                { pharmacist_id: 'user_1' },
                { case_: { primary_pharmacist_id: 'user_1' } },
                { case_: { backup_pharmacist_id: 'user_1' } },
              ],
            },
          ],
        },
      });
      expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
      expectNoMutationSideEffects();
    });

    it('allows org-wide roles to delete batches owned by another pharmacist without access counts', async () => {
      facilityVisitBatchFindFirstMock.mockResolvedValue({
        id: 'batch_1',
        facility_id: 'facility_a',
        facility_unit_id: 'unit_1',
        scheduled_date: new Date('2026-03-28T00:00:00Z'),
        pharmacist_id: 'other_user',
      });

      const response = await DELETE(createRequest(), routeContext('batch_1'));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ deleted: true });
      // org-wide ロールは担当アクセス突合(count)を一切行わずに削除できる
      expect(visitScheduleCountMock).not.toHaveBeenCalled();
      expectDeleteScheduleUnlinkWrites();
      expect(facilityVisitBatchDeleteMock).toHaveBeenCalledWith({
        where: { id: 'batch_1' },
      });
      expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
        orgId: 'org_1',
        payload: { source: 'facility_visit_batch_delete' },
      });
    });

    it('does not run child-schedule access counts for org-wide roles on owned batches', async () => {
      facilityVisitBatchFindFirstMock.mockResolvedValue({
        id: 'batch_1',
        facility_id: 'facility_a',
        facility_unit_id: 'unit_1',
        scheduled_date: new Date('2026-03-28T00:00:00Z'),
        pharmacist_id: 'user_1',
      });

      const response = await DELETE(createRequest(), routeContext('batch_1'));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ deleted: true });
      expect(visitScheduleCountMock).not.toHaveBeenCalled();
      expect(facilityVisitBatchDeleteMock).toHaveBeenCalledWith({
        where: { id: 'batch_1' },
      });
    });

    it('returns a sanitized no-store 500 when delete transaction fails unexpectedly', async () => {
      withOrgContextMock.mockRejectedValueOnce(
        new Error('患者 山田花子 090-1234-5678 raw facility batch delete detail'),
      );

      const response = await DELETE(createRequest(), routeContext('batch_1'));

      expect(response.status).toBe(500);
      expectSensitiveNoStore(response);
      const body = await response.json();
      expect(body).toMatchObject({
        code: 'INTERNAL_ERROR',
        message: 'サーバー内部でエラーが発生しました',
      });
      expect(JSON.stringify(body)).not.toContain('山田花子');
      expect(JSON.stringify(body)).not.toContain('090-1234-5678');
      expect(JSON.stringify(body)).not.toContain('raw facility batch delete detail');
      expectNoMutationSideEffects();
    });
  });

  describe('PATCH', () => {
    it('denies roles without canVisit before schedule reorder, batch delete, or notify', async () => {
      authState.allow = false;

      const response = await PATCH(
        createRequest({ ordered_schedule_ids: ['schedule_1'] }),
        routeContext('batch_1'),
      );

      expect(response.status).toBe(403);
      expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        code: 'AUTH_FORBIDDEN',
        message: '施設一括訪問の更新権限がありません',
      });
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expectNoMutationSideEffects();
    });

    it('rejects non-object JSON payloads before batch lookup, schedule reorder, or notify', async () => {
      const response = await PATCH(createRequest([]), routeContext('batch_1'));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'リクエストボディが不正です',
      });
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(facilityVisitBatchFindFirstMock).not.toHaveBeenCalled();
      expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
      expect(visitScheduleCountMock).not.toHaveBeenCalled();
      expectNoMutationSideEffects();
    });

    it('rejects a blank batch id before body parsing, batch lookup, schedule reorder, or notify', async () => {
      const response = await PATCH(
        createRequest({ ordered_schedule_ids: ['schedule_1', 'schedule_2'] }),
        routeContext('   '),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'バッチIDが指定されていません',
      });
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(facilityVisitBatchFindFirstMock).not.toHaveBeenCalled();
      expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
      expect(visitScheduleCountMock).not.toHaveBeenCalled();
      expectNoMutationSideEffects();
    });

    it('rejects malformed JSON before batch lookup, schedule reorder, or notify', async () => {
      const response = await PATCH(createMalformedPatchRequest(), routeContext('batch_1'));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'リクエストボディが不正です',
      });
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(facilityVisitBatchFindFirstMock).not.toHaveBeenCalled();
      expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
      expect(visitScheduleCountMock).not.toHaveBeenCalled();
      expectNoMutationSideEffects();
    });

    it('rejects invalid reorder input before schedule update, batch delete, or notify', async () => {
      const response = await PATCH(
        createRequest({ ordered_schedule_ids: [] }),
        routeContext('batch_1'),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '入力値が不正です',
      });
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expectNoMutationSideEffects();
    });

    it('returns 404 for a missing org-scoped batch without schedule update, batch delete, or notify', async () => {
      facilityVisitBatchFindFirstMock.mockResolvedValue(null);

      const response = await PATCH(
        createRequest({ ordered_schedule_ids: ['schedule_1'] }),
        routeContext('batch_missing'),
      );

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        code: 'WORKFLOW_NOT_FOUND',
        message: '施設一括訪問バッチが見つかりません',
      });
      expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function));
      expect(facilityVisitBatchFindFirstMock).toHaveBeenCalledWith({
        where: { id: 'batch_missing', org_id: 'org_1' },
        select: { id: true, pharmacist_id: true },
      });
      expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
      expectNoMutationSideEffects();
    });

    it('rejects schedules outside the batch without schedule update, batch delete, or notify', async () => {
      visitScheduleFindManyMock.mockResolvedValue([{ id: 'schedule_1' }]);
      visitScheduleCountMock.mockResolvedValue(1);

      const response = await PATCH(
        createRequest({ ordered_schedule_ids: ['schedule_1', 'schedule_other'] }),
        routeContext('batch_1'),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'バッチに含まれない訪問予定IDが指定されています',
      });
      expect(facilityVisitBatchFindFirstMock).toHaveBeenCalledWith({
        where: { id: 'batch_1', org_id: 'org_1' },
        select: { id: true, pharmacist_id: true },
      });
      expect(visitScheduleFindManyMock).toHaveBeenCalledWith({
        where: { org_id: 'org_1', facility_batch_id: 'batch_1' },
        select: {
          id: true,
          case_id: true,
          route_order: true,
          schedule_status: true,
          confirmed_at: true,
          version: true,
        },
      });
      expectNoMutationSideEffects();
    });

    it('rejects partial route orders before schedule update, batch delete, or notify', async () => {
      const response = await PATCH(
        createRequest({ ordered_schedule_ids: ['schedule_2'] }),
        routeContext('batch_1'),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'バッチ内のすべての訪問予定IDを指定してください',
      });
      expect(visitScheduleFindManyMock).toHaveBeenCalledWith({
        where: { org_id: 'org_1', facility_batch_id: 'batch_1' },
        select: {
          id: true,
          case_id: true,
          route_order: true,
          schedule_status: true,
          confirmed_at: true,
          version: true,
        },
      });
      expectNoMutationSideEffects();
    });

    it('rejects locked schedule statuses before route reorder side effects', async () => {
      visitScheduleFindManyMock.mockResolvedValue([
        {
          id: 'schedule_1',
          case_id: 'case_1',
          route_order: 1,
          schedule_status: 'completed',
          confirmed_at: null,
          version: 7,
        },
        {
          id: 'schedule_2',
          case_id: 'case_2',
          route_order: 2,
          schedule_status: 'planned',
          confirmed_at: null,
          version: 3,
        },
      ]);

      const response = await PATCH(
        createRequest({ ordered_schedule_ids: ['schedule_2', 'schedule_1'] }),
        routeContext('batch_1'),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '完了済みまたは中止済みの訪問予定は順路を変更できません',
      });
      expectNoMutationSideEffects();
    });

    it('rejects confirmed route changes before route reorder side effects', async () => {
      visitScheduleFindManyMock.mockResolvedValue([
        {
          id: 'schedule_1',
          case_id: 'case_1',
          route_order: 1,
          schedule_status: 'planned',
          confirmed_at: new Date('2026-03-27T10:00:00.000Z'),
          version: 7,
        },
        {
          id: 'schedule_2',
          case_id: 'case_2',
          route_order: 2,
          schedule_status: 'planned',
          confirmed_at: null,
          version: 3,
        },
      ]);

      const response = await PATCH(
        createRequest({ ordered_schedule_ids: ['schedule_2', 'schedule_1'] }),
        routeContext('batch_1'),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '電話確定済みの訪問予定は順路を変更できません',
      });
      expectNoMutationSideEffects();
    });

    it('rejects stale expected route orders before route reorder side effects', async () => {
      const response = await PATCH(
        createRequest({
          ordered_schedule_ids: ['schedule_2', 'schedule_1'],
          expected_route_orders: [
            { schedule_id: 'schedule_1', route_order: 7 },
            { schedule_id: 'schedule_2', route_order: 2 },
          ],
        }),
        routeContext('batch_1'),
      );

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        code: 'WORKFLOW_CONFLICT',
        message: '施設一括訪問の順序が同時に更新されました。再読み込みしてください',
      });
      expectNoMutationSideEffects();
    });

    it('allows org-wide roles to reorder batches owned by another pharmacist without access counts', async () => {
      facilityVisitBatchFindFirstMock.mockResolvedValue({
        id: 'batch_1',
        pharmacist_id: 'other_user',
      });
      visitScheduleUpdateManyMock.mockResolvedValue({ count: 1 });

      const response = await PATCH(
        createRequest({ ordered_schedule_ids: ['schedule_2', 'schedule_1'] }),
        routeContext('batch_1'),
      );

      expect(response.status).toBe(200);
      expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toEqual({
        updated: true,
        order: ['schedule_2', 'schedule_1'],
      });
      // org-wide ロールは担当アクセス突合(count)を行わずに並び替えできる
      expect(visitScheduleCountMock).not.toHaveBeenCalled();
      expect(visitScheduleUpdateManyMock).toHaveBeenCalledTimes(2);
      expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
        orgId: 'org_1',
        payload: { source: 'facility_visit_batch_reorder' },
      });
    });

    it('does not run child-schedule access counts for org-wide roles when reordering owned batches', async () => {
      facilityVisitBatchFindFirstMock.mockResolvedValue({
        id: 'batch_1',
        pharmacist_id: 'user_1',
      });
      visitScheduleUpdateManyMock.mockResolvedValue({ count: 1 });

      const response = await PATCH(
        createRequest({ ordered_schedule_ids: ['schedule_2', 'schedule_1'] }),
        routeContext('batch_1'),
      );

      expect(response.status).toBe(200);
      expect(visitScheduleCountMock).not.toHaveBeenCalled();
      expect(visitScheduleUpdateManyMock).toHaveBeenCalledTimes(2);
    });

    it('rejects duplicate schedule ids before batch lookup, route reorder, or notify', async () => {
      const response = await PATCH(
        createRequest({
          ordered_schedule_ids: ['schedule_2', 'schedule_1', 'schedule_2', 'schedule_1'],
        }),
        routeContext('  batch_1  '),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '同じ訪問予定IDを複数回指定できません',
      });
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expectNoMutationSideEffects();
    });

    it('updates org-scoped batch order with guarded writes and notifies workflow cache', async () => {
      visitScheduleUpdateManyMock.mockResolvedValue({ count: 1 });

      const response = await PATCH(
        createRequest({
          ordered_schedule_ids: ['schedule_2', 'schedule_1'],
          expected_route_orders: [
            { schedule_id: 'schedule_1', route_order: 1 },
            { schedule_id: 'schedule_2', route_order: 2 },
          ],
        }),
        routeContext('  batch_1  '),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        updated: true,
        order: ['schedule_2', 'schedule_1'],
      });
      expect(facilityVisitBatchFindFirstMock).toHaveBeenCalledWith({
        where: { id: 'batch_1', org_id: 'org_1' },
        select: { id: true, pharmacist_id: true },
      });
      expect(visitScheduleFindManyMock).toHaveBeenCalledWith({
        where: { org_id: 'org_1', facility_batch_id: 'batch_1' },
        select: {
          id: true,
          case_id: true,
          route_order: true,
          schedule_status: true,
          confirmed_at: true,
          version: true,
        },
      });
      expect(visitScheduleUpdateManyMock).toHaveBeenCalledTimes(2);
      expect(visitScheduleUpdateManyMock).toHaveBeenNthCalledWith(1, {
        where: {
          org_id: 'org_1',
          id: 'schedule_2',
          facility_batch_id: 'batch_1',
          version: 3,
          route_order: 2,
        },
        data: { route_order: 1, version: { increment: 1 } },
      });
      expect(visitScheduleUpdateManyMock).toHaveBeenNthCalledWith(2, {
        where: {
          org_id: 'org_1',
          id: 'schedule_1',
          facility_batch_id: 'batch_1',
          version: 7,
          route_order: 1,
        },
        data: { route_order: 2, version: { increment: 1 } },
      });
      expect(facilityVisitBatchDeleteMock).not.toHaveBeenCalled();
      expect(createAuditLogEntryMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
        {
          action: 'facility_visit_batch_reordered',
          targetType: 'FacilityVisitBatch',
          targetId: 'batch_1',
          changes: {
            schedules: [
              {
                schedule_id: 'schedule_2',
                case_id: 'case_2',
                previous_route_order: 2,
                expected_route_order: 2,
                route_order: 1,
              },
              {
                schedule_id: 'schedule_1',
                case_id: 'case_1',
                previous_route_order: 1,
                expected_route_order: 1,
                route_order: 2,
              },
            ],
          },
        },
      );
      expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
        orgId: 'org_1',
        payload: { source: 'facility_visit_batch_reorder' },
      });
    });

    it('returns conflict when a batch schedule changes before guarded reorder write', async () => {
      visitScheduleUpdateManyMock.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({
        count: 0,
      });

      const response = await PATCH(
        createRequest({
          ordered_schedule_ids: ['schedule_2', 'schedule_1'],
        }),
        routeContext('batch_1'),
      );

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        code: 'WORKFLOW_CONFLICT',
        message: '施設一括訪問の順序が同時に更新されました。再読み込みしてください',
      });
      expect(visitScheduleUpdateManyMock).toHaveBeenCalledTimes(2);
      expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
      expect(facilityVisitBatchDeleteMock).not.toHaveBeenCalled();
      expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
    });

    it('returns a sanitized no-store 500 when reorder transaction fails unexpectedly', async () => {
      withOrgContextMock.mockRejectedValueOnce(
        new Error('患者 山田花子 090-1234-5678 raw facility batch reorder detail'),
      );

      const response = await PATCH(
        createRequest({ ordered_schedule_ids: ['schedule_2', 'schedule_1'] }),
        routeContext('batch_1'),
      );

      expect(response.status).toBe(500);
      expectSensitiveNoStore(response);
      const body = await response.json();
      expect(body).toMatchObject({
        code: 'INTERNAL_ERROR',
        message: 'サーバー内部でエラーが発生しました',
      });
      expect(JSON.stringify(body)).not.toContain('山田花子');
      expect(JSON.stringify(body)).not.toContain('090-1234-5678');
      expect(JSON.stringify(body)).not.toContain('raw facility batch reorder detail');
      expectNoMutationSideEffects();
    });
  });
});
