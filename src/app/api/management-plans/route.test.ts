import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  requireAuthContextMock,
  managementPlanFindManyMock,
  careCaseFindManyMock,
  careCaseFindFirstMock,
  managementPlanFindFirstMock,
  managementPlanCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  managementPlanFindManyMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  managementPlanFindFirstMock: vi.fn(),
  managementPlanCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    managementPlan: {
      findMany: managementPlanFindManyMock,
      findFirst: managementPlanFindFirstMock,
    },
    careCase: {
      findMany: careCaseFindManyMock,
      findFirst: careCaseFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

function createGetRequest(url: string) {
  return new NextRequest(url);
}

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/management-plans', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function createMalformedJsonPostRequest() {
  return new NextRequest('http://localhost/api/management-plans', {
    method: 'POST',
    body: '{"case_id":',
    headers: { 'content-type': 'application/json' },
  });
}

describe('/api/management-plans', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    managementPlanFindManyMock.mockResolvedValue([
      { id: 'plan_1', case_id: 'case_1', title: '訪問薬剤管理指導計画書' },
    ]);
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1', patient_id: 'patient_1' }]);
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1' });
    managementPlanFindFirstMock.mockResolvedValue({ version: 2 });
    managementPlanCreateMock.mockResolvedValue({
      id: 'plan_3',
      case_id: 'case_1',
      version: 3,
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        managementPlan: {
          findMany: managementPlanFindManyMock,
          findFirst: managementPlanFindFirstMock,
          create: managementPlanCreateMock,
        },
      }),
    );
  });

  it('lists management plans filtered by case id', async () => {
    const updatedAt = new Date('2026-06-29T00:00:00.000Z');
    const approvedAt = new Date('2026-06-28T00:00:00.000Z');
    managementPlanFindManyMock.mockResolvedValueOnce([
      {
        id: 'plan_1',
        org_id: 'org_1',
        case_id: 'case_1',
        title: '訪問薬剤管理指導計画書',
        status: 'approved',
        version: 2,
        summary: 'list では返さない要約',
        content: { privateGoal: 'list では返さない内容' },
        created_by: 'creator_user',
        approved_by: 'approver_user',
        reviewed_by: 'reviewer_user',
        source_plan_id: 'source_plan_1',
        effective_from: null,
        next_review_date: null,
        approved_at: approvedAt,
        updated_at: updatedAt,
      },
    ]);

    const response = (await GET(
      createGetRequest('http://localhost/api/management-plans?case_id=%20case_1%20'),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      }),
    });
    expect(managementPlanFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        case_id: 'case_1',
      },
      orderBy: [{ updated_at: 'desc' }],
      select: {
        id: true,
        case_id: true,
        title: true,
        status: true,
        version: true,
        effective_from: true,
        next_review_date: true,
        approved_at: true,
        updated_at: true,
      },
    });
    const payload = await response.json();
    expect(payload).toEqual({
      data: [
        {
          id: 'plan_1',
          case_id: 'case_1',
          title: '訪問薬剤管理指導計画書',
          status: 'approved',
          version: 2,
          effective_from: null,
          next_review_date: null,
          approved_at: approvedAt.toISOString(),
          updated_at: updatedAt.toISOString(),
        },
      ],
    });
    expect(JSON.stringify(payload)).not.toContain('privateGoal');
    expect(JSON.stringify(payload)).not.toContain('list では返さない要約');
    expect(JSON.stringify(payload)).not.toContain('creator_user');
    expect(JSON.stringify(payload)).not.toContain('approver_user');
    expect(JSON.stringify(payload)).not.toContain('reviewer_user');
    expect(JSON.stringify(payload)).not.toContain('source_plan_1');
  });

  it('lists management plans org-wide with a safety cap and no take when case_id is omitted', async () => {
    managementPlanFindManyMock.mockResolvedValueOnce([
      { id: 'plan_1', case_id: 'case_1', title: '訪問薬剤管理指導計画書' },
    ]);

    const response = (await GET(createGetRequest('http://localhost/api/management-plans')))!;

    expect(response.status).toBe(200);
    expect(managementPlanFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { org_id: 'org_1' },
        take: 501,
      }),
    );
    const payload = await response.json();
    expect(payload).toMatchObject({ hasMore: false });
  });

  it('reports hasMore and truncates at the safety cap for the org-wide management plan list', async () => {
    const overflowRows = Array.from({ length: 501 }, (_, index) => ({
      id: `plan_${index}`,
      case_id: `case_${index}`,
      title: '訪問薬剤管理指導計画書',
    }));
    managementPlanFindManyMock.mockResolvedValueOnce(overflowRows);

    const response = (await GET(createGetRequest('http://localhost/api/management-plans')))!;

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data).toHaveLength(500);
    expect(payload.hasMore).toBe(true);
  });

  it('rejects blank case filters before listing management plans', async () => {
    const response = (await GET(
      createGetRequest('http://localhost/api/management-plans?case_id=%20%20'),
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'case_id は空にできません',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(managementPlanFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate case filters before listing management plans', async () => {
    const response = (await GET(
      createGetRequest('http://localhost/api/management-plans?case_id=case_1&case_id=case_2'),
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'クエリパラメータが不正です',
      details: {
        case_id: ['case_id は1つだけ指定してください'],
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(managementPlanFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a fixed no-store 500 envelope when listing management plans throws', async () => {
    managementPlanFindManyMock.mockRejectedValueOnce(new Error('raw management plan failure'));

    const response = (await GET(createGetRequest('http://localhost/api/management-plans')))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const payload = await response.json();
    expect(payload).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(payload)).not.toContain('raw management plan failure');
  });

  it('denies management plan creation for a case not in the org before write', async () => {
    careCaseFindFirstMock.mockResolvedValue(null);

    const response = (await POST(
      createPostRequest({
        case_id: 'case_unassigned',
        title: '訪問薬剤管理指導計画書',
        content: { summary: '内容' },
      }),
    ))!;

    expect(response.status).toBe(404);
    expect(careCaseFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'case_unassigned',
        org_id: 'org_1',
      },
      select: {
        id: true,
      },
    });
    expect(managementPlanCreateMock).not.toHaveBeenCalled();
  });

  it('rejects non-object create payloads before loading the care case', async () => {
    const response = (await POST(createPostRequest(['case_1'])))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(managementPlanFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(managementPlanCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before loading the care case', async () => {
    const response = (await POST(createMalformedJsonPostRequest()))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(managementPlanFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(managementPlanCreateMock).not.toHaveBeenCalled();
  });

  it('rejects blank create identifiers before loading the care case', async () => {
    const response = (await POST(
      createPostRequest({
        case_id: '   ',
        title: '   ',
        content: { summary: '内容' },
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(managementPlanFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(managementPlanCreateMock).not.toHaveBeenCalled();
  });

  it('rejects impossible review dates before loading the care case', async () => {
    const response = (await POST(
      createPostRequest({
        case_id: 'case_1',
        title: '訪問薬剤管理指導計画書',
        content: { summary: '内容' },
        next_review_date: '2026-02-29',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(managementPlanFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(managementPlanCreateMock).not.toHaveBeenCalled();
  });

  it('rejects impossible effective dates before loading the care case', async () => {
    const response = (await POST(
      createPostRequest({
        case_id: 'case_1',
        title: '訪問薬剤管理指導計画書',
        content: { summary: '内容' },
        effective_from: '2026-04-31',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(managementPlanFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(managementPlanCreateMock).not.toHaveBeenCalled();
  });

  it('rejects review dates before effective dates before loading the care case', async () => {
    const response = (await POST(
      createPostRequest({
        case_id: 'case_1',
        title: '訪問薬剤管理指導計画書',
        content: { summary: '内容' },
        effective_from: '2026-06-30',
        next_review_date: '2026-06-01',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
      details: {
        next_review_date: ['next_review_date は effective_from 以降の日付を指定してください'],
      },
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(managementPlanFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(managementPlanCreateMock).not.toHaveBeenCalled();
  });

  it('rejects an inaccessible or cross-case source plan before cloning', async () => {
    managementPlanFindFirstMock.mockResolvedValue(null);

    const response = (await POST(
      createPostRequest({
        case_id: 'case_1',
        title: '訪問薬剤管理指導計画書',
        content: { summary: '内容' },
        source_plan_id: 'plan_unassigned',
      }),
    ))!;

    expect(response.status).toBe(404);
    expect(managementPlanFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'plan_unassigned',
        org_id: 'org_1',
        case_id: 'case_1',
      },
      select: { id: true },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(managementPlanCreateMock).not.toHaveBeenCalled();
  });

  it('creates a new management plan with incremented version', async () => {
    const response = (await POST(
      createPostRequest({
        case_id: 'case_1',
        title: '訪問薬剤管理指導計画書',
        content: { summary: '内容' },
        next_review_date: '2026-04-30',
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(managementPlanCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        case_id: 'case_1',
        version: 3,
        created_by: 'user_1',
        content: { summary: '内容' },
        next_review_date: new Date('2026-04-30'),
      }),
    });
  });

  it('maps version conflicts during management plan creation to 409', async () => {
    managementPlanCreateMock.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const response = (await POST(
      createPostRequest({
        case_id: 'case_1',
        title: '訪問薬剤管理指導計画書',
        content: { summary: '内容' },
      }),
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message:
        '同じケースで同じバージョンの管理計画書が既に作成されています。最新のデータを取得してください。',
    });
    expect(managementPlanCreateMock).toHaveBeenCalled();
  });

  it('normalizes create identifiers, text, and blank optional fields before lookup and write', async () => {
    managementPlanFindFirstMock
      .mockResolvedValueOnce({ id: 'source_plan_1' })
      .mockResolvedValueOnce({ version: 2 });

    const response = (await POST(
      createPostRequest({
        case_id: ' case_1 ',
        title: ' 更新版 計画書 ',
        summary: '   ',
        content: { summary: '内容' },
        effective_from: ' 2026-04-01 ',
        next_review_date: ' 2026-04-30 ',
        source_plan_id: ' source_plan_1 ',
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(careCaseFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'case_1',
        org_id: 'org_1',
      },
      select: {
        id: true,
      },
    });
    expect(managementPlanFindFirstMock).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'source_plan_1',
        org_id: 'org_1',
        case_id: 'case_1',
      },
      select: { id: true },
    });
    expect(managementPlanCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        case_id: 'case_1',
        title: '更新版 計画書',
        summary: null,
        effective_from: new Date('2026-04-01'),
        next_review_date: new Date('2026-04-30'),
        source_plan_id: 'source_plan_1',
      }),
    });
  });
});
