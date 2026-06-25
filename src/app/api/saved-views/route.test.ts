import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { prismaMock, txMock, withOrgContextMock, authContext, requireAuthContextMock } = vi.hoisted(
  () => {
    const authContext = {
      userId: 'user_1',
      orgId: 'org_1',
      role: 'pharmacist',
      actorPharmacyId: 'org_1',
      actorSiteId: 'site_1',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    };

    return {
      authContext,
      prismaMock: {
        savedView: {
          findMany: vi.fn(),
          findFirst: vi.fn(),
          count: vi.fn(),
        },
      },
      txMock: {
        savedView: {
          create: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
        },
        auditLog: {
          create: vi.fn(),
        },
      },
      withOrgContextMock: vi.fn(),
      requireAuthContextMock: vi.fn(),
    };
  },
);

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (handler: (req: unknown, ctx: typeof authContext, routeContext?: unknown) => unknown) =>
    (req: unknown, routeContext?: unknown) =>
      handler(req, authContext, routeContext),
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { DELETE as DELETE_VIEW, PATCH } from './[id]/route';
import { GET, POST } from './route';

const createdAt = new Date('2026-06-01T00:00:00.000Z');
const updatedAt = new Date('2026-06-02T00:00:00.000Z');

function buildSavedView(overrides: Record<string, unknown> = {}) {
  return {
    id: 'view_1',
    org_id: 'org_1',
    user_id: 'user_1',
    name: '朝の確認',
    scope: 'schedules',
    filters: { status: 'pending' },
    sort: { field: 'route_order', direction: 'asc' },
    is_shared: false,
    sort_order: 0,
    created_at: createdAt,
    updated_at: updatedAt,
    ...overrides,
  };
}

type TestRequestInit = {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit;
};

function createRequest(path: string, init: TestRequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('x-org-id', 'org_1');
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  return new NextRequest(`http://localhost${path}`, {
    ...init,
    headers,
  });
}

function jsonRequest(path: string, method: string, body: unknown) {
  return createRequest(path, {
    method,
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: 'view_1' }) };
const emptyParams = { params: Promise.resolve({}) };

describe('/api/saved-views', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({ ctx: authContext });
    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback(txMock));
    txMock.auditLog.create.mockResolvedValue({});
  });

  it('lists owned and shared views for the requested scope', async () => {
    prismaMock.savedView.findMany.mockResolvedValue([
      buildSavedView(),
      buildSavedView({ id: 'view_2', user_id: 'user_2', name: '共有ビュー', is_shared: true }),
    ]);

    const response = await GET(createRequest('/api/saved-views?scope=schedules'), emptyParams);

    expect(response.status).toBe(200);
    expect(prismaMock.savedView.findMany).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        scope: 'schedules',
        OR: [{ user_id: 'user_1' }, { is_shared: true }],
      },
      orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
      take: 100,
    });
    await expect(response.json()).resolves.toMatchObject({
      data: [
        { id: 'view_1', isOwner: true, isShared: false, sortOrder: 0 },
        { id: 'view_2', isOwner: false, isShared: true },
      ],
    });
  });

  it('bounds saved view list size when a limit is provided', async () => {
    prismaMock.savedView.findMany.mockResolvedValue([buildSavedView()]);

    const response = await GET(
      createRequest('/api/saved-views?scope=schedules&limit=5'),
      emptyParams,
    );

    expect(response.status).toBe(200);
    expect(prismaMock.savedView.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          scope: 'schedules',
          OR: [{ user_id: 'user_1' }, { is_shared: true }],
        },
        take: 5,
      }),
    );
  });

  it('clamps overly large saved view list limits', async () => {
    prismaMock.savedView.findMany.mockResolvedValue([buildSavedView()]);

    const response = await GET(createRequest('/api/saved-views?limit=9999'), emptyParams);

    expect(response.status).toBe(200);
    expect(prismaMock.savedView.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 200,
      }),
    );
  });

  it('rejects invalid list scope before querying saved views', async () => {
    const response = await GET(createRequest('/api/saved-views?scope=unknown'), emptyParams);

    expect(response.status).toBe(400);
    expect(prismaMock.savedView.findMany).not.toHaveBeenCalled();
  });

  it('creates a saved view with resolved sort order and an audit entry', async () => {
    prismaMock.savedView.findFirst.mockResolvedValue(null);
    prismaMock.savedView.count.mockResolvedValue(2);
    txMock.savedView.create.mockResolvedValue(buildSavedView({ name: '朝の確認', sort_order: 2 }));

    const response = await POST(
      jsonRequest('/api/saved-views', 'POST', {
        name: '  朝の確認  ',
        scope: 'schedules',
        filters: { status: 'pending' },
        sort: { field: 'route_order', direction: 'asc' },
      }),
      emptyParams,
    );

    expect(response.status).toBe(201);
    expect(prismaMock.savedView.findFirst).toHaveBeenCalledWith({
      where: { org_id: 'org_1', user_id: 'user_1', scope: 'schedules', name: '朝の確認' },
      select: { id: true },
    });
    expect(txMock.savedView.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        user_id: 'user_1',
        name: '朝の確認',
        scope: 'schedules',
        filters: { status: 'pending' },
        sort: { field: 'route_order', direction: 'asc' },
        is_shared: false,
        sort_order: 2,
      }),
    });
    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'saved_view_created',
        target_type: 'SavedView',
        target_id: 'view_1',
        changes: { name: '朝の確認', scope: 'schedules', is_shared: false },
      }),
    });
  });

  it('rejects duplicate names before creating a saved view', async () => {
    prismaMock.savedView.findFirst.mockResolvedValue({ id: 'view_existing' });

    const response = await POST(
      jsonRequest('/api/saved-views', 'POST', {
        name: '朝の確認',
        scope: 'schedules',
        filters: {},
      }),
      emptyParams,
    );

    expect(response.status).toBe(409);
    expect(txMock.savedView.create).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('maps create-time unique constraint races to duplicate-name conflicts', async () => {
    prismaMock.savedView.findFirst.mockResolvedValue(null);
    prismaMock.savedView.count.mockResolvedValue(0);
    txMock.savedView.create.mockRejectedValueOnce({ code: 'P2002' });

    const response = await POST(
      jsonRequest('/api/saved-views', 'POST', {
        name: '朝の確認',
        scope: 'schedules',
        filters: {},
      }),
      emptyParams,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '同じ名前の保存ビューが既に存在します',
    });
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('updates only an owned saved view and records changed fields', async () => {
    prismaMock.savedView.findFirst
      .mockResolvedValueOnce({ id: 'view_1', user_id: 'user_1', scope: 'schedules', name: '旧名' })
      .mockResolvedValueOnce(null);
    txMock.savedView.update.mockResolvedValue(
      buildSavedView({ name: '新名', is_shared: true, sort_order: 4 }),
    );

    const response = await PATCH(
      jsonRequest('/api/saved-views/view_1', 'PATCH', {
        name: '新名',
        filters: { status: 'done' },
        sort: { field: 'updated_at', direction: 'desc' },
        is_shared: true,
        sort_order: 4,
      }),
      params,
    );

    expect(response.status).toBe(200);
    expect(txMock.savedView.update).toHaveBeenCalledWith({
      where: { id: 'view_1' },
      data: {
        name: '新名',
        filters: { status: 'done' },
        sort: { field: 'updated_at', direction: 'desc' },
        is_shared: true,
        sort_order: 4,
      },
    });
    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'saved_view_updated',
        target_id: 'view_1',
        changes: {
          name: '新名',
          is_shared: true,
          sort_order: 4,
          filters_updated: true,
          sort_updated: true,
        },
      }),
    });
  });

  it('maps update-time unique constraint races to duplicate-name conflicts', async () => {
    prismaMock.savedView.findFirst
      .mockResolvedValueOnce({ id: 'view_1', user_id: 'user_1', scope: 'schedules', name: '旧名' })
      .mockResolvedValueOnce(null);
    txMock.savedView.update.mockRejectedValueOnce({ code: 'P2002' });

    const response = await PATCH(
      jsonRequest('/api/saved-views/view_1', 'PATCH', { name: '新名' }),
      params,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '同じ名前の保存ビューが既に存在します',
    });
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects editing a shared view owned by another user', async () => {
    prismaMock.savedView.findFirst.mockResolvedValue({
      id: 'view_1',
      user_id: 'user_2',
      scope: 'schedules',
      name: '共有ビュー',
    });

    const response = await PATCH(
      jsonRequest('/api/saved-views/view_1', 'PATCH', { name: '変更' }),
      params,
    );

    expect(response.status).toBe(403);
    expect(txMock.savedView.update).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('deletes an owned saved view with an audit entry', async () => {
    prismaMock.savedView.findFirst.mockResolvedValue({
      id: 'view_1',
      user_id: 'user_1',
      name: '朝の確認',
      scope: 'schedules',
    });
    txMock.savedView.delete.mockResolvedValue(buildSavedView());

    const response = await DELETE_VIEW(
      createRequest('/api/saved-views/view_1', { method: 'DELETE' }),
      params,
    );

    expect(response.status).toBe(200);
    expect(txMock.savedView.delete).toHaveBeenCalledWith({ where: { id: 'view_1' } });
    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'saved_view_deleted',
        target_id: 'view_1',
        changes: { name: '朝の確認', scope: 'schedules' },
      }),
    });
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
