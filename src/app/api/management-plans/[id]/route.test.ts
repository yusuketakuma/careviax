import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  careCaseFindManyMock,
  managementPlanFindFirstMock,
  managementPlanTransactionFindFirstMock,
  managementPlanFindUniqueMock,
  managementPlanUpdateMock,
  managementPlanUpdateManyMock,
  withOrgContextMock,
  resolveManagementPlanReviewAlertMock,
  scheduleManagementPlanReviewAlertMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  managementPlanFindFirstMock: vi.fn(),
  managementPlanTransactionFindFirstMock: vi.fn(),
  managementPlanFindUniqueMock: vi.fn(),
  managementPlanUpdateMock: vi.fn(),
  managementPlanUpdateManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  resolveManagementPlanReviewAlertMock: vi.fn(),
  scheduleManagementPlanReviewAlertMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    careCase: {
      findMany: careCaseFindManyMock,
    },
    managementPlan: {
      findFirst: managementPlanFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/management-plans', () => ({
  resolveManagementPlanReviewAlert: resolveManagementPlanReviewAlertMock,
  scheduleManagementPlanReviewAlert: scheduleManagementPlanReviewAlertMock,
}));

import { GET, PATCH } from './route';

function createGetRequest() {
  return new NextRequest('http://localhost/api/management-plans/plan_1');
}

function createPatchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/management-plans/plan_1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function createMalformedJsonPatchRequest() {
  return new NextRequest('http://localhost/api/management-plans/plan_1', {
    method: 'PATCH',
    body: '{"action":',
    headers: { 'content-type': 'application/json' },
  });
}

describe('/api/management-plans/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    managementPlanFindFirstMock.mockResolvedValue({
      id: 'plan_1',
      org_id: 'org_1',
      case_id: 'case_1',
      status: 'draft',
      effective_from: null,
      next_review_date: new Date('2026-04-30T00:00:00.000Z'),
      case_: {
        patient_id: 'patient_1',
        primary_pharmacist_id: 'user_2',
      },
    });
    managementPlanTransactionFindFirstMock.mockResolvedValue({
      id: 'plan_1',
      org_id: 'org_1',
      case_id: 'case_1',
      status: 'draft',
      next_review_date: new Date('2026-04-30T00:00:00.000Z'),
      case_: {
        patient_id: 'patient_1',
        primary_pharmacist_id: 'user_2',
      },
    });
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1', patient_id: 'patient_1' }]);
    managementPlanUpdateMock.mockResolvedValue({
      id: 'plan_1',
      status: 'approved',
      next_review_date: new Date('2026-04-30T00:00:00.000Z'),
      case_id: 'case_1',
    });
    managementPlanFindUniqueMock.mockResolvedValue({
      id: 'plan_1',
      status: 'approved',
      next_review_date: new Date('2026-04-30T00:00:00.000Z'),
      case_id: 'case_1',
    });
    managementPlanUpdateManyMock.mockResolvedValue({ count: 1 });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        managementPlan: {
          findFirst: managementPlanTransactionFindFirstMock,
          findUnique: managementPlanFindUniqueMock,
          update: managementPlanUpdateMock,
          updateMany: managementPlanUpdateManyMock,
        },
      }),
    );
  });

  it('returns a management plan by id', async () => {
    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'plan_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(managementPlanFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'plan_1',
        org_id: 'org_1',
        case_: {
          OR: [
            { primary_pharmacist_id: 'user_1' },
            { backup_pharmacist_id: 'user_1' },
            { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
          ],
        },
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'plan_1',
      },
    });
  });

  it('rejects blank management plan ids before loading the plan on GET', async () => {
    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '管理計画書IDが不正です',
    });
    expect(managementPlanFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(managementPlanUpdateManyMock).not.toHaveBeenCalled();
    expect(scheduleManagementPlanReviewAlertMock).not.toHaveBeenCalled();
    expect(resolveManagementPlanReviewAlertMock).not.toHaveBeenCalled();
  });

  it('rejects blank management plan ids before parsing or loading the plan on PATCH', async () => {
    const response = (await PATCH(createMalformedJsonPatchRequest(), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '管理計画書IDが不正です',
    });
    expect(managementPlanFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(managementPlanUpdateMock).not.toHaveBeenCalled();
    expect(managementPlanUpdateManyMock).not.toHaveBeenCalled();
    expect(scheduleManagementPlanReviewAlertMock).not.toHaveBeenCalled();
    expect(resolveManagementPlanReviewAlertMock).not.toHaveBeenCalled();
  });

  it('does not update an unassigned management plan', async () => {
    managementPlanFindFirstMock.mockResolvedValue(null);

    const response = (await PATCH(
      createPatchRequest({
        action: 'approve',
      }),
      {
        params: Promise.resolve({ id: 'plan_unassigned' }),
      },
    ))!;

    expect(response.status).toBe(404);
    expect(managementPlanUpdateMock).not.toHaveBeenCalled();
    expect(managementPlanUpdateManyMock).not.toHaveBeenCalled();
    expect(scheduleManagementPlanReviewAlertMock).not.toHaveBeenCalled();
  });

  it('rejects non-object patch payloads before loading the management plan', async () => {
    const response = (await PATCH(createPatchRequest(['approve']), {
      params: Promise.resolve({ id: 'plan_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(managementPlanFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(managementPlanUpdateMock).not.toHaveBeenCalled();
    expect(managementPlanUpdateManyMock).not.toHaveBeenCalled();
    expect(scheduleManagementPlanReviewAlertMock).not.toHaveBeenCalled();
    expect(resolveManagementPlanReviewAlertMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON patch payloads before loading the management plan', async () => {
    const response = (await PATCH(createMalformedJsonPatchRequest(), {
      params: Promise.resolve({ id: 'plan_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(managementPlanFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(managementPlanUpdateMock).not.toHaveBeenCalled();
    expect(managementPlanUpdateManyMock).not.toHaveBeenCalled();
    expect(scheduleManagementPlanReviewAlertMock).not.toHaveBeenCalled();
    expect(resolveManagementPlanReviewAlertMock).not.toHaveBeenCalled();
  });

  it('rejects blank update titles before loading the management plan', async () => {
    const response = (await PATCH(
      createPatchRequest({
        action: 'update',
        title: '   ',
      }),
      {
        params: Promise.resolve({ id: 'plan_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
    });
    expect(managementPlanFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(managementPlanUpdateMock).not.toHaveBeenCalled();
    expect(managementPlanUpdateManyMock).not.toHaveBeenCalled();
    expect(scheduleManagementPlanReviewAlertMock).not.toHaveBeenCalled();
    expect(resolveManagementPlanReviewAlertMock).not.toHaveBeenCalled();
  });

  it('rejects impossible update dates before loading the management plan', async () => {
    const response = (await PATCH(
      createPatchRequest({
        action: 'update',
        next_review_date: '2026-02-29',
      }),
      {
        params: Promise.resolve({ id: 'plan_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
    });
    expect(managementPlanFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(managementPlanUpdateMock).not.toHaveBeenCalled();
    expect(managementPlanUpdateManyMock).not.toHaveBeenCalled();
    expect(scheduleManagementPlanReviewAlertMock).not.toHaveBeenCalled();
    expect(resolveManagementPlanReviewAlertMock).not.toHaveBeenCalled();
  });

  it('rejects impossible update effective dates before loading the management plan', async () => {
    const response = (await PATCH(
      createPatchRequest({
        action: 'update',
        effective_from: '2026-04-31',
      }),
      {
        params: Promise.resolve({ id: 'plan_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
    });
    expect(managementPlanFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(managementPlanUpdateMock).not.toHaveBeenCalled();
    expect(managementPlanUpdateManyMock).not.toHaveBeenCalled();
    expect(scheduleManagementPlanReviewAlertMock).not.toHaveBeenCalled();
    expect(resolveManagementPlanReviewAlertMock).not.toHaveBeenCalled();
  });

  it('rejects update review dates before effective dates before loading the management plan', async () => {
    const response = (await PATCH(
      createPatchRequest({
        action: 'update',
        effective_from: '2026-06-30',
        next_review_date: '2026-06-01',
      }),
      {
        params: Promise.resolve({ id: 'plan_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
      details: {
        next_review_date: ['next_review_date は effective_from 以降の日付を指定してください'],
      },
    });
    expect(managementPlanFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(managementPlanUpdateManyMock).not.toHaveBeenCalled();
    expect(scheduleManagementPlanReviewAlertMock).not.toHaveBeenCalled();
    expect(resolveManagementPlanReviewAlertMock).not.toHaveBeenCalled();
  });

  it('rejects update review dates before existing effective dates before transaction work', async () => {
    managementPlanFindFirstMock.mockResolvedValue({
      id: 'plan_1',
      org_id: 'org_1',
      case_id: 'case_1',
      status: 'draft',
      effective_from: new Date('2026-06-30T00:00:00.000Z'),
      next_review_date: null,
      case_: {
        patient_id: 'patient_1',
        primary_pharmacist_id: 'user_2',
      },
    });

    const response = (await PATCH(
      createPatchRequest({
        action: 'update',
        next_review_date: '2026-06-01',
      }),
      {
        params: Promise.resolve({ id: 'plan_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
      details: {
        next_review_date: ['next_review_date は effective_from 以降の日付を指定してください'],
      },
    });
    expect(managementPlanFindFirstMock).toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(managementPlanUpdateManyMock).not.toHaveBeenCalled();
    expect(scheduleManagementPlanReviewAlertMock).not.toHaveBeenCalled();
    expect(resolveManagementPlanReviewAlertMock).not.toHaveBeenCalled();
  });

  it('returns conflict without updating when assignment or draft status changes after loading', async () => {
    managementPlanTransactionFindFirstMock.mockResolvedValueOnce(null);

    const response = (await PATCH(
      createPatchRequest({
        action: 'update',
        title: '更新版計画書',
      }),
      {
        params: Promise.resolve({ id: 'plan_1' }),
      },
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '管理計画書が他のユーザーによって更新されています。最新のデータを取得してください。',
    });
    expect(managementPlanUpdateManyMock).not.toHaveBeenCalled();
    expect(managementPlanFindUniqueMock).not.toHaveBeenCalled();
    expect(scheduleManagementPlanReviewAlertMock).not.toHaveBeenCalled();
    expect(resolveManagementPlanReviewAlertMock).not.toHaveBeenCalled();
  });

  it('updates draft plan content', async () => {
    const response = (await PATCH(
      createPatchRequest({
        action: 'update',
        title: ' 更新版計画書 ',
        summary: '   ',
        effective_from: '   ',
        next_review_date: ' 2026-05-31 ',
        content: { goals: ['服薬継続'], monitoring: ['副作用'] },
      }),
      {
        params: Promise.resolve({ id: 'plan_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(managementPlanTransactionFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'plan_1',
        org_id: 'org_1',
        status: 'draft',
        case_: {
          OR: [
            { primary_pharmacist_id: 'user_1' },
            { backup_pharmacist_id: 'user_1' },
            { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
          ],
        },
      },
    });
    expect(managementPlanUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'plan_1',
        org_id: 'org_1',
        status: 'draft',
        case_: {
          OR: [
            { primary_pharmacist_id: 'user_1' },
            { backup_pharmacist_id: 'user_1' },
            { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
          ],
        },
      },
      data: {
        title: '更新版計画書',
        summary: null,
        content: { goals: ['服薬継続'], monitoring: ['副作用'] },
        effective_from: null,
        next_review_date: new Date('2026-05-31'),
      },
    });
    expect(managementPlanFindUniqueMock).toHaveBeenCalledWith({
      where: { id: 'plan_1' },
    });
    expect(managementPlanUpdateMock).not.toHaveBeenCalled();
    expect(scheduleManagementPlanReviewAlertMock).not.toHaveBeenCalled();
  });

  it('archives an assigned management plan and resolves review alerts after the guarded write', async () => {
    managementPlanFindUniqueMock.mockResolvedValueOnce({
      id: 'plan_1',
      status: 'archived',
      next_review_date: null,
      case_id: 'case_1',
    });

    const response = (await PATCH(
      createPatchRequest({
        action: 'archive',
      }),
      {
        params: Promise.resolve({ id: 'plan_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(managementPlanUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'plan_1',
        org_id: 'org_1',
        case_: {
          OR: [
            { primary_pharmacist_id: 'user_1' },
            { backup_pharmacist_id: 'user_1' },
            { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
          ],
        },
      },
      data: {
        status: 'archived',
      },
    });
    expect(resolveManagementPlanReviewAlertMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        orgId: 'org_1',
        planId: 'plan_1',
      }),
    );
    expect(scheduleManagementPlanReviewAlertMock).not.toHaveBeenCalled();
  });

  it('returns conflict without resolving alerts when archive loses assignment after loading', async () => {
    managementPlanUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = (await PATCH(
      createPatchRequest({
        action: 'archive',
      }),
      {
        params: Promise.resolve({ id: 'plan_1' }),
      },
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '管理計画書が他のユーザーによって更新されています。最新のデータを取得してください。',
    });
    expect(resolveManagementPlanReviewAlertMock).not.toHaveBeenCalled();
    expect(scheduleManagementPlanReviewAlertMock).not.toHaveBeenCalled();
    expect(managementPlanFindUniqueMock).not.toHaveBeenCalled();
  });

  it('approves a draft plan and schedules a review alert', async () => {
    managementPlanTransactionFindFirstMock.mockResolvedValueOnce({
      id: 'plan_1',
      org_id: 'org_1',
      case_id: 'case_1',
      status: 'draft',
      next_review_date: new Date('2026-04-30T00:00:00.000Z'),
      case_: {
        patient_id: 'patient_fresh',
        primary_pharmacist_id: 'user_fresh',
      },
    });

    const response = (await PATCH(
      createPatchRequest({
        action: 'approve',
      }),
      {
        params: Promise.resolve({ id: 'plan_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(managementPlanUpdateManyMock).toHaveBeenCalled();
    expect(scheduleManagementPlanReviewAlertMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        orgId: 'org_1',
        planId: 'plan_1',
        caseId: 'case_1',
        patientId: 'patient_fresh',
        assignedTo: 'user_fresh',
      }),
    );
  });

  it('approves a draft plan without a review date and resolves existing review alerts', async () => {
    managementPlanFindUniqueMock.mockResolvedValueOnce({
      id: 'plan_1',
      status: 'approved',
      next_review_date: null,
      case_id: 'case_1',
    });

    const response = (await PATCH(
      createPatchRequest({
        action: 'approve',
      }),
      {
        params: Promise.resolve({ id: 'plan_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(resolveManagementPlanReviewAlertMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        orgId: 'org_1',
        planId: 'plan_1',
      }),
    );
    expect(scheduleManagementPlanReviewAlertMock).not.toHaveBeenCalled();
  });

  it('returns conflict without approval side effects when the draft changes after loading', async () => {
    managementPlanTransactionFindFirstMock.mockResolvedValueOnce(null);

    const response = (await PATCH(
      createPatchRequest({
        action: 'approve',
      }),
      {
        params: Promise.resolve({ id: 'plan_1' }),
      },
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '管理計画書が他のユーザーによって更新されています。最新のデータを取得してください。',
    });
    expect(managementPlanUpdateManyMock).not.toHaveBeenCalled();
    expect(managementPlanFindUniqueMock).not.toHaveBeenCalled();
    expect(scheduleManagementPlanReviewAlertMock).not.toHaveBeenCalled();
    expect(resolveManagementPlanReviewAlertMock).not.toHaveBeenCalled();
  });
});
