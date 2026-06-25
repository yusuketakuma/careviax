import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

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

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
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
          findFirst: managementPlanFindFirstMock,
          create: managementPlanCreateMock,
        },
      }),
    );
  });

  it('lists management plans filtered by case id', async () => {
    const response = (await GET(
      createGetRequest('http://localhost/api/management-plans?case_id=%20case_1%20'),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(managementPlanFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        case_id: 'case_1',
      },
      orderBy: [{ updated_at: 'desc' }],
    });
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
